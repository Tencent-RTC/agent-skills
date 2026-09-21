# 通知点击无法跳转

## 与 MCP 的关系

本文件是 **知识卡**，不拥有独立主链。

- ROUTER `workflow_id`：`troubleshoot-android`
- 关联 flow：`flows/android/click-no-action.md`
- 挂载：点击分支知识（通知已展示后）
- 执行仍走 MCP 状态机；命中本卡后按挂载阶段取证，禁止用本卡替代 `complete_workflow_step`。

## 适用现象

当用户反馈以下任一现象时，优先使用本卡：

- 能收到离线通知，点击后只是打开应用首页或无反应。
- 控制台配置了「指定页面」但不生效。
- Flutter/Android 点击回调未触发。

不适用于：

- 根本收不到通知 → `../../flows/android/offline-not-received.md` /
  `../../flows/android/delivered-not-displayed.md`。
- 入口分诊与 Catalog 点击主链步骤 → `../../flows/android/click-no-action.md`。

## 共同根因

点击跳转依赖客户端点击回调或 Intent/deeplink 路由消费扩展字段；仅配置控制台文案而不实现回调，或 ext 字段与路由表不一致，会导致无法到达指定页。

常见错误模式：

- 未实现 TIMPush 通知点击监听。
- Android `intent` / scheme 未注册。
- Flutter 只测了推送到达，未测 `onNotificationClicked`。

## 必须收集的证据

- 平台（Android 原生 / Flutter / uni-app）。
- 点击后实际行为与期望页面。
- 推送 ext / 跳转字段内容。
- 是否实现官方点击回调 API。
- 相关 Activity/路由注册证据。

## 排查步骤

1. 确认通知确实展示（排除达而不显）。
2. 核对是否实现点击回调并打日志。
3. 核对 ext 与路由配置一致。
4. 真机点击复现并抓回调日志。

## 解决方案

- 按平台文档实现点击回调，并在回调内导航。
- 对齐控制台/REST 扩展字段与客户端路由。
- 补充 intent-filter 或 Flutter/uni-app 对应桥接。

## 验证信号

- 点击后稳定进入目标页面，回调日志字段完整。
