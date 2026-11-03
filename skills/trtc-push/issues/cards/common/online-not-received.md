---
doc_source:
  - ts-by-type
  - ts-common-prereq
  - faq-android-online-callback
  - faq-android-online-not-offline
doc_revision: 6266ffa6
---

# 在线（前台）收不到通知 / onRecvPushMessage 不触发

## 与 MCP 的关系

本文件是 **知识卡**，不拥有独立主链。

- ROUTER `workflow_id`：无（本卡是在线问题的知识来源；不要为在线问题启动 MCP 离线主链）
- 关联 flow：离线也收不到时转 `flows/android/offline-not-received.md` / `flows/ios/offline-not-received.md`
- 挂载：MCP `troubleshoot-*` 的 `stage-2b-online-check`（stage-2 判定 `channel_path=online` 时进入；该阶段的检查项与本卡「排查步骤」一致，不调用 push-server 工具，完成后直接进 stage-8）
- 在线通知由 TIMPush 本地决定是否弹出，**不经过厂商通道、不需要厂商证书、不受手机品牌限制**；不要把厂商配置排查带进来。

## 适用现象

当用户反馈以下任一现象时，优先使用本卡：

- App 在前台时收不到通知栏通知，切后台后（离线）反而能收到。
- 在线场景收不到 `TIMPushListener.onRecvPushMessage` 回调。
- 「在线推送收不到」「前台不弹通知」。

不适用于：

- App 在后台或被强制停止时收不到 → 离线链路，走对应平台 `offline-not-received` flow 和 `troubleshoot-*`。
- 完全没有 `registerPush` 成功记录 → 先走 `registration-binding.md`。

## 共同根因

在线通知是否弹出、回调是否触发，取决于下面几处，都在 SDK 与发送端，不在厂商侧：

1. **前台通知开关**：未调用时的默认行为取决于场景（见下）；已调用并传 `true / YES` 时前台不弹是预期行为。
2. **发送端推送信息**：`sendMessage` 未传 `V2TIMOfflinePushInfo`，或其 `title`、`desc` 都为空，不弹通知；`title`、`desc`、`ext` 都为空时不触发 `onRecvPushMessage`。
3. **版本不一致**：TIMPush 基于 IM SDK 封装，两者版本需一致，否则可能出现 `onRecvPushMessage` 收不到。
4. **公共前提缺失**：SDKAppID 未开通 Push、`registerPush` 未成功、非真机或应用系统通知权限未开（Android 13+ 需运行时申请，OPPO 等品牌默认关闭）。

前台通知开关默认行为（以官网《排查流程》为准）：

- 只用 Chat、或 Chat 与 Push 混用（用 IM UserID 注册推送）：前台**默认不弹**，需调用 `disablePostNotificationInForeground` 并传 `false / NO` 开启。
- 单独使用 Push、未登录 IM：前台默认弹通知。

## 必须收集的证据

- 推送类型：「消息服务推送」（IM 发消息触发）还是「全员 / 标签 / 指定用户推送」。
- 接收方 App 当时是否在**前台**。
- 测试时发送方和接收方是否用了**两个不同的 UserID**（同一 UserID 两台设备互发，收到的是多端同步，不会弹通知）。
- 是否调用过前台通知开关（Android / iOS），传的是什么。
- 场景：只用 Chat / Chat 与 Push 混用 / 单独 Push。
- 发送端 `V2TIMOfflinePushInfo` 的 `title`、`desc`、`ext`、`disablePush`。
- TIMPush 与 IM SDK 版本号。
- `registerPush` 是否成功、设备通知权限状态。

## 排查步骤

1. 确认现象确实是**在线**：测在线时必须让 App 停在前台。在线通知**不会出现在推送记录里，无法用排查工具查询**，不要引导用户去查推送记录。
2. 公共前提：Push 已开通、`registerPush` 成功、真机、通知权限已开。
3. 前台通知开关：按上面「默认行为」判断是否需要调用并传 `false / NO`。
4. 发送端推送信息：消息服务推送必须传 `V2TIMOfflinePushInfo`，`title` 或 `desc` 至少一个不为空。
5. `onRecvPushMessage` 收不到：核对 `title`、`desc`、`ext` 不全为空；核对 TIMPush 与 IM SDK 版本一致。
6. 以上都满足，仍收不到：收集证据后按官网《排查流程》引导，必要时提交工单。

## 解决方案

具体接口调用以官网 FAQ「能收到离线推送但收不到在线推送，如何处理？」「在线时收不到 onRecvPushMessage 回调，如何处理？」和《排查流程》「收不到在线通知」为准，这里只保留判断要点：

- 需要前台弹通知：调用前台通知开关并传 `false / NO`。
- 发送端补齐并正确设置 `V2TIMOfflinePushInfo`。
- 对齐 TIMPush 与 IM SDK 版本。

## 验证信号

- App 在前台，用两个不同 UserID 互发消息，接收方弹出通知。
- `onRecvPushMessage` 能收到回调。
