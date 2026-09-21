# iOS 点击通知无跳转 / ext 为空 / 回调异常

## 与 MCP 的关系

本文件是 **知识卡**，不拥有独立主链。

- ROUTER `workflow_id`：`troubleshoot-ios`
- 关联 flow：`flows/ios/offline-not-received.md`
- 挂载：点击跳转子链知识
- 执行仍走 MCP 状态机；命中本卡后按挂载阶段取证，禁止用本卡替代 `complete_workflow_step`。

## 适用现象

当用户反馈以下任一现象时，优先使用本卡：

- iOS 点击通知后 `ext` 为空 / 拿不到推送自定义内容。
- 点击能打开 App，但进不到指定页面。
- Flutter iOS 端 `onNotificationClicked` / AppDelegate `onRemoteNotificationReceived`
  被重复回调。

不适用于：

- 通知根本没有展示 → `../../flows/ios/offline-not-received.md` 的 display 子链。
- Android / 跨端点击机制（intent-filter、路由表）→
  `../../cards/android/notification-click-jump.md`。

## 共同根因

iOS 点击跳转依赖「发送侧写入自定义字段 + 客户端在正确回调路径解析」两段同时成立。
发送侧未设 `OfflinePushInfo.ext` 时 APNs payload 没有自定义字段，客户端怎么解析都为空；
字段有了但回调路径不对（冷启动 / 热启动不分、回调注册太晚），同样拿不到或拿不到时 App
已经完成路由。Flutter 重复回调多为插件 listener 重复注册或 AppDelegate 方法被多次转发。

常见错误模式：

- 只测了「能收到通知」，没核对发送消息时是否带 `ext`。
- 用在线消息验证点击，但离线 APNs 消息未设 `OfflinePushInfo`。
- 回调注册在首页 `viewDidLoad` 之后，冷启动时通知数据已被消费。

## 必须收集的证据

- 发送侧消息体：`OfflinePushInfo.desc` / `ext` 是否设置（REST 或控制台）。
- 点击时 App 状态：冷启动（杀进程）还是热启动（后台）。
- 客户端回调注册位置与日志：`didReceiveNotificationResponse` /
  TIMPush 点击回调是否触发、payload 内容。
- Flutter：listener 注册次数、插件与 IMSDK 版本。

## 排查步骤

1. 确认通知已展示（未展示先回 display 子链）。
2. 核对发送侧：`ext` 为空先查发送参数，而不是客户端代码。
3. 区分冷启动 / 热启动复测：冷启动走 `launchOptions` 路径，热启动走
   `didReceiveNotificationResponse`，回调必须早于首页路由注册。
4. Flutter 重复回调：核对 listener 注册时机与次数；双端桥接问题走
   `../../flows/cross-platform/flutter-push-troubleshoot.md`。
5. 字段与回调都正确仍无跳转，核对客户端路由解析逻辑。

## 解决方案

- 发送侧为离线消息补 `OfflinePushInfo.desc` 与 `ext`（自定义消息必须设 desc）。
- 客户端在 App 启动早期注册点击回调，并按冷 / 热启动两条路径解析 payload。
- Flutter：保证 listener 只注册一次；异常重复回调保留插件版本与堆栈，升级 SDK 角色确认。

## 验证信号

- 冷启动与热启动点击均进入目标页。
- 回调日志中 `ext` 字段与发送侧一致，单次点击只触发一次回调。
