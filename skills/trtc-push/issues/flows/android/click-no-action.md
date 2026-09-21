# Android 通知点击无跳转排查流程

## 与 MCP 的关系

本文件是 **分支知识**，不拥有独立主链。

- ROUTER `workflow_id`：`troubleshoot-android`
- 主链 owner：`flows/android/offline-not-received.md`
- 本文件挂载：通知已展示后的点击分支（不替代 stage-1→6；收不到先走主链）
- 执行仍走上述 MCP workflow（进入后先过 `stage-0-investigation-plan`）；本文件不能替代 engine，也不能跳过主链门控（stage-1 有效性、stage-3 配置等）。
具体机制与修复动作见 `../../cards/android/notification-click-jump.md`；本 flow 负责入口分诊与步骤序。

## 入口现象

- 能收到且展示通知，点击后只打开首页或无反应。
- 控制台配置了「指定页面」但不生效。
- Flutter / Android / uni-app 点击回调未触发。

不适用于：根本收不到 → `offline-not-received.md`；已送达不弹 → `delivered-not-displayed.md`。

## 首轮证据

- 确认通知已展示（排除达而不显）。
- 控制台点击后续动作与跳转 / ext 参数。
- 点击回调是否在 Application 靠前注册。
- 厂商拉活权限（自启动 / 悬浮窗 / 后台弹出）。
- 冷启动 vs 热启动复测结果。
- 平台：Android 原生 / Flutter / uni-app。

## 排查顺序

0. 确认能收到且展示通知。
1. 控制台点击后续动作与跳转参数。
2. 点击回调注册时机（Application 靠前）。
3. 厂商拉活权限（自启动 / 悬浮窗 / 后台弹出）。
4. 冷启动复测。
5. 细节与代码路径 → `../../cards/android/notification-click-jump.md`。

## 分支处理

| 分支 | 判断信号 | 处理动作 |
|---|---|---|
| 未实现点击回调 | 无 listener / 无日志 | 按 card 实现回调并导航 |
| ext / Intent 不一致 | 控制台字段与路由表不符 | 对齐字段与 intent-filter |
| Flutter 桥接 | Dart 未接 `onNotificationClicked` | Flutter flow + card |
| 实际未展示 | 用户误报为点击问题 | `delivered-not-displayed.md` |
| 鸿蒙点击崩溃 | OHMUrl | `../harmonyos/offline-not-received.md` / ohmurl card |

## 验证信号

- 热启动与冷启动点击均进入目标页；回调日志字段完整。

## 何时升级 / 转交

- 回调已触发且参数正确，但系统仍无法拉起页面，需厂商拉活策略确认。
