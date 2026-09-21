# iOS 离线推送收不到 / 不展示 / 证书 / 点击排查流程

## 与 MCP 的关系（必读）

「iOS 集成后收不到离线推送」的主排障由 **MCP `troubleshoot-ios`** 状态机固化，本文件不再用自然语言定义主链顺序。

执行顺序以 state 机为准（禁止跳过 stage-1 / stage-3 直接做注册或发测）：

| state | 主链步骤 | kind |
|-------|----------|------|
| `stage-0-investigation-plan` | 排查计划确认（开场闸口） | plan |
| `stage-1-console-validity` | 控制台有效性（服务 + APNs 证书） | verify |
| `stage-2-scenario` | 测法与场景 | collect |
| `stage-3-config-alignment` | 配置对齐（Bundle ID / businessID / 开发生产） | verify |
| `stage-4-register-observation` | registerPush 观测 | observe |
| `stage-5-token-binding` | 排查工具：已绑定的推送 token | observe |
| `stage-6-offline-test` | 离线发测 + 回执 | observe |
| `stage-7-analyze` → `stage-9-final-report` | 分析 / 最小修复 / 结论；**仅当 stage-7 仍无法定位时**再索要 IM SDK xlog 并 `analyze_imsdk_push_log` | — |

术语：**RegistrationID ≠ 推送 token**；排查工具查的是 RegistrationID/userID 下**已绑定的推送 token**。

## 本文件提供什么

- 分诊：何时走子链 / 卡片而不是线性主链
- 子链与卡片入口
- 验证信号与升级边界

## 入口现象

iOS 集成后收不到离线推送、杀进程后不弹通知、换证书后不生效、证书/Token 异常、
能收到但点击无跳转或展示异常，或在线消息正常但 APNs 离线通知异常。

有 `InvalidProviderToken` / `BadDeviceToken` / code=3000 等明确信号时，可先下钻对应
card，再回到主链补查；card 入口须回补 stage-1 与 stage-3。

## 分诊

| 现象 | 走哪条 |
|------|--------|
| 「收不到 / 杀进程无 APNs / 离线不通」，尚说不清卡在哪 | `troubleshoot-ios` 主链 stage-0→6 |
| 换证失效、证书/Token 异常、明确错误码 | 证书 / Token 子链（下方）+ 回补 stage-1、stage-3 |
| 控制台/回执成功但不弹、角标异常 | 展示异常子链（建议仍做 stage-1 服务校验） |
| 通知已展示，但点击不跳、`ext` 为空 | 点击跳转子链 |

## 对用户呈现

与 MCP stage 对齐的逐步口径（每轮 1 步）：

1. 控制台：服务 + 证书（`../../cards/common/console-validity-gate.md`）
2. 真机？前台/后台/杀进程？
3. 核配置（每轮一项：Bundle ID / businessID / 开发生产）
4. Xcode 过滤 `TIMPush`：registerPush
5. 排查工具：已绑定推送 token
6. 离线发测 + 结果/回执

## 证书 / Token 子链

入口：证书 / Token 异常、换证后不生效、明确 APNs 错误。

先回补 stage-1（证书有效），再：

1. 证书环境 = App 运行环境（校验提醒）。
2. P8：Key ID / Team ID / Bundle ID；P12：密码与环境（校验提醒）。
3. `businessID` 已同步到客户端（校验提醒）。
4. 真机重测（观测）。

细节卡：`../../cards/ios/certificate-businessid.md` /
`../../cards/ios/device-token-binding.md` /
`../../cards/ios/p8-invalid-provider-token.md` /
`../../cards/ios/aps-environment-3000.md`。

## 展示异常子链

1. 建议校验 stage-1 服务状态。
2. 用 TaskId / APNs 回执确认已送达；未送达回主链查证书与绑定。
3. 通知权限、专注模式、通知样式。
4. 区分 App 状态；角标 → `../../flows/common/badge.md`；统计 → `../../cards/ios/stats-extension.md`。

## 点击跳转子链

1. 确认已展示；核对 payload / `OfflinePushInfo.ext`。
2. 冷热启动复测；点击回调注册时机。
3. 跨端再挂 Flutter / uni-app flow。

细节卡：`../../cards/ios/notification-click-ext.md`。

## 分支处理

| 分支 | 判断信号 | 处理动作 |
|------|----------|----------|
| 服务未开通 / 到期或证书无效 | 插件关闭、套餐过期、APNs 证无效 | `../../cards/common/console-validity-gate.md`；MCP stage-1 |
| 测法错误 | 模拟器、只在前台 | MCP stage-2 校正 |
| 配置不一致 | Bundle ID / businessID / 环境 | MCP stage-3 + `certificate-businessid.md` |
| `deviceToken` / 绑定缺失 | 排查工具无推送 token | 回 stage-3/4 + `device-token-binding.md` |
| code=3000 | aps-environment | `../../cards/ios/aps-environment-3000.md` |
| P8 InvalidProviderToken | 403 | `../../cards/ios/p8-invalid-provider-token.md` |
| 展示 / 点击 | 回执成功不弹 / 点击无跳转 | 上方子链 |
| 跨端 | 原生正常、插件异常 | Flutter / uni-app flow |

## 验证信号

- stage-1 通过；stage-3 配置结论为通过。
- registerPush 成功；stage-5 能查到已绑定推送 token。
- stage-6 可达或控制台回执可解释失败。

## 何时升级 / 转交

- 主链 stage-1→6 完成后仍无法解释 APNs 投递。
- 旧包兼容旧 `businessID` 需后端确认。
- **stage-7 仍无法定位时**：先要 IM SDK xlog（禁止开场就要）。取证硬顺序：**复现问题 → 重启应用 → 再登录 IM SDK → 再导出日志**；MCP `get_imsdk_log_guide` → `decode_imsdk_xlog` → `analyze_imsdk_push_log`。xlog / crash / 最小复现仍无法解释再升级产研。
