# Android 离线 / 收不到通用排查流程

## 与 MCP 的关系（必读）

「Android 收不到推送 / 离线不达」的主排障由 **MCP** `troubleshoot-android` 状态机固化：


| state                                      | 主链步骤                       | kind    |
| ------------------------------------------ | -------------------------- | ------- |
| `stage-0-investigation-plan` | 排查计划确认（开场闸口） | plan |
| `stage-1-console-validity`                 | 控制台有效性（服务 + 厂商证书）          | verify  |
| `stage-2-scenario`                         | 测法与场景                      | collect |
| `stage-3-config-alignment`                 | 配置对齐（厂商证 / configs / 包名指纹） | verify  |
| `stage-4-register-observation`             | registerPush 观测            | observe |
| `stage-5-token-binding`                    | 排查工具：已绑定的推送 token          | observe |
| `stage-6-offline-test`                     | 离线发测 + 回执                  | observe |
| `stage-7-analyze` → `stage-9-final-report` | 分析 / 修复 / 结论；**仅当 stage-7 仍无法定位根因时**再索要 IM SDK xlog 并调用 `analyze_imsdk_push_log` | —       |


**RegistrationID ≠ 推送 token**；排查工具查的是已绑定推送 token。

本文件保留：分诊、子链、错误码与升级边界。

## 入口现象

Android **收不到推送 / 离线不达**，且尚未给出可定位的单一错误码（或错误码已处理仍收不到）。

有明确 TIMPush / 厂商错误码时，先读 `../../cards/android/error-codes.md`，再视需要回主链补查。

厂商配置 / 注册专项（AGConnect、包名指纹、某厂通道证书）走子流程
`vendor-not-received.md`。已送达不弹走 `delivered-not-displayed.md`。

## 分诊


| 现象         | 走哪条                                                       |
| ---------- | --------------------------------------------------------- |
| 场景不清的「收不到」 | `troubleshoot-android` 主链 stage-0→6                       |
| 明确错误码      | `../../cards/android/error-codes.md` + 回补 stage-1、stage-3 |
| 注册失败主链     | `register-failed.md`                                      |
| 厂商配置专项     | `vendor-not-received.md`                                  |
| 已送达不展示     | `delivered-not-displayed.md`                              |
| 点击无跳转      | `click-no-action.md`                                      |




## 分支处理


| 分支                | 判断信号                                   | 处理动作                                                      |
| ----------------- | -------------------------------------- | --------------------------------------------------------- |
| 服务未开通 / 到期或证书无效   | 插件关闭、套餐过期、厂商证未配/失效                     | `../../cards/common/console-validity-gate.md`；MCP stage-1 |
| 配置对齐              | 厂商证 / timpush-configs / 包名指纹           | MCP stage-3；专项 `vendor-not-received.md`                   |
| 注册失败              | registerPush failed / 无 RegistrationID | `register-failed.md`                                      |
| 强杀后不达             | 前台正常、强制停止后无通知                          | `../../cards/android/kill-process-offline.md`             |
| 日限额 / 分类          | 前几条成功之后全无                              | `../../cards/android/message-category-limit.md`           |
| Registration 绑定   | 控制台查无设备 / 无推送 token                    | `../../cards/common/registration-binding.md`              |
| Flutter / uni-app | 跨端工程                                   | 跨端 flow → 再回本主链                                           |




## 验证信号

- stage-1 / stage-3 通过。
- `registerPush success`；stage-5 能查到已绑定推送 token。
- stage-6 离线测试可达或回执可解释。



## 何时升级 / 转交

- 腾讯云侧已拿到厂商成功回执，设备仍不展示且端上条件已排除。
- 厂商 messageId 异常且公开文档无解释。
- 套餐 / 产品能力限制 → `../common/console-product-limits.md` 或 escalate。
- **stage-7 分析仍无法定位时**：先要 IM SDK xlog（禁止开场就要）。取证硬顺序：**复现问题 → 重启应用 → 再登录 IM SDK → 再导出日志**；然后 MCP `get_imsdk_log_guide` → `decode_imsdk_xlog` → `analyze_imsdk_push_log`。xlog 仍无法解释再升级产研。

