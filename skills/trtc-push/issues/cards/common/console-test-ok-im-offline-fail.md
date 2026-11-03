---
doc_source:
  - faq-common-console-ok-im-offline
doc_revision: 4246cc45
---

# 控制台测试推送成功，但 IM 消息离线收不到

## 与 MCP 的关系

本文件是 **知识卡**，不拥有独立主链。

- ROUTER `workflow_id`：`troubleshoot-android`
- 关联 flow：`flows/android/offline-not-received.md` / `flows/ios/offline-not-received.md`
- 挂载：主要挂 `stage-5-token-binding` / `stage-6-offline-test`
- 执行仍走 MCP 状态机；命中本卡后按挂载阶段取证，禁止用本卡替代 `complete_workflow_step`。

## 适用现象

当用户反馈以下任一现象时，优先使用本卡：

- 控制台「接入测试」能收到推送，但两个账号互发 IM 消息，接收方 App 在后台或被强制停止后收不到通知。
- 「控制台测试成功，业务消息收不到」。

不适用于：

- 控制台测试本身就失败 → 对应平台 `offline-not-received` flow。
- 控制台提示 RegistrationID / UserID 不存在 → `registration-binding.md`。
- 在线（前台）收不到 → `online-not-received.md`。

## 共同根因

接入测试成功只说明推送通道是通的，**不代表 IM 消息满足离线推送的条件**。IM 消息的离线推送还取决于：发送端是否传入推送信息、接收方是否完成绑定、套餐是否支持该能力。

常见错误模式：

- 发送端 `sendMessage` 没有传 `V2TIMOfflinePushInfo`，或 `title` 和 `desc` 都为空、`disablePush` 为 `true`。
- 自定义消息没有设置 `desc`（不设置默认不推送）。
- 接收方退出 IM 登录后绑定失效，没有重新登录并再次 `registerPush`。
- 当前套餐不支持 IM 聊天消息通知能力。

## 必须收集的证据

- 测试时接收方 App 的状态（后台 / 已杀进程）。
- 发送端 `sendMessage` 传入的 `V2TIMOfflinePushInfo`：`title`、`desc`、`disablePush`；自定义消息必须设置 `desc`。
- 接收方是否曾 IM 登录并完成 `registerPush`，是否中途退出过登录。
- 当前套餐版本。
- 推送记录里这条消息是否存在（Push ID）。

## 排查步骤

按以下顺序逐项确认（以官网 FAQ 为准）：

1. 确认当前套餐支持 IM 聊天消息通知能力，以官网计费说明为准。
2. 确认测试时接收方 App 已置于后台或已杀进程。
3. 确认发送端传入了有效 `V2TIMOfflinePushInfo`：`title` 和 `desc` 至少一个不为空，`disablePush` 为 `false`；自定义消息必须设置 `desc`。
4. 确认接收方曾 IM 登录并完成 `registerPush`，设备 Token 已绑定该 UserID；用户退出登录后绑定失效，需重新登录并再次调用 `registerPush`。
5. 在推送记录中找到这条推送，用排查工具查看全链路状态，再按官网《排查流程》处理。

## 解决方案

处理动作以官网 FAQ「控制台测试推送成功，但 IM 消息离线收不到，如何处理？」为准。要点：补齐发送端推送信息、重新登录并 `registerPush`、必要时升级套餐。

## 验证信号

- 接收方 App 在后台或被强制停止，对端发一条 IM 消息，接收方收到通知。
- 推送记录里能查到这条消息，且链路状态可解释。
