# 命令式 iOS 集成

## 目录与版本

区分 UI 源码、状态层和 SDK：

| 层 | 当前核验事实 | 接入时操作 |
| --- | --- | --- |
| TUIChatKit | Swift/UIKit 开源 UI，独立 `TUIChatKitBundle` | 使用真实 podspec 保留源文件和资源，不仅拷贝几个页面 |
| AtomicXCore | Store/State；Demo 当前使用二进制 Pod | 核对 lock、swiftinterface 与 UI 所需 API |
| IM SDK / RTC | Core、Call、VoiceAI 等传递依赖 | 排查最终解析版本，不重复加入不同 SDK 变体 |

公开源码仓库为 [Tencent-RTC/TUIKit_iOS](https://github.com/Tencent-RTC/TUIKit_iOS)，常见公开路径 `chat/uikit`、`chat/demo`、`chat/demo_mini`；本 Skill 的内部基线路径为 `ios/chat/uikit`。两者不是可直接互换的 Demo：公开 Demo 可能去掉内部登录、客服和 Push。

先读 [版本与能力检查](../shared/versions.md)，按客户实际Podfile.lock和ChatPage源码决定调用，不能把源码开发分支当发布Pod。以下仅为2026-10-28开发工作区静态核验记录：

- `TUIChatKit.podspec`：版本 `9.1.7821`，声明 iOS 14.0、Swift 语言模式 5.0、静态 framework。
- UI 依赖 `Kingfisher`、`SnapKit`、`AlbumPicker ~> 1.0.0`、`tui-cmark-gfm 0.29.0.15`、`TXLiteAVSDK_VoiceAI_iOS 13.6.0.255`、`AtomicXCore >= 3.0.0, < 5.0`。
- Demo 使用 iOS 15.0，并收窄 Core 为 `>= 4.3.10, < 5.0`；已有锁文件解析 Core 4.3.11、IM SDK 9.1.7822。
- CocoaPods 1.16.2 是锁文件生成版本，不是已确认的最低要求；Swift 语言模式 5.0 也不表示任意 Swift 5 编译器能读取当前二进制。
- podspec 的 source/tag 声明不证明该版本已发布到 CocoaPods。使用远程 Pod 前查实际可用版本；保持已锁定的兼容组合，不直接更新到“最新”。

需要上游版本比较时只读查询默认分支，不能把宿主 App 仓库 HEAD 当作 TUIKit 版本，不能擅自 fetch/pull/reset。无法联网时记录无法核对，不阻断基于现有版本的明确任务。

## 获取 TUIKit iOS 源码

**默认集成方式：从 GitHub 克隆 TUIKit iOS 源码到客户当前项目，再在 Podfile 里用 `:path` 本地依赖 TUIChatKit。** 这样客户可以直接阅读和修改组件源码，版本也跟着项目走。

以下情况不再下载：
- Podfile 已用 `:path` 引用 TUIChatKit 源码，或客户提供了源码目录：复用现有源码。
- 客户明确要求使用 CocoaPods 发布版：按其选择，不克隆。

下载前把以下内容写进文件级方案并取得授权，授权后才执行：

- 来源：GitHub 优先，GitHub 无法访问时改用 CNB。
- 目标目录：客户当前项目中一个尚不存在的目录，默认是与 `Podfile` 同级的 `TUIKit_iOS`；已存在同名目录时不覆盖，先查看它是不是已有的 TUIKit 源码，不是则换名并在方案中说明。不放进 `Pods/`、构建产物或客户已有的业务源码目录。
- Podfile 引用的变化，以及回退方式（删除该目录、恢复原 Podfile 和 `Podfile.lock`）。

在项目根目录（`Podfile` 所在目录）执行：

```bash
git clone https://github.com/Tencent-RTC/TUIKit_iOS.git TUIKit_iOS
```

GitHub 无法访问（超时、拒绝连接、需要代理但没有）时改用 CNB：

```bash
git clone https://cnb.cool/tencent/cloud/trtc/TUIKit_iOS TUIKit_iOS
```

只需要最新代码时可加 `--depth 1` 缩短下载时间；客户指定 tag 或提交时，用 `--branch <tag>`，或完整克隆后在该目录内切到对应提交。未经授权不对客户已有的 TUIKit 目录执行 `pull`、`fetch`、`checkout`、`reset`、`clean` 或修改 remote。

下载完成后：

1. 记录实际来源和提交：`git -C TUIKit_iOS remote get-url origin` 与 `git -C TUIKit_iOS rev-parse HEAD`。CNB 是镜像，同一时刻的提交可能与 GitHub 不同（2026-11-04 核对时两边 `main` 的 HEAD 不一致），不能把从 CNB 下载的代码说成"GitHub 最新"。
2. 确认 `TUIKit_iOS/chat/uikit/TUIChatKit.podspec` 存在，读取其中的版本和依赖（尤其 `AtomicXCore` 范围和 `tui-cmark-gfm` 版本），与客户现有 `Podfile.lock` 比较；冲突时先说明，不直接升级已锁定依赖。`pod install` 报某个依赖版本找不到时，先查该版本是否已在 CocoaPods Trunk 发布，未发布时在宿主 Podfile 用 `:podspec` 指向官方下载地址，不改 TUIChatKit 的 podspec 去凑版本。
3. 在 Podfile 中按相对 Podfile 的路径引用：`pod 'TUIChatKit', :path => 'TUIKit_iOS/chat/uikit/TUIChatKit.podspec'`（Podfile 不在项目根时按实际相对路径调整），再按下文执行安装与构建。
4. 克隆下来的目录自带 `.git`，是嵌套在客户项目里的独立仓库。告诉客户提交前需要自己选择：作为 Git submodule 管理、删除其中的 `.git` 把源码作为项目文件提交，或者加入 `.gitignore` 由每个开发者自行克隆。不要替客户执行 `git add`、创建 submodule 或删除 `.git`。
5. 公开仓库的 `chat/demo`、`chat/demo_mini` 只作参考，不整体复制进客户 App；本 Skill 内部基线路径 `ios/chat/uikit` 与公开仓库的 `chat/uikit` 不是同一个目录。

两个来源都无法访问时，报告具体错误，可改用已发布的 CocoaPods 版本，或由客户提供源码压缩包/目录；不根据记忆补写源码。

## CocoaPods 示例

以下是按上节把源码克隆到项目根 `TUIKit_iOS` 后的写法；目标名称沿用宿主，路径按实际位置调整。iOS 15 / Core 范围是当前公开 Demo 的基线，不覆盖客户版本决策。

```ruby
platform :ios, '15.0'

target 'YourApp' do
  use_frameworks! :linkage => :static
  pod 'AtomicXCore', '>= 4.3.10', '< 5.0'
  pod 'TUIChatKit', :path => 'TUIKit_iOS/chat/uikit/TUIChatKit.podspec'
end
```

读取依赖代码前确认来源。安装依赖会执行 podspec/build 脚本，遵守宿主权限提示。已有 Bundler 配置时使用 `bundle exec pod install`；不默认运行 `pod update`、删除锁文件、禁用全部资源拷贝阶段或覆盖 App 签名配置。

安装后打开 `.xcworkspace`。核对 `TUIChatKitBundle` 是否进入 App；不要沿用旧 `ChatUIKitBundle` 或手工 vendor cmark/opus 的记忆。

## 登录

未指定范围时按最小链路设计：登录 → 会话列表 → 点击会话进入聊天页 → 文本消息收发。签名算法、70003/60010/6032 定位和生产迁移见 [credentials.md](../shared/credentials.md)；此页负责登录参数来源、登录调用和导航接线。

### 登录参数来源

先从工程只读确认 `sdkAppID`、`userID`、`userSig` 分别从哪里来，源码能回答的不问客户：

1. 工程已有账号体系或 UserSig 接口：沿用现有流程取得登录参数，再调用 `LoginStore`。
2. 集合安装时根 Skill 已收集 SDKAppID：直接使用，不重复索要。SecretKey 不让客户发到对话里，到需要时告诉客户填写的文件和位置。
3. 工程里没有任何登录参数来源：一次只问一个问题，让客户选择：
   - 由业务服务端签发 UserSig（生产推荐）：方案中只写 App 端请求和接收 UserSig 的接线，服务端签发实现不属于本 Skill。
   - 参考 Chat Demo，在客户端用 SecretKey 生成 UserSig（仅调试）：按下一节实施。

无论哪种来源，失败都完整保留 `ErrorInfo.code` 和 `message`；`userID` 必须是签名中的用户，`sdkAppID` 必须与签发 UserSig 的应用一致。

### 客户端 SecretKey 调试

客户明确选择参考 Chat Demo 在客户端使用 SecretKey 调试时，可以实施，不以风险提示阻断：

1. 方案阶段说明客户端密钥可被提取，推荐生产由服务端签发 UserSig。
2. 请求写入授权前再次提示同一风险。
3. 最终交付时第三次提示风险与生产建议。

不得把这种方式描述为安全的生产方案。实施方式：

- 在客户工程新增一个调试配置文件（如 `ChatDebugConfig.swift`），放 `sdkAppID`、`secretKey` 占位，用 [DebugSignature.swift](../examples/DebugSignature.swift) 按登录 `userID` 生成 UserSig 后传给 `LoginStore`。该文件默认包在 `#if DEBUG` 内；客户需要在 Release / TestFlight 包中使用时，按其选择调整并再次提示风险。
- 告诉客户 SecretKey 填在哪个文件的哪一行，由客户自己填写。客户明确要求代为写入时，可以写入这个目标文件，但不在方案、日志摘要或最终回复中复述完整 SecretKey 或 UserSig。
- 提醒客户不要把填了真实 SecretKey 的文件提交到版本库。
- 管理员 UserSig 只用于服务端 REST；客户端登录使用目标用户自己的 UserSig，两者不能混用。

### 登录调用

当前公开调用：

```swift
LoginStore.shared.login(
    sdkAppID: sdkAppID,
    userID: userID,
    userSig: userSig
) { result in
    DispatchQueue.main.async {
        switch result {
        case .success:
            onReady()
        case .failure(let error):
            onFailure(error.code, error.message)
        }
    }
}
```

上述 `onReady` / `onFailure` 为宿主回调；完整类型化实现见 [ChatIntegration.swift](../examples/ChatIntegration.swift)。统一在会话入口登录一次，不在每次点会话时登录；失败不导航。用 `LoginStore.shared.logout(completion:)` 处理退出结果，取消账号相关页面与订阅。订阅 `loginEventPublisher` 的 `.kickedOffline` / `.loginExpired`，交给业务重新认证。接入 TUICallKit 时，在登录成功后用同一组 `sdkAppID`、`userID`、`userSig` 初始化（见下文“可选 TUICallKit”），不在登录前或登录失败时初始化。

不添加不存在的 `LoginStore.initSDK/destroySDK`。不混接经典 `TUILogin` 与当前 `LoginStore` 两条登录生命周期。不把真实密钥放入本 Skill 或其提交记录。

## 导航与页面生命周期

模板使用 `ChatFlowCoordinator(presenter:)`，由宿主持有并在登录成功后调用 `start()`；它呈现独立的全屏导航栈，根容器提供关闭按钮，`finish()` 关闭整个 flow，不修改宿主原导航条。先启动 flow 再调用其 show 方法。所有模板类型都是宿主示例类型，不是 SDK API。为宿主资源增加 `CloseChat` 文案；自定义卡片模板还需 `UnsupportedOrderMessage`。设置页示例隐藏未接回调的“发消息”按钮，实际需要时通过 `onSendMessageClick` 接业务导航。

1. 也可按现有架构接入宿主 `UINavigationController` 或 Tab：会话页回调传入 `NavigationInfo`，将 `conversation` 和 `locateMessage` 一起传给 `ChatPage`。ConversationsPage 本身没有返回闭包，作为根页时必须由宿主提供明确退出入口。
2. 默认保留ChatPage自带导航条并隐藏宿主系统UINavigationBar，onBack接宿主返回；退出flow恢复宿主原状态。只有实际公开init支持 `showsNavigationBar` 时才能选择关闭组件条，否则不能传该参数。需要无导航嵌入但该版无开关时，另做经授权源码方案，不通过私有subview遍历隐藏。嵌入模板现在保留组件条并要求传onBack，宿主不要再叠一条标题栏。
3. 给 `onBack` 接 pop 或 dismiss。`onMoreClick` 为宿主打开 C2C/Group 设置，或用 `isShowMoreButton: false` 隐藏无处理的按钮。
4. 推入聊天页按需设置 `hidesBottomBarWhenPushed`；不要把 Tab 的自定义角标永久放到根窗口从而盖住聊天输入栏。
5. 嵌入现有 VC 时执行 `addChild`、添加 view、约束、`didMove(toParent:)`；移除时执行对应 containment 清理。不只取 `.view`。
6. 根页面/协调器由宿主持有。回调 `[weak self]`，异步结果切主线程并验证页面和登录账号仍有效。
7. `ContactsPage` 的联系人/群点击分别构造对应 `ConversationInfo`；原始 userID/groupID 使用 `ChatUtil.getC2CConversationID` / `getGroupConversationID`，不要反复添加前缀。

聊天页内部已有消息加载、输入和可见性驱动的已读逻辑；不要同时在宿主新建一套消息列表订阅去驱动同一页面。安全区和键盘处理应有唯一负责人，不能在宿主和组件叠加键盘 inset。

SwiftUI 宿主只需 UIKit 互操作容器时使用 `UIViewControllerRepresentable` 承载完整 VC；保留稳定实例和导航回调，不在每次 `updateUIViewController` 中登录/重建页面。独立 SwiftUI TUIChatKit 是另一套源码，不属于本文的 API 基线。

## 可选 TUICallKit

不能从 Android 的默认 CallKit 策略推导 iOS 必须引入 Call。按用户需求及现有工程决定：

- 无 Call UI：输入配置 `isShowVideoCall: false, isShowAudioCall: false`；C2C 设置配置 `isShowVoiceCall: false, isShowVideoCall: false`。模板只处理这些常见发起入口，不是彻底移除所有 Call UI 的实现。历史通话消息的点击重拨、群内进行中通话横幅、独立 Call Tab 仍需逐一验收；前两者不受这些开关控制。要求彻底去除时另列方案，必要时经授权修改 UI 源码，不覆盖保留通话协议或伪造 Call 通知处理器。
- 有 Call UI：核对 `TUICallKit_Swift` 的实际来源/路径、Core 与 RTC 依赖组合、同账号登录和应用服务权限。
- 当前调用链为 Chat 内 `ChatCallEventPublisher` 发通知，Call 模块的 `ChatCallEventSubscriber` 接收。`TUICallKit.createInstance()` 已确保订阅，不再复制 App 级同名订阅器，不编造 `CallKitBridge`。
- 当前 Demo 登录后调用 `TUICallEngine.createInstance().init(...)`，成功再 `TUICallKit.createInstance().enableIncomingBanner(enable: true)`；实施前核对现装 Call 的 init/fail 签名，不复制内部 Demo 凭据或业务初始化。
- 移除 Call UI 时同时清理直接依赖、初始化、自定义入口和专属配置。但 Core 可能仍传递 Professional RTC SDK，不承诺“无 Call UI 就没有 RTC 二进制”。

腾讯 `TUICallKit_Swift` 与 Apple `CallKit` 系统框架不是一回事。系统来电、VoIP Push、后台策略需单独设计，不能通过无依据添加 `voip` 后台模式完成。

## 权限与 Push

按实际提供能力配置并按使用时机请求：录音用 `NSMicrophoneUsageDescription`，相机用 `NSCameraUsageDescription`，照片读取/写入分别核对 `NSPhotoLibraryUsageDescription` / `NSPhotoLibraryAddUsageDescription`。不在启动时一次申请所有权限。

TIMPush 是独立接入任务，不是 TUIChatKit 的直接依赖。APNs certificate ID、capabilities、entitlements、NSE/App Group 使用客户自己的配置；不要复制 Demo 的证书 ID、team 或 App Group。未接 Push 不能声称离线通知已验证。

## 构建和交付

记录 `xcode-select -p`、实际 `xcodebuild -version`、SDK/架构、workspace、scheme、部署版本。多 Xcode 用单条命令的 `DEVELOPER_DIR` 选择已安装工具链，不擅自 `sudo xcode-select`。

```bash
xcodebuild -workspace '<App>.xcworkspace' -scheme '<ActualScheme>' -configuration Debug -destination 'generic/platform=iOS Simulator' -derivedDataPath '<ApprovedBuildDirectory>' CODE_SIGNING_ALLOWED=NO build
```

占位符必须先由工程查得，不原样执行。Simulator build 不等于真机运行；某依赖无模拟器切片时，改做经授权的真机目标免签编译并如实说明。不要默认排除 arm64 或关闭全部脚本沙盒。

验收：登录成功/失败、会话点击、返回、单群聊收发、搜索定位、键盘、重复进入退出、无 Call 的所有入口、权限拒绝、资源和深浅色。运行验证需要真实账号和设备，未执行时明确标注。
