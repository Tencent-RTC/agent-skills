---
doc_source:
  - faq-flutter-firebase
  - faq-flutter-kicked
  - faq-flutter-oppo-fcm
doc_revision: 62b27b22
---

# Flutter registerPush 常见错误（FCM 初始化 / 账号被踢 / OPPO 误走本机通道）

## 与 MCP 的关系

本文件是 **知识卡**，不拥有独立主链。

- ROUTER `workflow_id`：`troubleshoot-flutter`
- 关联 flow：`flows/cross-platform/flutter-push-troubleshoot.md`
- 挂载：主要挂 `stage-4-register-observation`
- 执行仍走 MCP 状态机；命中本卡后按挂载阶段取证，禁止用本卡替代 `complete_workflow_step`。

## 适用现象

当用户反馈以下任一现象时，优先使用本卡：

- Flutter 调用 `registerPush` 报 `Default FirebaseApp is not initialized in this process ... Make sure to call FirebaseApp.initializeApp(Context) first.`
- 接入 `tencent_cloud_chat_push` 8.1 及以上后，调用 `registerPush` 登录账号被踢出或推送异常。
- 配置了 FCM，但在 OPPO 机型上 `registerPush` 提示推送注册失败。

不适用于：

- 原生 Android 的 FCM / GMS 问题 → `../android/fcm-gms-domestic.md`。
- 点击通知不触发 `onNotificationClicked`、TUICallKit 点击通知不跳转 → 以官网 FAQ 对应问题为准（ROUTER 已有 link-only 路由）。

## 共同根因

三种现象互相独立，各有明确根因（以官网 FAQ 为准）：

| 现象 | 根因 |
|---|---|
| `Default FirebaseApp is not initialized` | Google Services Gradle Plugin 未正确应用，或与当前 Android Gradle Plugin（AGP）版本不兼容，Firebase 未完成初始化 |
| 8.1+ 调用 `registerPush` 后账号被踢出 | `registerPush` 传入了 8.1 及以上版本不再需要的 `sdkAppId` 和 `appKey` 参数 |
| OPPO 设备注册 FCM 失败 | 插件内部默认走 OPPO 通道，没有指定 FCM 通道 |

## 必须收集的证据

- `tencent_cloud_chat_push` 版本。
- `registerPush` 的完整调用代码（是否传了 `sdkAppId` / `appKey`）。
- 完整报错与设备品牌。
- Android 工程：AGP 版本、是否应用 `com.google.gms.google-services` 插件及其版本、`google-services.json` 是否属于当前应用。
- OPPO 场景：`registerPush` 前是否调用过 `setPushBrandId`。

## 排查步骤

1. 按报错归到上表三种之一；都不是则回 `flutter-push-troubleshoot.md`。
2. FirebaseApp：核对应用模块已启用 `com.google.gms.google-services` 插件，`google-services.json` 属于当前应用；AGP 7.3.0 及以上可使用 `com.google.gms:google-services:4.4.2`，低于 7.3.0 使用与 AGP 兼容的版本（例如 `4.3.15`）。
3. 账号被踢：只要版本是 8.1 及以上，检查 `registerPush` 是否仍传 `sdkAppId` / `appKey`。
4. OPPO 注册 FCM 失败：检查 `registerPush` 之前是否调用 `setPushBrandId` 指定 FCM 通道。

## 解决方案

处理动作以官网 FAQ 对应问题为准，要点：

- FirebaseApp：应用并对齐 Google Services 插件版本，确认配置文件正确。
- 账号被踢：删除 `registerPush` 的 `sdkAppId` 和 `appKey` 参数。
- OPPO 走 FCM：`registerPush` 前必须调用 `setPushBrandId` 指定 FCM 通道。

## 验证信号

- `registerPush` 成功，`getRegistrationID` 非空。
- 登录状态保持，未被踢出。
- OPPO 设备上 FCM 通道注册成功。
