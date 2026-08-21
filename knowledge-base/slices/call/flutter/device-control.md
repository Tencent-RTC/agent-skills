---
id: call/device-control
platform: flutter
tags: [device, camera, microphone, volume, DeviceStore, openLocalCamera, closeLocalCamera, switchCamera, openLocalMicrophone, closeLocalMicrophone]
api_docs:
  - title: DeviceStore
    url: https://pub.dev/documentation/tencent_calls_uikit/latest/
---

# 设备控制

## 功能说明

通话中对摄像头和麦克风进行开关、切换，以及调节采集/播放音量。典型场景包括：
视频通话中临时关闭摄像头（隐私保护）、切换前后置镜头（展示环境）、
语音通话中静音麦克风（开会场景）。

要求 SDK 版本 `tencent_calls_uikit >= 5.0.0`（使用 `DeviceStore.shared` API，
来自 transitive 依赖 `atomic_x_core`）。

## 核心概念

### DeviceStore 单例

所有设备操作通过 `DeviceStore.shared` 调用，它是 `atomic_x_core` 包提供的全局单例。
**不是** `TUICallKit.instance` 的方法，而是独立的设备管理入口。

### 登录依赖

DeviceStore 内部依赖 SDK 登录状态。必须在 `CallService.instance.loginWithSig` 成功后
才能调用任何设备方法，否则行为未定义。`DeviceControl` 工具类已内置此检查。

### 权限依赖

| 设备 | iOS 权限 | Android 权限 | 配置时机 |
|------|----------|-------------|---------|
| 摄像头 | `NSCameraUsageDescription` | `android.permission.CAMERA` | basic-call Phase 2（q3 含 video 时自动配置）|
| 麦克风 | `NSMicrophoneUsageDescription` | `android.permission.RECORD_AUDIO` | basic-call Phase 2（所有场景自动配置）|

### 与 audio-route 的边界

扬声器/听筒切换（`setAudioRoute`）由 optional-tweaks 的 `audio-route` 项覆盖，
本 slice 不包含该功能。需要切换音频输出设备时，参见基础通话微调菜单。

## 前置条件

- 已完成 basic call 集成（`lib/trtc_call/call_service.dart` 存在）
- `CallService.instance.isLoggedIn == true`
- [视频场景] iOS Info.plist 含 `NSCameraUsageDescription` + Android Manifest 含 `CAMERA`
- [所有场景] iOS Info.plist 含 `NSMicrophoneUsageDescription` + Android Manifest 含 `RECORD_AUDIO`

## 集成步骤

### Step 1 — INSTALL 模板文件

```
INSTALL templates/lib/trtc_call/device_control.dart
     → lib/trtc_call/device_control.dart
```

### Step 2 — 在业务代码中使用

```dart
import 'trtc_call/device_control.dart';

// 视频通话场景：开启前置摄像头
await DeviceControl.openCamera();

// 切换到后置
await DeviceControl.switchCamera(isFront: false);

// 关闭摄像头（隐私）
await DeviceControl.closeCamera();

// 麦克风控制
await DeviceControl.openMicrophone();
await DeviceControl.closeMicrophone();

// 音量调节
await DeviceControl.setCaptureVolume(80);
await DeviceControl.setOutputVolume(60);
```

无需 PATCH 现有文件。用户在自己的通话 UI（工具栏按钮、设置面板等）中调用即可。

## 最佳实践

### ✅ ALWAYS

- **必须在登录成功后再调用设备方法** —— DeviceStore 依赖 SDK 内部登录态，
  未登录时调用结果不可预期，可能静默失败或返回无意义错误码。
- **必须处理 DeviceControlError** —— 权限缺失（-1101/-1105）是最常见的运行时错误，
  应向用户展示明确提示并引导去系统设置开启权限，不要静默忽略。
- **必须在通话结束或页面退出时关闭设备** —— 不关闭会导致摄像头指示灯常亮、
  麦克风持续占用，用户投诉"偷拍"或其他 App 无法使用设备。

### ❌ NEVER

- **绝不要在登录前调用 DeviceControl 方法** —— 即使 SDK 不崩溃，
  操作也不会生效。即使"只是想预热摄像头"，也不可以——SDK 内部状态未就绪。
- **绝不要把音量值设为 [0, 100] 范围外** —— 部分平台 SDK 对越界值行为未定义，
  可能导致音频异常。即使"150 是为了更大声"，也不可以——`DeviceControl` 已自动 clamp。
- **绝不要用 DeviceControl 做音频路由切换** —— 扬声器/听筒切换有独立的 API
  （`setAudioRoute`），已在 optional-tweaks 中提供。混用会导致状态不一致。

## 排障指南

### 常见错误码

| 错误码 | 含义 | 常见原因 | 处理动作 |
|--------|------|---------|---------|
| -1 | 未登录 | 在 CallService.loginWithSig 之前调用 | 等登录成功后再操作设备 |
| -1101 | 摄像头权限缺失 | Info.plist/Manifest 未声明或用户拒绝 | 引导用户去系统设置开启摄像头权限 |
| -1102 | 摄像头被占用 | 其他 App 正在使用摄像头 | 提示用户关闭占用摄像头的 App |
| -1103 | 无摄像头 | 设备没有摄像头硬件 | 提示"当前设备不支持视频通话" |
| -1105 | 麦克风权限缺失 | 同 -1101 | 引导用户去系统设置开启麦克风权限 |
| -1106 | 麦克风被占用 | 同 -1102 | 提示用户关闭占用麦克风的 App |
| -1107 | 无麦克风 | 设备没有麦克风 | 提示"当前设备不支持语音通话" |

### 排障流程

症状：调用 openCamera/openMicrophone 后无反应或报错

```
├─ DeviceControlError code = -1？
│   ├─ 是 → CallService.instance.isLoggedIn 为 false，先完成登录
│   └─ 否 → 继续
├─ code = -1101 / -1105（权限缺失）？
│   ├─ 是 → 检查 Info.plist / AndroidManifest 是否声明权限
│   │        检查用户是否在系统设置中拒绝了权限
│   └─ 否 → 继续
├─ code = -1102 / -1106（设备被占用）？
│   ├─ 是 → 检查是否有其他 App 占用；iOS 后台切回时系统可能释放设备
│   └─ 否 → 继续
├─ 摄像头打开但画面黑屏？
│   ├─ isFront 参数是否正确（模拟器无前置摄像头）
│   └─ Android 模拟器不支持摄像头，需真机测试
└─ 都正常但仍有问题 → 检查 SDK 版本 >= 5.0.0，升级 tencent_calls_uikit
```

## 关联知识

- `call/basic-call`（基础通话，本 slice 的前置依赖）
- optional-tweaks §audio-route（音频路由切换，不在本 slice 范围）

---

## 集成执行

> AI 帮用户跑 device-control 集成时按本节执行（步骤顺序不可调换）。
> 用户只是查询功能时读上方知识节即可，无需执行本节。

### E1 — 确认场景

从 session `q3_media_type` 读取（Phase 1a 已选择）。
若 session 无此字段（slice 单独触发），`AskUserQuestion` 单选：

> 你的通话场景包含视频吗？（决定是否展示摄像头控制用法）

| # | label | value |
|---|---|---|
| 1 | 有视频通话 | `video` |
| 2 | 纯语音通话 | `audio` |

写 `slice_device_control.media_type = <value>`，进 E2。

### E2 — INSTALL template

```
INSTALL templates/lib/trtc_call/device_control.dart
     → lib/trtc_call/device_control.dart
```

汇报：`[1/1] lib/trtc_call/device_control.dart ✔`

### E3 — Verify + 用法展示

**Verify**：

```bash
flutter analyze --no-pub
```

确认 0 error。

Grep 检查：
- `lib/trtc_call/device_control.dart` 存在
- 文件含 `class DeviceControl`
- 文件含 `import 'package:atomic_x_core/atomicxcore.dart'`

**展示用法**（按 media_type 裁剪）：

media_type = `video`：

> 设备控制已就绪。在你的通话 UI 中这样使用：
>
> ```dart
> import 'trtc_call/device_control.dart';
>
> // 开启/关闭摄像头
> await DeviceControl.openCamera();       // 前置
> await DeviceControl.closeCamera();
> await DeviceControl.switchCamera(isFront: false);  // 切后置
>
> // 开启/关闭麦克风
> await DeviceControl.openMicrophone();
> await DeviceControl.closeMicrophone();
>
> // 音量调节 [0, 100]
> await DeviceControl.setCaptureVolume(80);
> await DeviceControl.setOutputVolume(60);
> ```
>
> 注意事项：
> 1. 必须在登录成功后调用
> 2. 处理 `DeviceControlError` 做权限缺失提示
> 3. 扬声器/听筒切换 → 见微调菜单的"默认扬声器/听筒"

media_type = `audio`：

> 设备控制已就绪。在你的通话 UI 中这样使用：
>
> ```dart
> import 'trtc_call/device_control.dart';
>
> // 开启/关闭麦克风
> await DeviceControl.openMicrophone();
> await DeviceControl.closeMicrophone();
>
> // 音量调节 [0, 100]
> await DeviceControl.setCaptureVolume(80);
> await DeviceControl.setOutputVolume(60);
> ```
>
> 注意事项：
> 1. 必须在登录成功后调用
> 2. 处理 `DeviceControlError` 做权限缺失提示
> 3. 扬声器/听筒切换 → 见微调菜单的"默认扬声器/听筒"
> 4. 如需摄像头控制（切换到视频通话），`DeviceControl.openCamera()` 同样可用

写 session `active_slice = null`，`active_flow = playbook-done`，回 Phase 7 菜单。
