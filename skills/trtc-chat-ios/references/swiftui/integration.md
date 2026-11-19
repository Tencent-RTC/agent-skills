# 声明式 SwiftUI 集成

## 目录与版本

| 层 | 当前核验事实 | 接入时操作 |
| --- | --- | --- |
| TUIChatKit_Swift | SwiftUI 开源 UI，模块名 `TUIChatKit_Swift`，资源包 `ChatUIKitBundle` | 保留 podspec 声明的源文件和资源，不只拷几个页面 |
| AtomicXCore | Store/State；当前 Demo 用二进制 Pod | 核对 lock、swiftinterface 与 UI 所需 API |
| IM SDK / RTC | Core、Call 的传递依赖 | 排查最终解析版本，不重复加入不同 SDK 变体 |

**本 Skill 以已发布版本为准**：声明式基线是 CocoaPods Trunk 上的 `TUIChatKit_Swift 9.1.7821`（2026-11-18 核对时唯一发布版本）。Trunk 规格的 source 是官方 zip 源码包，安装后源码在 `Pods/TUIChatKit_Swift/TUIChatKit_Swift/`。公开仓库 [Tencent-RTC/TUIKit_iOS](https://github.com/Tencent-RTC/TUIKit_iOS) 默认分支的 `chat/` 下只有命令式 `uikit`、`demo`、`demo_mini`，没有声明式套件；不要把 `chat/uikit` 当作声明式源码克隆。

按客户实际 `Podfile.lock` 和源码决定调用。以下是带日期的核验记录，不是兼容承诺：

- 9.1.7821：iOS 15.0、Swift 语言模式 5.0、静态 framework；依赖 `Kingfisher`、`AtomicXCore >= 3.0.0, < 5.0`、`Masonry`、`AlbumPicker ~> 1.0.0`；资源包 `ChatUIKitBundle`；视频录制为 Objective-C 实现。用空工程只装 `pod 'TUIChatKit_Swift', '9.1.7821'` 实测解析 Core 4.3.11、IM 9.1.7834，本 Skill 两份声明式示例在其上完整编译通过。
- 9.1.7821 的公开配置为 `userXxx` 可选存储加同名公开计算属性（如 `config.isShowVideoCall = false` 可写）；联系人配置名为 `ChatContactListConfig`，`ContactsPage` 回调参数为 `AZOrderedListItem`。
- 内部开发源码（`ios_swiftui/chat/uikit`，podspec 9.1.7822）尚未发布，已有若干差异：`ContactsPage` 改为 `ContactListConfig?` 与 `ContactInfo` / `GroupInfo` 回调，`ChatMessageListConfig` init 参数顺序调整，录制改为 Swift、去掉 Masonry，并含表情回应气泡与长按菜单修复。客户使用开发源码（`:path`）时按其实际文件写调用，不把 9.1.7821 签名套过去，反之亦然。

需要上游版本比较时只读查询，不把宿主仓库 HEAD 当作 UI 库版本，不擅自 fetch/pull/reset。无法联网时记录无法核对，不阻断基于现有版本的明确任务。

## 获取依赖

**默认使用 CocoaPods 发布版 `TUIChatKit_Swift`**：它本身是源码 Pod，客户可以在 `Pods/` 中阅读源码。按以下顺序判断，不重复下载：

1. Podfile 已用 `:path` 引用 `TUIChatKit_Swift.podspec`，或客户提供了声明式源码目录：复用现有源码。
2. 客户只要求接入、未提源码修改：用远程 Pod，保持已锁定的兼容组合，不直接更新到“最新”。
3. 客户要长期修改组件源码：不要直接改 `Pods/`（`pod install` 会覆盖）。在文件级方案中说明并取得授权后，二选一：使用客户提供的内部源码以 `:path` 引用；或把已安装 Pod 的源码目录复制到项目中一个尚不存在的目录，再按 `pod spec cat TUIChatKit_Swift --version=<实际版本>` 的内容编写本地 podspec（去掉 http source，把 `source_files` / `resource_bundles` 前缀改成新目录的相对路径），以 `:path` 引用。写清回退方式：删除该目录，恢复原 Podfile 和 `Podfile.lock`。

不依据记忆补写源码，不从命令式仓库拼凑声明式文件。两种来源都不可用时报告具体错误，由客户提供源码包或目录。

## CocoaPods 示例

```ruby
platform :ios, '15.0'

target 'YourApp' do
  use_frameworks! :linkage => :static
  pod 'AtomicXCore', '>= 4.3.10', '< 5.0'
  pod 'TUIChatKit_Swift'
end
```

使用本地源码时把最后一行换成 `pod 'TUIChatKit_Swift', :path => '<相对 Podfile 的目录>/TUIChatKit_Swift.podspec'`。目标名称沿用宿主；iOS 15 / Core 范围是当前 Demo 基线，不覆盖客户版本决策。已有 Bundler 时用 `bundle exec pod install`；不默认 `pod update`、删除锁文件或覆盖签名配置。安装后打开 `.xcworkspace`，核对 `ChatUIKitBundle` 进入 App。

同一 App 同时集成命令式 `TUIChatKit` 与声明式 `TUIChatKit_Swift` 未经验证，不默认混用。

## 宿主必须提供的环境

这三项是声明式特有的接入前提，缺失时页面会崩溃、无法跳转或主题不对：

1. **`ThemeState` 环境对象**：页面与组件内部用 `@EnvironmentObject var themeState: ThemeState`。在包含组件的根视图上注入 `.environmentObject(ThemeState.shared)`；通过 `UIHostingController`、`sheet`、`fullScreenCover` 单独承载的组件根视图也要各自注入，不依赖继承。
2. **导航容器**：组件内部用 `NavigationLink` 打开子页面（会话页新建聊天/建群、联系人加好友/加群、设置子页、合并消息详情等），已读回执页还会找当前 `UINavigationController` 做 UIKit push。组件根必须位于 `NavigationView`（iOS 15 用 `.navigationViewStyle(StackNavigationViewStyle())`）或宿主已有的 SwiftUI 导航栈中。`ChatPage`、`ConversationsPage`、`ContactsPage` 自绘标题栏，宿主对它们使用 `.navigationBarHidden(true)`，避免双标题栏；**单聊/群设置页、资料页及组件内部子页依赖系统导航栏的标题和返回按钮**，不要对它们隐藏，从隐藏栏的页面 push 过去时显式写 `.navigationBarHidden(false)`。
3. **外观与方向**：组件不替宿主设置 `preferredColorScheme` 和 `layoutDirection`。需要跟随 `ThemeState` 深浅色或阿拉伯语 RTL 时，由宿主根视图设置，参考 Demo `ContentView` 的做法，见 [声明式定制·主题与语言](customization.md#主题与语言)。

隐藏系统导航条后，系统左边缘返回手势可能失效。优先在组件页用页面级桥接恢复（Mini Demo 的 `SwipeBackSupport` 做法），不要照搬完整 Demo 对 `UIViewController.viewDidAppear` 的全局方法交换。

## 登录

登录参数来源、默认客户端 DEBUG 签名、“只填 SDKAppID 和 SecretKey”、三次风险提示、交付标题与回复结构，**与命令式完全一致**，按 [命令式接入·登录](../app/integration.md#登录) 的全部规则执行；签名使用共用的 [DebugSignature.swift](../examples/DebugSignature.swift)，配置文件同样包在 `#if DEBUG` 内。

只有 UI 写法不同：

- **缺配置阻断提示**：SDKAppID 或 SecretKey 未填写时，在 Debug 登录入口用 SwiftUI `.alert` 显示标题“请先填写 SDKAppID 和 SecretKey”，正文指出配置文件和缺失字段；不请求登录、不进入聊天页。不要只打印日志或停在空白页。
- **登录时机**：在根视图或其持有的 `ObservableObject` 中只登录一次（`.task` / `.onAppear` 加状态防重入），不要在 `body` 计算、每个子页 `onAppear` 或 `updateUIViewController` 中登录。
- **状态驱动切页**：用 `.onReceive(LoginStore.shared.state.subscribe(StatePublisherSelector(keyPath: \LoginState.loginStatus)))` 在主线程切换登录页与聊天页；登录失败保留 `ErrorInfo.code` 和 `message`，不导航。

完整可类型检查的写法见 [声明式接入示例](examples/ChatIntegration.swift)。不添加不存在的 `LoginStore.initSDK/destroySDK`，不混接经典 `TUILogin`。

## 导航与页面

最小链路：登录 → 会话列表 → 点击会话进入聊天页 → 文本收发 → 返回。示例类型都是宿主自有代码，不是 SDK API。

1. **会话页**：`ConversationsPage(config:onConversationClick:)` 回调 `NavigationInfo`；把 `conversation` 和 `locateMessage` 一起传给 `ChatPage`，搜索定位依赖后者。会话页本身没有返回按钮，作为根页时由宿主提供退出入口。
2. **聊天页**：`ChatPage(conversation:locateMessage:messageListConfig:messageInputConfig:isShowMoreButton:showsNavigationBar:topBannerView:onBack:onUserClick:onMoreClick:)`。`onBack` 接 `@Environment(\.dismiss)` 或宿主路由，不接则返回按钮无效；`onMoreClick` 同时由标题和“更多”按钮触发，无处理时用 `isShowMoreButton: false`。保留组件标题栏并隐藏系统栏是默认做法；`showsNavigationBar: false` 仅在宿主自己提供完整标题栏时使用。
3. **iOS 15 兼容跳转**：用隐藏的 `NavigationLink(destination:isActive:)` 或 `NavigationLink(destination:)`；`NavigationStack` / `navigationDestination` 需要 iOS 16，只有客户最低版本允许时才用。
4. **设置页**：`onMoreClick` 中按 `conversation.type` 打开 `C2CChatSettingView(userID:config:onSendMessageClick:onContactDelete:onBack:)` 或 `GroupChatSettingView(groupID:config:onSendMessageClick:onGroupDelete:onGroupMemberClick:memberDetailDestination:onBack:)`；原始 ID 用 `ChatUtil.getUserID(_:)` / `ChatUtil.getGroupID(_:)` 从会话 ID 取得。删除好友/退群回调里返回到会话列表。
5. **联系人页**：发布版 9.1.7821 为 `ContactsPage(config: ChatContactListConfig?, onContactClick: ((AZOrderedListItem) -> Void)?, onGroupClick: ((AZOrderedListItem) -> Void)?)`。回调项的 `userID` 是联系人 userID 或群 groupID，`extraData` 分别是 `ContactInfo` / `GroupInfo`；用 `ChatUtil.getC2CConversationID` / `getGroupConversationID` 构造 `ConversationInfo`，标题取 `title`，头像取 `avatarURL`。客户使用开发源码时回调直接是 `ContactInfo` / `GroupInfo`，先核对实际签名。
6. **用户资料**：`onUserClick` 返回 userID；可用公开的 `FriendAwareUserProfileView(userID:friendContent:)` 自动区分好友与非好友，或接宿主资料页。

`ChatPage` 传 `messageListConfig: nil` 时组件用 `ChatMessageListConfig(isShowRightAvatar: true)`；显式传 `ChatMessageListConfig()` 时右头像默认 false。需要保留默认外观时显式写 `isShowRightAvatar: true`。

### 嵌入 UIKit 宿主

用 `UIHostingController` 承载时，根视图写成 `NavigationView { ChatPage(...) }` 并注入 `ThemeState.shared`，再 push 到宿主 `UINavigationController`（完整 Demo 的做法），否则组件内部 `NavigationLink` 无法跳转。保持 hosting controller 实例稳定，不在 UIKit 生命周期回调里重复创建或登录。按需设置 `hidesBottomBarWhenPushed`。

## 可选 TUICallKit

不能从 Android 的默认策略推导 iOS 必须引入 Call，按需求与现有工程决定：

- 无 Call UI：输入配置 `ChatMessageInputConfig(isShowVideoCall: false, isShowAudioCall: false)`，单聊设置 `C2CChatSettingConfig(isShowVoiceCall: false, isShowVideoCall: false)`。历史通话消息与群内进行中通话横幅不受这两个开关控制，要求彻底去除时另列源码方案。
- 有 Call UI：加入 `TUICallKit_Swift`，核对其来源、Core 与 RTC 组合。组件内部经 `ChatCallEventPublisher` 发 `tuicallkit.startCall` / `tuicallkit.startJoin` 通知，由 Call 模块订阅；不在 App 中复制同名订阅器。
- Demo 在登录成功后调用 `TUICallEngine.createInstance().init(...)`，成功后 `TUICallKit.createInstance().enableIncomingBanner(enable: true)`；实施前核对现装 Call 的签名，不在登录前或失败时初始化。

## 权限与 Push

按实际能力配置并按使用时机请求：录音 `NSMicrophoneUsageDescription`，相机 `NSCameraUsageDescription`，相册读取/写入 `NSPhotoLibraryUsageDescription` / `NSPhotoLibraryAddUsageDescription`。TIMPush 是独立任务，不复制 Demo 的证书、team 或 App Group；未接 Push 不能声称离线通知已验证。

## 构建和交付

记录 `xcode-select -p`、实际 `xcodebuild -version`、SDK、workspace、scheme 与部署版本。占位符必须先由工程查得：

```bash
xcodebuild -workspace '<App>.xcworkspace' -scheme '<ActualScheme>' -configuration Debug -destination 'generic/platform=iOS Simulator' -derivedDataPath '<ApprovedBuildDirectory>' CODE_SIGNING_ALLOWED=NO build
```

按 [排障](../shared/troubleshooting.md#构建结果与模拟器启动不是同一层) 保留真实退出码。验收：登录成功/失败与缺配置提示、会话点击与返回、单群聊收发、搜索定位、设置页进出、联系人跳转、键盘与表情/更多面板、深浅色与 RTL、无 Call 时的所有入口、重复进入退出。运行验证需要真实账号和设备，未执行时明确标注。
