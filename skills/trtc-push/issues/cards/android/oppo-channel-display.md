# OPPO ChannelID / 通知栏不展示

## 与 MCP 的关系

本文件是 **知识卡**，不拥有独立主链。

- ROUTER `workflow_id`：`troubleshoot-android`
- 关联 flow：`flows/android/delivered-not-displayed.md`
- 挂载：主要挂展示分支 / `stage-6`
- 执行仍走 MCP 状态机；命中本卡后按挂载阶段取证，禁止用本卡替代 `complete_workflow_step`。

## 适用现象

当用户反馈以下任一现象时，优先使用本卡：

- OPPO / realme / OnePlus 设备离线推送收不到或不弹通知。
- 其他厂商正常，仅 OPPO 系异常。
- 日志或回执显示发送成功，但通知栏无展示。
- 自定义消息在 OPPO 上无离线通知。

不适用于：

- 华为 `800006` / 指纹问题 → `vendor-huawei.md`。
- 厂商明确黑名单/未上架（小米·vivo）→ `xiaomi-vivo-store-channel.md`。
- 日限额「只能收到几条」→ `message-category-limit.md`。

## 共同根因

OPPO Android 8.0+ 要求有效的通知 ChannelID，否则系统可不展示；OPPO 安装后通知权限常默认关闭；自定义消息若未设置 `OfflinePushInfo.desc` 则默认不推；desc 过长也可能被截断或拒展。

常见错误模式：

- 未调用 `setAndroidOPPOChannelID`，或 Channel 未在 App 内创建。
- 系统设置里应用通知关闭。
- 自定义消息只发了内容，未设 `desc`。
- 用非 OPPO 真机验证 OPPO 通道。

## 必须收集的证据

- 测试机是否为 OPPO 系，且已强杀后测离线。
- 是否配置 ChannelID；客户端创建 Channel 的代码/截图。
- 系统通知权限开关状态。
- 发送侧 `offlinePushInfo`（含 desc / OPPO channel）。
- 控制台或厂商回执（TaskId / messageId）。

## 排查步骤

1. 确认设备品牌匹配，走 `troubleshoot-android` 收配置与日志。
2. 核对 ChannelID 是否下发且 App 内已创建对应 channel。
3. 核对通知栏权限。
4. 自定义消息确认 `desc`；过长则缩短重试。
5. 若回执成功仍不展示，转 `../../flows/android/delivered-not-displayed.md`。

## 解决方案

- 按文档设置 OPPO ChannelID，并在应用内创建同名通知渠道。
- 引导用户打开「设置 > 通知 > 应用通知」。
- 自定义消息补齐 `desc`；控制文案长度。
- REST/控制台测试时带上与线上一致的离线字段。

## 验证信号

- 强杀 App 后，控制台离线测试在 OPPO 通知栏可见。
- 同一 RegistrationID 连续测试可重复触达（排除限额类问题）。
