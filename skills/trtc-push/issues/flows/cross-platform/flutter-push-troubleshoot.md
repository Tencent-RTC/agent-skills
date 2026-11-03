---
doc_source:
  - faq-flutter-firebase
  - faq-flutter-kicked
  - faq-flutter-oppo-fcm
  - faq-flutter-click
  - faq-flutter-callkit
doc_revision: 4b280c73
---

# Flutter 推送排查流程

## 与 MCP 的关系

Flutter「收不到 / 注册失败」排障由 **MCP `troubleshoot-flutter`** 状态机固化：

| state | 主链步骤 |
|-------|----------|
| `stage-0-investigation-plan` | 排查计划确认（开场闸口） |
| `stage-1-console-validity` | 控制台有效性（服务 + 目标端证书） |
| `stage-2-pick-platform` | 测法与平台（collect） |
| `stage-2b-online-check` | 在线分支（stage-2 选在线通道时进入；不涉及厂商证书与 token 绑定） |
| `stage-3a-config-android` / `stage-3i-config-ios` | 配置对齐（verify） |
| `stage-4-register-observation` | registerPush 观测 |
| `stage-5-token-binding` | 推送 token 绑定 |
| `stage-6-offline-test` | 离线发测 |
| `stage-7-analyze` → `stage-9-final-report` | 分析 / 修复 / 结论 |

Flutter 问题几乎总是「Dart 层 + Android 原生 + iOS 原生」组合问题；本文件只保留路由与知识，不替代 stage 顺序。

## 分支处理

| 分支 | 判断信号 | 处理动作 |
|---|---|---|
| 在线通道收不到 | App 在前台才收不到通知，或 `onRecvPushMessage` 不触发 | MCP stage-2 选 `channel_path=online` → `stage-2b-online-check`；知识见 `../../cards/common/online-not-received.md` |
| 控制台无效 | 插件未开/到期、证书无效 | `../../cards/common/console-validity-gate.md`；MCP stage-1 |
| Android 收不到 | 仅 Android | `../android/offline-not-received.md` + `troubleshoot-android` |
| Android 注册失败 | registerPush failed | `../android/register-failed.md` |
| Android 厂商配置 | 包名/指纹/AGConnect | `../android/vendor-not-received.md` |
| Android 错误码 | `800005` 等 | `../../cards/android/error-codes.md` |
| Android 展示异常 | 已送达不弹 | `../android/delivered-not-displayed.md` |
| 点击无跳转 | 能收到不跳 | `../android/click-no-action.md` |
| iOS 收不到/证书/点击/展示 | 仅 iOS | `../ios/offline-not-received.md` + `troubleshoot-ios` |
| Firebase / FCM | `FCM unavailable` | `../../cards/android/fcm-gms-domestic.md` |
| 强杀无通知 | 进程杀死后 | `../../cards/android/kill-process-offline.md` 或 iOS flow |
| 鸿蒙 Flutter | 明确 HarmonyOS Flutter | 官网 Flutter 接入页有 HarmonyOS 页签（需用 Flutter-OH 构建，按页内 `dependency_overrides` 配置）；进入 `troubleshoot-harmony`，见 `../harmonyos/offline-not-received.md` |
| FCM 初始化报错 | `Default FirebaseApp is not initialized` | `../../cards/flutter/flutter-register-fcm-errors.md`（`google-services` 插件 / AGP 版本） |
| 注册后账号被踢 | `tencent_cloud_chat_push` 8.1+，调 `registerPush` 后被踢 | 同上 card：删除 `registerPush` 的 `sdkAppId` / `appKey` 参数 |
| OPPO 上 FCM 注册失败 | 配了 FCM 但 OPPO 机型 `registerPush` 失败 | 同上 card：`registerPush` 前先调 `setPushBrandId` 指定 FCM 通道 |
| 点击不触发 / 通话通知不跳转 | `onNotificationClicked` 不触发；TUICallKit 点击不跳转 | `../android/click-no-action.md`（含多进程、默认路径、自动登录） |

## 验证信号

- MCP stage-1 / 配置 stage 通过。
- registerPush 成功；能查到已绑定推送 token。
- 离线测试可达或回执可解释；点击回调正确（若相关）。

## 何时升级 / 转交

- 原生证据齐全仍无法解释厂商最后一跳。
- 鸿蒙 Flutter 按官网接入页配置后仍异常。
- 插件版本缺陷需 SDK 角色确认。
