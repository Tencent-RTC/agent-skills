# iOS deviceToken 注册与上报

## 与 MCP 的关系

本文件是 **知识卡**，不拥有独立主链。

- ROUTER `workflow_id`：`troubleshoot-ios`
- 关联 flow：`flows/ios/offline-not-received.md`
- 挂载：主要挂 `stage-5-token-binding`
- 执行仍走 MCP 状态机；命中本卡后按挂载阶段取证，禁止用本卡替代 `complete_workflow_step`。

## 适用现象

当用户反馈以下任一现象时，优先使用本卡：

- 收不到 APNs 离线推送，日志无 `deviceToken:`。
- `BadDeviceToken`。
- `didFailToRegisterForRemoteNotificationsWithError`。
- 控制台提示设备未注册 / token 未上报。

不适用于：

- 明确缺 `aps-environment` / 3000 → `aps-environment-3000.md`。
- 证书环境或 `businessID` 换证问题 → `certificate-businessid.md`。
- P8 `InvalidProviderToken` → `p8-invalid-provider-token.md`。

## 共同根因

iOS 离线推送依赖系统授予通知权限、成功拿到 deviceToken，并在 IM 登录后通过 TIMPush 上报。权限拒绝、开发环境不稳定、未在登录后 `registerPush`，都会导致无 token 或无效 token。

常见错误模式：

- 未请求通知授权。
- 在未登录时调用 `registerPush` 期望拿到可用绑定。
- 开发环境偶发拿不到 token，却一直用开发包测。

## 必须收集的证据

- 通知权限状态。
- `didRegister` / `didFail` / `deviceToken:` / `APNs configuration success` 日志。
- 打包环境（开发/生产）与证书环境。
- `registerPush` 调用时机（是否登录后）。
- Bundle ID。

## 排查步骤

1. 确认通知授权未拒绝。
2. 核对 aps-environment 与证书（若 3000 则转对应 card）。
3. 收集 token 注册日志；开发环境不稳定可换生产包或换机。
4. 确认登录成功后再 `registerPush`。
5. 仍失败则核对 Bundle ID 与控制台证书。

## 解决方案

- 引导用户开启通知权限。
- 登录后调用 `registerPush`；保留完整注册日志。
- 优先用生产环境包验证。
- 修正 Bundle ID / 证书匹配问题。

## 验证信号

- 日志出现 `deviceToken:` 与 `registerPush` 成功回调。
- 控制台可查到设备并离线测试可达。
