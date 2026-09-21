# Android 厂商通道收不到排查流程

## 与 MCP 的关系

本文件是 **分支知识**，不拥有独立主链。

- ROUTER `workflow_id`：`troubleshoot-android`
- 主链 owner：`flows/android/offline-not-received.md`
- 本文件挂载：主要挂 `stage-3-config-alignment`，发测相关补 `stage-6`
- 执行仍走上述 MCP workflow（进入后先过 `stage-0-investigation-plan`）；本文件不能替代 engine，也不能跳过主链门控（stage-1 有效性、stage-3 配置等）。

## 与通用收不到的关系

厂商通道「已注册成功、在线通知正常，但离线收不到」多发生在厂商配置、
App 杀死后、或厂商系统限制。

- 广义「收不到」主链先走 `offline-not-received.md` / MCP `troubleshoot-android`；
- 本流程聚焦**厂商专项细节**（华为 / 荣耀 / 小米 / OPPO / vivo / 魅族 / FCM）；
- 已送达不展示 → `delivered-not-displayed.md`；通知无跳转 → `click-no-action.md`；
- 推送服务 + 厂商证书有效性属主链第 1 步，参见 `../../cards/common/console-validity-gate.md`。

## 首轮证据

**顺序硬约束**：先过 `../../cards/common/console-validity-gate.md`（对齐 MCP stage-1）与主链配置校验（MCP stage-3），再做厂商细节核对。

1. 受影响厂商品牌 / 机型 / 系统版本。
2. 该厂商是否已完成 SDK 配置与控制台证书添加。
3. `registerPush` 是否成功，以及厂商 Token 是否回传成功。
4. 后台 / 强杀 / 自启动 / 电量策略状态。
5. 厂商限制：单日消息限额、通知类别、夜间静默、系统通知权限。

## 排查顺序

1. **校验提醒**：控制台厂商通道证书已配置且在有效期内（`console-validity-gate.md`；MCP stage-1）。
2. **校验提醒**（主链第 3 步）：包名与厂商控制台一致；华为 / 荣耀需 SHA-256 证书指纹一致；
   `google-services.json` / `agconnect-services.json` 放对位置。
3. **校验提醒**：厂商后台是否已通过应用审核、是否误传「未发布草稿」。
4. **观测**：`registerPush` 成功日志中是否出现对应厂商通道成功回调。
5. **校验提醒**：厂商限制规则（小米单日额度、vivo 夜间免打扰、OPPO 通知栏权限等）。
6. **观测**：设备通知开关与通道开关；分应用通知权限。
7. **观测**：杀进程后的离线消息：部分厂商通道对强制停止有限制。

## 分支处理

| 分支 | 判断信号 | 处理动作 |
|---|---|---|
| 控制台有效性 | 服务/厂商证未配置或失效 | `../../cards/common/console-validity-gate.md` |
| 华为 | `6003` / AGConnect / SHA-256 | `../../cards/android/vendor-huawei.md` |
| 荣耀 | 包名 / 签名 / 通道状态 | `../../cards/android/vendor-honor.md` |
| FCM | 海外 / GMS / `FCM unavailable` | `../../cards/android/fcm-gms-domestic.md` |
| 厂商限额 | 单日上限 / 夜间 | `../../cards/android/message-category-limit.md` |
| 强杀不达 | 仅杀死后异常 | `../../cards/android/kill-process-offline.md` |
| 已送达不展示 | 回执成功不弹 | `delivered-not-displayed.md` |
| 注册侧错误码 | `800xxx` | `../../cards/android/error-codes.md` + `register-failed.md` |

## 验证信号

- 控制台厂商通道配置与包名 / 指纹一致。
- `registerPush` 日志包含目标厂商成功信息。
- 离线测试可达，或回执可解释厂商策略。

## 何时升级 / 转交

- 厂商 messageId 存在但系统侧吞掉且无法复现。
- 需要厂商工单。
- 灰度 / 限额策略需产品确认。

## 常见错误

- 未配厂商后台应用信息就调客户端。
- 包名大小写、空格、测试包名与线上不一致。
- 华为 / 荣耀忘记 SHA-256 指纹。
- 忽视厂商单日消息量限制与静默时段。
- 用模拟器验证厂商通道全链路。
