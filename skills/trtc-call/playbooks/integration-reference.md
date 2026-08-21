# version-notes: tencent_calls_uikit 5.0.0

> 官方文档示例基于旧版（3.6.x），API 已变更，以本文为准。
> AI 用途：集成时参考正确 API、用户报错时查 §常见报错速查。

---

## 依赖链（实测 Podfile.lock）

```
tencent_calls_uikit: 5.0.0
  ├── atomic_x_core: 5.0.2           → iOS: TXIMSDK_Plus_iOS_XCFramework ~9.0
  ├── tencent_cloud_chat_sdk: 8.0.0  → iOS: TXIMSDK_Plus_iOS_XCFramework ~9.0
  ├── tencent_rtc_sdk: 13.x          → iOS: TXLiteAVSDK_Professional 13.4.21067
  │                                          + TXCustomBeautyProcesserPlugin 1.0.2
  └── tuikit_atomic_x
```

**注意**：`tencent_cloud_chat_sdk`（完整 TIM IM SDK）是 transitive 依赖，自动拉入。已有其他 IM 集成的项目可能产生初始化冲突，先单独验证 TRTC 通话再联调。

---

## pubspec.yaml

```yaml
dependencies:
  tencent_calls_uikit: ^5.0.0
  flutter_localizations:
    sdk: flutter
  crypto: ^3.0.7    # q1=local-dev 时需要
```

---

## iOS 配置

**三处必改，缺一不可：**

**1. ios/Podfile**
```ruby
platform :ios, '14.0'

post_install do |installer|
  installer.pods_project.targets.each do |target|
    flutter_additional_ios_build_settings(target)
  end
end
```

**2. ios/Runner.xcodeproj**（Xcode 图形界面改，不要手动编辑 pbxproj）
- Build Settings → 搜 "deployment" → 确保全部至少为 `14.0`
- 已有目标版本高于 `14.0` 时保持不变，不要降级

**3. ios/Runner/Info.plist**
```xml
<key>NSMicrophoneUsageDescription</key>
<string>需要访问麦克风以进行通话</string>
<key>NSCameraUsageDescription</key>
<string>需要访问摄像头以进行视频通话</string>
```

**`flutter run` 会自动触发 `pod install`，但不会修改 Podfile 内容，上述三处仍需手动配置。**

---

## Android 配置

**android/app/build.gradle**
```groovy
android {
  defaultConfig {
    minSdkVersion 21
    multiDexEnabled true
  }
}
```

**android/app/src/main/AndroidManifest.xml**
```xml
<uses-permission android:name="android.permission.RECORD_AUDIO"/>
<uses-permission android:name="android.permission.INTERNET"/>
<!-- q3=video/both 时追加 -->
<uses-permission android:name="android.permission.CAMERA"/>
```

---

## Dart API 速查（5.0.0 vs 旧版 3.6.x）

| 用途 | 5.0.0 | 旧版（3.6.x）|
|---|---|---|
| 媒体类型枚举 | `CallMediaType` | `TUICallMediaType` |
| 通话参数 | `CallParams` | `TUICallParams` |
| 成功判断 | `result.isSuccess` | `result.code == '0'` |
| 错误码 | `result.errorCode` (int) | `result.code` (String) |
| 错误信息 | `result.errorMessage` | `result.message` |
| 登录事件 | `LoginStore.shared.loginEventStream` | `TUICallKit.setOnKickOffline` |
| 事件类型 | `LoginEvent.kickedOffline` / `.loginExpired` | 只有 `onKickedOffline` |

**关键约束**：`LoginStore.shared.loginEventStream` 必须在 `TUICallKit.instance.login()` 之前订阅（官方 dartdoc 明确 recommended）。旧版 observer API 在 5.0.0 中已降为 SDK 内部通道，外部用旧路径拿不到 `loginExpired` 事件。

### SDK adapter 与 UI 测试边界

- `CallService` 只依赖 `CallSdkAdapter`，生产默认使用 `TencentCallSdkAdapter`。
- unit/widget test 注入 Fake adapter，不执行真实 `TUICallKit.instance`。
- `CallButton` 可传 `service`、`child`、`style`、`buttonKey` 和 `onError`。
- 未传 `onError` 时才显示默认 SnackBar；传入后由业务决定错误 UI。
- loading 从 `onGetUserId()` 开始，异步解析目标用户期间也会阻止重复点击。

**MaterialApp 必须配置**（缺失会导致来电界面不弹 / 文案异常）：
```dart
MaterialApp(
  navigatorObservers: [TUICallKit.navigatorObserver],
  localizationsDelegates: const [
    AtomicLocalizations.delegate,
    GlobalMaterialLocalizations.delegate,
    GlobalWidgetsLocalizations.delegate,
    GlobalCupertinoLocalizations.delegate,
  ],
  supportedLocales: const [Locale('zh', 'CN'), Locale('en', 'US')],
)
```

### App 入口适配矩阵

| App 入口 | observer 注入位置 | 自动化状态 |
|---|---|---|
| `MaterialApp` | `MaterialApp.navigatorObservers` | 支持 |
| `CupertinoApp` | `CupertinoApp.navigatorObservers` | 支持 |
| `MaterialApp.router + GoRouter` | `GoRouter.observers` | 支持 |
| `MaterialApp.router + AutoRoute / 自建 RouterConfig` | 由对应路由框架决定 | 暂不自动 patch |
| `CupertinoApp.router` | 由 RouterConfig 决定 | 暂不自动 patch |

`MaterialApp.router` 构造函数没有 `navigatorObservers` 参数，严禁把标准 MaterialApp
snippet 直接复用到该构造函数。GoRouter 场景必须保留用户已有 observers，并追加
`TUICallKit.navigatorObserver`；重复执行时只允许存在一次。

**GenerateTestUserSig**：5.0.0 包体不导出，需从 example 手动复制：
```
~/.pub-cache/hosted/pub.dev/tencent_calls_uikit-5.0.0/example/lib/debug/generate_test_user_sig.dart
→ lib/debug/generate_test_user_sig.dart
```

---

## 常见报错速查

| 报错 / 现象 | 原因 | 解决 |
|---|---|---|
| `tuikit_atomic_x requires a higher minimum deployment target` | Podfile 或 Runner deployment target 低于 14.0 | 两处都提升到至少 `14.0`，再执行 `pod install` |
| App 启动即崩 `SIGSEGV` in `AtomicXCorePlugin` | Podfile 用 `post_install` 强制覆盖了所有 Pods 的 deployment target | 移除该强制覆盖，保留 Flutter 默认 `post_install`，再执行 `pod install` + `flutter clean` |
| iOS debug 模式崩，控制台有 `launchd deny system-debug children` | 设备未开启开发者模式，Flutter Dart VM 无法附加 | Settings → Privacy & Security → Developer Mode → ON → 重启 |
| iOS debug/release 均崩，控制台有 `Sandbox: deny sysctl-read kern.bootargs` + `Scene creation failed` | `TXLiteAVSDK_Professional` 在 `+load`（早于 Dart 启动）做反越狱检测，iOS 沙盒拒绝后 SDK crash。诊断：先开开发者模式排除 debug VM 问题；两种模式均崩 → SDK patch 版本 bug，Dart 层无法 catch | 1. 确认开发者模式已开启 2. `flutter pub outdated` 查是否有新 patch 3. 提腾讯云工单，说明 `kern.bootargs` EPERM 后崩溃 |
| App 启动即闪退（iOS），无明显 sysctl 日志 | Info.plist 缺权限声明 | 补 `NSMicrophoneUsageDescription` + `NSCameraUsageDescription` |
| `TUICallMediaType isn't a type` | 使用了旧版类型名 | 改为 `CallMediaType` |
| `TUICallParams isn't a type` | 使用了旧版类名 | 改为 `CallParams` |
| `result.code` / `result.message` 找不到 | 旧版返回值字段 | 改为 `result.isSuccess` / `result.errorCode` / `result.errorMessage` |
| `setOnKickOffline isn't defined` | 旧版被踢下线 API | 改用 `LoginStore.shared.loginEventStream.listen(...)` |
| `LoginStore` / `LoginEvent` 找不到 | 缺 import 或版本 < 5.0.0 | `import 'package:tencent_calls_uikit/tencent_calls_uikit.dart'`；确认 pubspec 是 `^5.0.0` |
| `generate_test_user_sig.dart` import 失败 | 5.0.0 包不导出该文件 | 从 pub-cache example 目录手动复制到 `lib/debug/` |
| 来电界面不弹出 | App/Router 未接 observer | 标准 App 检查 `navigatorObservers`；GoRouter 检查 `GoRouter.observers` |
| 来电界面文案乱码 / assert 挂 | `localizationsDelegates` 缺失 | 按 §Dart API 速查 补齐 `AtomicLocalizations.delegate` + 其他三个 delegate |
| `kickedOffline` / `loginExpired` 收不到 | 订阅时机在 `login()` 之后 | 在 `login()` 之前订阅 `loginEventStream` |
| `AssertionError: configForDebug() must be called before init()` | `GenerateTestUserSig.sdkAppId` 未配置或为 0 | 仅 local-dev：在 `TrtcCallBootstrap.run(...)` 前设置 `GenerateTestUserSig.sdkAppId` 和 `GenerateTestUserSig.secretKey` |
| `-1002 errSdkNotInitialized`（发起通话时） | `TUICallKit.instance.calls()` 在登录完成前被调用；认证生命周期未完成 Call 登录，或 SDKAppID 的 `--dart-define` 键名与 `fromEnvironment` 不一致 | 确认登录、注册和 session 恢复都进入同一个 `CallAuthLifecycle.syncUser(userId)`；核对 SDKAppID 注入键名；禁止 `.catchError((_) {})` 静默吞错，并在登录成功前禁用 Call 入口 |
| `-1202 invitee_list cannot be null` | 传入的 userId 是当前登录用户自己（self-call），TUICallKit 不允许呼叫自己 | 在发起通话前检查 targetUserId != selfUserId；添加提示"不能呼叫自己" |
| 登录或通话报错"非法 userId"/ 原生层拒绝 | TUICallKit userId 只允许 `[a-zA-Z0-9_\-]`；使用 email（含 `@` `.`）作为 userId 会被拒绝 | 登录和发起通话前对 userId 做 sanitize：`userId.replaceAll(RegExp(r'[^a-zA-Z0-9_\-]'), '_')` |
| `PlatformException` 或 SDK crash，发生在 `Supabase.initialize()` / `Firebase.initializeApp()` 之前的 `TrtcCallBootstrap.run()` 调用处 | `async main()` 里 binding 未初始化就调用了需要 platform channel 的 SDK | 在 `main()` 函数体第一行加 `WidgetsFlutterBinding.ensureInitialized();`（async main 必备，TrtcCallBootstrap 不再代劳）|
| `setSelfInfo` 成功但对方来电界面看不到昵称/头像 | 非好友之间的通话，被叫方用户信息同步有延迟（隐私限制） | 完成一次成功通话（接通后正常挂断）后即可正常显示，无需代码改动 |
| `setSelfInfo` 成功但头像始终显示默认占位图 | 头像 URL 所在域名（如 Pinterest、YouTube）设有防盗链，SDK 内置图片加载器（SDWebImage / Glide）加载时被 403 拦截 | 将头像图片托管到无防盗链限制的 CDN（腾讯云 COS、阿里云 OSS 等）；测试可用 `https://liteav.sdk.qcloud.com/app/res/picture/voiceroom/avatar/user_avatar1.png` 验证 |
| 登录/通话报 `-3301` 或 "Services not available in your region" | SDKAppID 的部署区域与 App 实际访问区域不匹配（控制台里该应用绑定的地域不对） | 换用与业务区域一致的 SDKAppID。登录阶段即会暴露，与集成代码无关 |
| 群组通话报 `6017 get tinyid by userid failed` | 被叫 userId 从未用该 SDKAppID 登录过（或 userId 不存在） | 先让被叫端用同一 SDKAppID 登录一次；确认 userId 真实存在。不是发起方代码 bug |
