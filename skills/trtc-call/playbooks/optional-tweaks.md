# optional-tweaks

用户要求某项微调时，Read 对应节，按 `PATCH AT anchor` 指令执行 `Edit`，完成后汇报 `[微调名] ✔`。每节自包含，按需取用。`⚠️ 暂不支持` 的项直接告知用户原因，不生成代码。

---

## set-self-info — 设置对方看到的昵称和头像

**用途**：来电界面 / 通话中界面显示发起方的昵称和头像图片。不设置则显示空白或默认头像。

**API**：`TUICallKit.instance.setSelfInfo(String nickname, String avatarUrl)`

**插入位置**：`TencentCallSdkAdapter.login` 内，`TUICallKit.instance.login(...)` 成功后（`if (!result.isSuccess)` 检查之后、方法返回之前）

```
// PATCH lib/trtc_call/call_service.dart
// AT:  class TencentCallSdkAdapter 的 login 方法内，if (!result.isSuccess) { ... } 之后
// 插入：
await TUICallKit.instance.setSelfInfo(
  '<你的昵称>',
  '<头像图片 URL，https://... 或留空>',
);
```

**参数说明**：
- `nickname`：字符串，显示在来电界面。留空 `''` 则显示 userId
- `avatar`：HTTPS 图片 URL（或空字符串）。本地文件路径不支持
- 返回 `CompletionHandler`（`isSuccess` / `errorCode` / `errorMessage`），可不 await 直接 fire-and-forget

**注意**：每次登录后调用一次即可，无需在每次通话前重复调用。

---

## call-timeout — 呼叫超时自动挂断

**用途**：发起通话后若对方在 N 秒内无应答，自动取消通话并回调 `CallEnd`。默认 30 秒。

**API**：在 `CallSdkAdapter`、`TencentCallSdkAdapter` 和 `CallService` 的 `startCall` / `startGroupCall` 调用链增加 timeout，并在生产 adapter 构造 `CallParams(timeout: N)`

**1v1 通话（`startCall`）**

当前 `startCall` 没传 params，需同步修改 interface、生产 adapter 和 service 的方法签名，不能只改一层：

```
// PATCH lib/trtc_call/call_service.dart
// AT:  CallSdkAdapter、TencentCallSdkAdapter、CallService 中的 startCall
// 改签名为：
Future<void> startCall(String userId, CallMediaType mediaType, {int timeoutSeconds = 30})

// AT:  TencentCallSdkAdapter.startCall 内的 TUICallKit.instance.calls
// 改为：
TUICallKit.instance.calls([userId], mediaType, CallParams(timeout: timeoutSeconds))
```

**多人通话（`startGroupCall`）**

`CallParams` 已传入；同样先把 timeout 参数贯穿 interface、生产 adapter 和 service，再在现有 params 上加字段：

```
// PATCH lib/trtc_call/call_service.dart
// AT:  final params = CallParams(chatGroupId: chatGroupId);
// 改为：
final params = CallParams(chatGroupId: chatGroupId, timeout: 30);
```

**Call site 使用**：

```dart
// 60 秒超时
await CallService.instance.startCall(userId, CallMediaType.audio, timeoutSeconds: 60);
```

**注意**：`timeout` 只控制响铃等待阶段（发起到接听），**不控制通话时长上限**。通话中的时长限制需要业务侧自行计时挂断。

---

## audio-route — 通话中切换扬声器 / 听筒

**用途**：语音通话接通后，默认走听筒（私密）；视频通话接通后，默认走扬声器。可按需覆盖默认。

**API**：`DeviceStore.shared.setAudioRoute(AudioRoute.speakerphone)` / `AudioRoute.earpiece`

**重要约束**：只能在通话**接通后**调用（媒体流激活之后）。在 app 启动时或发起通话前调用无效。

**插入位置**：在 `CallButton._onPressed()` 里，`CallService.instance.startCall(...)` await 返回后。

```
// PATCH lib/trtc_call/call_button.dart
// AT:  import 'package:tencent_calls_uikit/tencent_calls_uikit.dart'; 之后加 import
import 'package:atomic_x_core/atomicxcore.dart';

// AT:  await (widget.service ?? CallService.instance).startCall(...); 之后
DeviceStore.shared.setAudioRoute(AudioRoute.speakerphone); // 或 AudioRoute.earpiece
```

**enum 值**：
| value | 说明 |
|---|---|
| `AudioRoute.speakerphone` | 扬声器（外放）|
| `AudioRoute.earpiece` | 听筒（贴耳私密）|

**注意**：若用户戴了蓝牙耳机，`setAudioRoute` 调用无效——蓝牙路由由系统接管。

---

## ui-language — 固定 TUICallKit UI 语言

**用途**：强制 TUICallKit 界面使用特定语言，不跟随设备语言。支持 `zh` / `en`。

**API**：无专用 TUICallKit API。通过 MaterialApp 的 `locale` 参数控制。

**插入位置**：`lib/main.dart` 的 `MaterialApp(...)` 参数区。

```
// PATCH lib/main.dart
// AT:  MaterialApp( 参数区
// 新增：
locale: const Locale('zh', 'CN'),   // 或 Locale('en', 'US')
```

**完整支持的 locale**：

| locale | 说明 |
|---|---|
| `Locale('zh', 'CN')` | 简体中文 |
| `Locale('en', 'US')` | English |
| `Locale('ja', 'JP')` | 日本語（5.0.0 example 含此 arb）|

不设置 `locale` 时跟随 `supportedLocales` 的第一个 + 系统语言自动匹配。

---

## mute-mode — 静音模式（来电不响铃）

**用途**：App 在静音模式时不播放来电铃声，适合客服/企业场景。

**API**：`await TUICallKit.instance.enableMuteMode(true)`

**插入位置**：App 启动时调用一次，或在用户切换静音设置时调用。建议放在 `TencentCallSdkAdapter.login` 成功后。

```
// PATCH lib/trtc_call/call_service.dart
// AT:  TencentCallSdkAdapter.login 成功后
await TUICallKit.instance.enableMuteMode(true);  // 开启静音
// await TUICallKit.instance.enableMuteMode(false); // 关闭静音
```

---

## incoming-banner — 来电横幅（App 在前台时）

**用途**：当 App 处于前台时，来电以横幅形式展示而非全屏弹出。适合不想打断用户当前操作的场景。

**API**：`TUICallKit.instance.enableIncomingBanner(true)`（注意：返回 `void`，非 `Future`）

**插入位置**：App 启动时调用一次，放在 `main()` 的 `TrtcCallBootstrap.run(...)` 之前，或 `TencentCallSdkAdapter.login` 成功后。

```
// PATCH lib/trtc_call/call_service.dart
// AT:  TencentCallSdkAdapter.login 成功后
TUICallKit.instance.enableIncomingBanner(true);
```

---

## calling-bell — 自定义来电铃声

**用途**：替换 TUICallKit 内置铃声，使用 Flutter assets 里的音频文件。

**API**：`await TUICallKit.instance.setCallingBell(String assetName)`

**前提**：音频文件必须已在 `pubspec.yaml` 的 `flutter.assets` 里声明。

**插入位置**：`TencentCallSdkAdapter.login` 成功后，或 App 启动时。

```
// PATCH pubspec.yaml
// AT:  flutter:
// 追加：
  assets:
    - assets/audio/custom_ringtone.mp3

// PATCH lib/trtc_call/call_service.dart
// AT:  TencentCallSdkAdapter.login 成功后
await TUICallKit.instance.setCallingBell('assets/audio/custom_ringtone.mp3');
```

**支持格式**：MP3 / AAC（iOS）；MP3 / OGG（Android）。
