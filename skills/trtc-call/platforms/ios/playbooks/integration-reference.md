# version-notes: TUICallKit_Swift 4.2.1 (AtomicXCore 4.2.4, AtomicX 4.2.0)

> iOS 原生（Swift，UIKit / SwiftUI）Call 集成的事实单一来源。所有事实均来自在 iPhone 16 模拟器与
> iPhone 16 Pro 真机上对 4.2.1 的实测或已发布包源码，证据见仓库外的 `canonical-notes.md`。
> 标注「未验证」的内容不得写进面向用户的代码或承诺。

## 版本与分发

- Pod 名 `TUICallKit_Swift`，**固定版本 `4.2.1`**，不得写 `~> 4.2`（`~> 4.2` 会解析到 4.2.0 + 更高的
  AtomicXCore，行为不同）。
- 最低 iOS **14.0**。Swift 5。
- 仅 CocoaPods。没有 SPM、没有 `Professional` 子规格。
- 纯 Objective-C 工程不可用：核心方法（`calls` 等）没有 `@objc`。
- 用户 Podfile 只需一行 `pod 'TUICallKit_Swift', '4.2.1'`，传递依赖自动拉取。

## Podfile

模板：`templates/snippets/podfile/` 下的 `platform-line.rb`、`pod-line.rb`、`post-install-sandbox.rb`。

- `platform :ios` 至少 `14.0`，已有更高版本保持不变。
- 必须 `use_frameworks!`（动态 framework，实测可用）。已有则不动。
- Xcode 15+ 新工程默认 `ENABLE_USER_SCRIPT_SANDBOXING = YES`，会让 `[CP] Embed Pods Frameworks` 失败。
  通过 `post_install` 用 xcodeproj gem 把主工程该项设为 `NO`。用户已有 `post_install` 时把
  `post-install-sandbox-body.rb` 的内容并入，不得新增第二个 `post_install` 块。
- **禁止**写「强制覆盖所有 Pods 的 `IPHONEOS_DEPLOYMENT_TARGET`」（Flutter 侧同类写法导致过 SIGSEGV）。
- **禁止**关闭 `CODE_SIGNING_*`。
- 改完 Podfile 必须 `pod install`，之后用 `.xcworkspace` 打开。

沙盒报错的两种日志形态都要识别：`rsync ... mkpathat: Operation not permitted`（实测出现）和
`Sandbox: ... deny(1) file-write-create`。

## Info.plist 与权限

必须声明 `NSMicrophoneUsageDescription`；视频通话还要 `NSCameraUsageDescription`。不声明能编译，
但首次访问麦克风或摄像头时系统会直接终止进程，SDK 不会代宿主补。

两种工程形态：

| 形态 | 判断 | 写法 |
|---|---|---|
| 独立 Info.plist | pbxproj 含 `INFOPLIST_FILE` 且 `GENERATE_INFOPLIST_FILE` 不为 YES | 在 plist 顶层 `<dict>` 追加 `templates/snippets/info-plist/*.xml` |
| 无 Info.plist | `GENERATE_INFOPLIST_FILE = YES`，无 `INFOPLIST_FILE` | 不改文件，告知用户在 Xcode Target -> Info 页添加两项，或在 Build Settings 加 `INFOPLIST_KEY_NSMicrophoneUsageDescription` / `INFOPLIST_KEY_NSCameraUsageDescription` |

最小集成不需要声明任何 `UIBackgroundModes`。`voip` / `audio` 属于 VoIP Push 方案。

## 登录与 UserSig

- 登录：`TUILogin.login(Int32(sdkAppID), userID:userSig:succ:fail:)`，属 `TUICore`。
- 登出：`TUILogin.logout(succ, fail:)`。
- `GenerateTestUserSig.genTestUserSig(userID:sdkAppID:secretKey:)` 在 4.2.x 发布包内，`sdkAppID` 为 `Int`。
- **它会把完整 SecretKey 打印到 Xcode 控制台**（行 `hmac secretKey: ...`，Debug 构建实测）。读 4.2.1 发布包源码确认：
  `GenerateTestUserSig.swift` 里的这些 `print` 没有任何 `#if DEBUG` 保护，所以 **Release 构建里只要调用它，同样会打印**
  （由源码得出，没有在 Release 里实跑过）。
  所以：只能放 `#if DEBUG` 内调用，不要因为"Release 不会打印"而放宽；用户贴日志前必须先删含 `secretKey` / `hmac` /
  `string to sign` 的行。
- 本 skill 的 snippet 只在 `#if DEBUG` 内调用它，Release 不会调用；`TRTCDebugConfig` 整个文件也在 `#if DEBUG` 内，
  实测 Release 二进制里不含该符号（Debug 里有）。但这个类本身仍随 SDK 发布包一起编进 Release 二进制，只是没人调用。
- 生产 UserSig 必须由业务后端签发，SecretKey 不得进入客户端。
- 对话里只收 SDKAppID；SecretKey 由用户自己填进 `Debug/TRTCDebugConfig.swift`，AI 不收、不读、不回显。

## 登录后何时可以呼叫（实测）

登录成功回调里立即 `calls` 会稳定返回 `-1201 call failed, please login`。原因是 SDK 内部通话引擎初始化是
异步的，晚于登录回调。回调后约 50ms 再试即成功。没有找到更可靠的公开信号。

规则：**呼叫只能由用户点击触发**，不得放在登录成功回调、`viewDidLoad`、`onAppear` 里自动执行。
snippet 不带重试逻辑。

## 登出、切换账号、冷启动（实测）

| 场景 | 结果 |
|---|---|
| `TUILogin.logout` | 成功；`LoginStore.state.loginStatus` 仍是 `logined`（不要用它判断登出）；之后 `calls` 返回 `6013` |
| 不登出直接 `TUILogin.login` 另一账号 | 可行，最终用户为新账号 |
| 杀掉 App 后冷启动，不调用登录 | **SDK 不会自动恢复登录**，`calls` 返回 `-1201`，收不到来电 |

skill 只在「登录成功」一处写代码；冷启动重新登录、登出/切换账号、被踢/UserSig 过期由 skill 把 API
告知用户，由用户自己加（见 `templates/snippets/swift/` 下 `relogin-cold-start`、`logout`、`login-listener`）。
`TUILoginListener` 的 `onKickedOffline` / `onUserSigExpired` 写法编译确认，真实触发行为**未验证**。

## 呼叫 API 速查

| 项 | 用法 |
|---|---|
| 发起 | `TUICallKit.createInstance().calls(userIdList:mediaType:params:completion:)`，`mediaType` 为 `.audio` / `.video`，`completion` 收 `Result` |
| 类型来源 | `AtomicXCore`：`CallMediaType`、`CallParams`、`ErrorInfo`。不是旧的 `TUICallMediaType` / `TUICallParams` / `TUIRoomId` |
| 接听/拒绝/挂断 | `CallStore.shared.accept / reject / hangup(completion:)` |
| 状态 | `CallStore.shared.state.selfInfo.status`：`none -> waiting -> accept -> none` |
| 事件 | `CallStore.shared.callEventPublisher`：`onCallReceived` / `onCallStarted` / `onCallEnded` |
| 注意 | `onCallStarted` 在**主叫发起时**触发，不是接通时。判断已接通用 `selfInfo.status == .accept` |
| 加入已有通话 | `join(callId:completion:)`（旧 `joinInGroupCall` 已不存在） |

## 可选微调 API（源码）

| 微调 | 签名 |
|---|---|
| 昵称头像 | `setSelfInfo(nickname:avatar:completion:)` |
| 悬浮窗 | `enableFloatWindow(enable:)` |
| 虚拟背景 | `enableVirtualBackground(enable:)` |
| 来电横幅 | `enableIncomingBanner(enable:)` |
| 静音模式 | `enableMuteMode(enable:)` |
| 自定义铃声 | `setCallingBell(filePath:)` |
| 呼叫超时 | `CallParams.timeout`（秒，`Int`） |

扬声器/听筒切换、UI 语言切换：公开 API 中未找到，不得编造。

## 后台 / 锁屏 / 被杀（实测，无 VoIP Push、无 CallKit）

| 状态 | 来电 | 说明 |
|---|---|---|
| 前台 | 可用 | 来电界面、铃声、震动 |
| Home 键切后台 | **收不到** | 进程被挂起，切回前台也不补弹 |
| 锁屏 | 不可依赖 | 实测约 28 秒内信令送达，但只有 SDK 自带震动，无通知、无锁屏来电卡片；时长由系统决定 |
| 杀掉 App | **收不到** | 无 |

收尾话术必须明确：基础集成只覆盖 App 在前台时的来电；后台、锁屏稳定响铃、被杀后来电需另接 VoIP Push + CallKit。
接入后的行为**未验证**，不得承诺。

## 错误码速查

| 码 / 信息 | 场景 | 处理 |
|---|---|---|
| `-1201 call failed, please login` | 登录未完成（含登录回调里立即 `calls`）、冷启动未登录 | 确保已登录；呼叫由点击触发 |
| `-1201 TUICallEngine is not initialized` | `LoginStore.logout` 之后 `calls` | 重新登录 |
| `6013 ... not initialized` | `TUILogin.logout` 之后 `calls` | 重新登录 |
| `-1001 ... package you purchased does not support this ability` | 该 SDKAppID 未开通 Call 能力 | 去控制台为该应用开通 Call |
| `-1001 [login] ... please check login params` | 登录参数错误 | 核对 SDKAppID / userID / userSig |
| `101008 can not start call, already in call` | 已有进行中的通话 | 等待或先挂断 |
| `70020 Invaild parameters(SDKAppID=...)` | SDKAppID 填错（SDK 原文拼写如此） | 核对 SDKAppID |
| `9512` / `9523` | 网络不通 / 超时 | 国行 iPhone 检查该 App 是否被允许使用蜂窝/无线数据；检查 VPN、代理 |

真机运行补充：免费个人团队签名可用，但需在手机「设置 -> 通用 -> VPN 与设备管理」信任开发者证书，**删除 App
重装后需要重新信任**，否则启动被拒（`inadequate entitlements or its profile has not been explicitly trusted`）。

## 不得写入代码或承诺

- `~> 4.2` 等宽松版本；强制覆盖所有 Pods 部署版本；关闭 `CODE_SIGNING_*`。
- 要求用户在对话里发送 SecretKey；把 SecretKey 写进 session、日志或会被提交的文件。
- 登录回调里不加保护地直接 `calls`。
- 「锁屏还能收到来电」作为能力承诺。
- `LoginStore.shared.login` 作为主路径、`loginEventPublisher`、`joinInGroupCall`、旧的 `TUICallParams` /
  `TUIRoomId` / `TUICallMediaType`。

## 未验证项（不得写成已知行为）

官方推荐的「可以呼叫了」信号；接入 VoIP Push + CallKit 后的后台来电；两台真机的真实画面和声音；
被踢与 UserSig 过期的真实触发；弱网下 `-1201`
窗口时长；扬声器/听筒与 UI 语言切换 API。
