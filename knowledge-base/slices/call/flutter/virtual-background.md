---
id: call/virtual-background
platform: flutter
tags: [virtual-background, background-blur, background-replace, TUICallEngine, setBlurBackground, setVirtualBackground, enableVirtualBackground]
api_docs:
  - title: TUICallEngine.setBlurBackground
    url: https://pub.dev/documentation/rtc_room_engine/latest/
  - title: TUICallEngine.setVirtualBackground
    url: https://pub.dev/documentation/rtc_room_engine/latest/
---

# 虚拟背景

## 功能说明

通话中对本地视频做背景处理，支持两种效果：
- **背景虚化**：模糊背景、保留人像清晰
- **背景替换**：用自定义图片替换真实背景

典型场景：视频问诊（保护隐私）、视频面试（隐藏居家环境）、居家办公（遮挡杂乱背景）。

## ⚠️ 当前结论（tencent_calls_uikit 5.0.0）

**UIKit 层未提供虚拟背景的 UI**，具体证据：

1. `TUICallKit.enableVirtualBackground(bool)` 是**占位接口**，只写一个 flag，无任何实际效果：
   ```dart
   // tui_call_kit_impl.dart:195
   Future<void> enableVirtualBackground(bool enable) async {
     GlobalState.instance.setEnableBlurBackground(enable);  // 只写 flag
   }
   ```
2. 这个 `_enableBlurBackground` flag 在包内**零消费**（无任何读取点）。
3. 按钮文案（`callShowBlurBackground`）已生成 9 种语言但**零引用**——按钮 UI 没写。
4. 通话界面控制按钮区是硬编码的 4 个按钮（麦克风/扬声器/摄像头/挂断），
   **无虚拟背景按钮，也无任何自定义按钮注入点**（`CallView` 构造参数仅 `isPipMode`/`enableAITranscriber`）。

因此：**在当前 UIKit 版本下，`enableVirtualBackground(true)` 不会出现按钮、也不会有虚化效果**。
这与模型文件版本、套餐、SDKAppID 无关，是 UI 层未实现。

## 底层能力（真实可用）

虚拟背景能力在 **engine 层**是真实可用的，位于 `rtc_room_engine` 包的 `TUICallEngine`：

```dart
// rtc_room_engine 4.2.0 / api/call/tui_call_engine.dart
Future<TUIActionCallback> setBlurBackground(int level);        // 背景虚化，level 强度
Future<TUIActionCallback> setVirtualBackground(String imagePath); // 背景替换，本地图片路径
```

这两个方法一路 FFI 到 native（`Dart_CallEngineCallAPI('setBlurBackground'...)`），
有 callback 返回，不是占位。若要使用需满足：

1. **显式依赖** `rtc_room_engine`（`tencent_calls_uikit` 不 re-export `TUICallEngine`）：
   ```yaml
   dependencies:
     rtc_room_engine: ^4.2.0
   ```
2. **自绘 UI**：自己写「虚化/替换」按钮，去调 `TUICallEngine.instance`。
3. **模型文件**：`LiteavSegmentModel` 需匹配 SDK 版本（当前原生 `LiteAVSDK_Professional 13.4.0.20477`）。
4. **套餐**：需开通含虚拟背景 AI 能力的套餐。

> 注意：这是「引擎层参考」，非「可集成 slice」。当前 skill **不提供**虚拟背景的集成模板，
> 因为 UIKit 无 UI、engine 层需自绘整套入口，超出了「叠加能力」的范畴。

## 关键约束

- 自定义图片必须是**本地文件路径**，不支持网络 URL
- 模型文件版本必须与 SDK 版本匹配，缺失时功能静默失效
- Professional 版本 SDK 体积比标准版大约 15MB（含 AI 模型）

## 排障指南

| 症状 | 原因 | 处理 |
|------|------|------|
| `enableVirtualBackground(true)` 无按钮无效果 | UIKit 5.0.0 占位接口，未实现 UI | 设计边界；改用 engine 层 API 自绘 |
| `setBlurBackground` 调用无效果 | 模型文件缺失/版本不匹配，或套餐未开通 | 核对模型版本 + 套餐 |
| `setVirtualBackground` 报错 | 传了网络 URL / 文件不存在 | 用本地绝对路径 |
| 找不到 `TUICallEngine` | 未显式依赖 `rtc_room_engine` | pubspec 加依赖并 import |

## 关联知识

- `call/device-control`（摄像头控制，虚拟背景前置——需摄像头已开启）
- [官方文档：虚拟背景](https://trtc.io/zh/document/60479?product=call&menulabel=uikit&platform=flutter)
