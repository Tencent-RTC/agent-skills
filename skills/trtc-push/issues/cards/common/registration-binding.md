# RegistrationID / UserID 设备绑定问题

## 适用现象

当用户反馈以下任一现象时，优先使用本卡：

- 控制台接入测试提示 `RegistrationID` 或 `UserID` 不存在。
- 批量导入 IM 用户后，消息可收发但离线推送不可用。
- `getRegistrationID()` 返回值、控制台设备记录或 Push DAU 与预期不一致。
- 已接入 TIMPush，但无法证明真机完成了 IM 登录后的 Push 注册链路。

不适用于厂商通道已返回成功但终端不展示通知的场景；那类问题走
`../../flows/android/delivered-not-displayed.md`。

## 共同根因

Push 是设备级能力。只有真机完成 IM 登录并注册 TIMPush 后，设备 token 才会上报并
绑定到目标 UserID / RegistrationID。批量导入 IM 用户只是在 IM 后台创建用户记录，
不会创建设备记录。

常见错误模式：

- 在 IM `login` 成功前调用 `registerPush` / `registerTIMPush`。
- 未在注册 Push 前调用 `setRegistrationID(<IM UserID>)`。
- 用后台导入的 UserID 直接在控制台测试 Push，但该用户从未在真机上注册过 Push。
- 把厂商 token、长 regId、设备 ID 和 TIMPush `RegistrationID` 混用。

## 必须收集的证据

- IM `login` 成功日志。
- `setRegistrationID` 调用入参及调用时机。
- `registerPush` / `registerTIMPush` 成功或失败回调。
- `getRegistrationID = <非空值>`。
- `pushLogin success`。
- `Set offline push token successfully`。
- `setOfflinePushConfig businessID = <证书 ID>`。
- 控制台应用 `SDKAppID`、推送类型（在线 / 离线）、测试 UserID / RegistrationID。

不要在缺少上述证据时默认判断“用户复制错 ID”。

## 排查步骤

1. 先确认用户测试的是在线推送、离线推送还是控制台接入测试。
2. 确认测试账号是否在真机上完成过 IM `login`。
3. 确认 `setRegistrationID` 是否在 `registerPush` 前执行，且入参是业务期望绑定的
   IM UserID。
4. 确认 `registerPush` / `registerTIMPush` 是否成功回调。
5. 确认 `getRegistrationID` 返回值非空，并与控制台测试使用的 ID 类型一致。
6. 确认 offline token 已上报，且 `businessID` / 证书 ID 属于当前 `SDKAppID`。
7. 如果注册链路完整但控制台仍查不到，继续排查控制台应用维度、证书 ID、同步延迟或
   服务端排查工具结果。

## 解决方案

- 正确链路应为：IM `login` 成功 → `setRegistrationID(<IM UserID>)` →
  `registerPush` / `registerTIMPush` → `getRegistrationID` → 控制台测试。
- 批量导入 IM 用户后，如需离线推送，仍需用户在真机登录并注册 TIMPush。
- 如果已经错误注册为设备 ID，需按当前 SDK 的注销 / 重新注册流程清理旧绑定，再用
  正确 UserID 注册。

## 验证信号

- 日志中出现 `pushLogin success`。
- 日志中出现 `Set offline push token successfully`。
- `getRegistrationID` 非空。
- 控制台排查工具能查到目标 UserID / RegistrationID 的设备记录。
- App 被强杀后，用同一 UserID 发送离线消息能收到厂商通知。
