# API 地图与源码依据

## 如何使用

本页是公开API查表，不是源码任务的必读大纲。修改内部实现先读 [源码任务索引](../source/index.md)，仅在访问级别、构造器或公开调用不明确时查本页相应节。

所有路径以下述真实源码根为相对基准：公开仓库 `chat/uikit`，内部基线 `ios/chat/uikit`。不要在分发 Skill 中写维护者机器的绝对路径。Demo 路径以相邻 `chat/demo/ChatDemo/Sources` 为基准，内部 Demo 只能作为查证样本，不能复制内部服务、私钥或测试环境。

本表主要是2026-10-28重构开发源码的字典，不是所有发布Pod的统一签名。先按 [版本与能力检查](versions.md) 核对客户Podfile.lock、实际源码和公开构造器；TUIChatKit、Core、IM版本分别记录，不因同版本号就推断源码相同。Core 查 `Pods/AtomicXCore/AtomicXCore.xcframework/<当前平台>/AtomicXCore.framework/Modules/AtomicXCore.swiftmodule/*.swiftinterface`；不存在时由真实源码/头文件确认，不借另一个 checkout 冒充同版本。

## 页面

| 符号 | 公开入口 | 源码 |
| --- | --- | --- |
| ChatPage | 通用模板使用 `init(conversation:locateMessage:messageListConfig:messageInputConfig:isShowMoreButton:onBack:...)`；完整签名查实际源码。`showsNavigationBar` 仅部分重构源码支持，不作为通用参数 | 重构版 `page/ChatPage.swift`；平铺Pod `ChatPage.swift` |
| ConversationsPage | `init(config: ConversationActionConfig? = nil, onConversationClick: ((NavigationInfo) -> Void)? = nil)` | `page/ConversationsPage.swift` |
| NavigationInfo | `conversation: ConversationInfo`、`locateMessage: MessageInfo?` | `page/ConversationsPage.swift` |
| ContactsPage | `init(config: ContactListConfig? = nil, onContactClick: ((ContactInfo) -> Void)? = nil, onGroupClick: ((GroupInfo) -> Void)? = nil)` | `page/ContactsPage.swift` |
| C2CChatSettingViewController | `init(userID:config:onSendMessageClick:onContactDelete:)` | `components/chatsetting/C2CChatSettingViewController.swift` |
| GroupChatSettingViewController | `init(groupID:config:onSendMessageClick:onGroupDelete:onGroupMemberClick:)` | `components/chatsetting/GroupChatSettingViewController.swift` |
| SearchBarView | `init(onTapItem: @escaping (Any) -> Void)` | `components/search/SearchBarView.swift` |

`ChatPage` 的 conversation 必传，其余默认值查源码；`locateMessage` 可用于搜索定位；`topBannerView: UIView?` 为公开业务属性。没有公开的 `messageListView`、`messageInputView`、`sendText` 或任意 `cellBuilder`。

搜索回调是 Any：参考 `page/impl/ConversationsPageImpl.swift` 的实际类型分支，不能强转所有结果为 MessageInfo。优先复用 ConversationsPage 已有搜索流。

## 配置定义与消费者

| 配置 | 定义/默认值 | 关键消费者或限制 |
| --- | --- | --- |
| ChatMessageListConfig | `components/messagelist/MessageConfig.swift`、`config/MessageListConfig.swift`、`config/MessageActionConfig.swift` | `page/ChatPage.swift` 特殊默认右头像；`config/MessageListConfig+Internal.swift` 解析气泡 |
| ChatMessageInputConfig | `components/messageinput/MessageInputConfig.swift`、`config/MessageInputConfig+Defaults.swift` | 录音/拍照/更多/表情/通话默认 true；录音 60000 ms；实际服务开通另核对 |
| ConversationActionConfig | `components/conversationlist/config/ConversationActionConfig+Defaults.swift` | 会话侧滑/更多动作，非 cell builder |
| ContactListConfig | `components/contactlist/config/ContactListConfig+Defaults.swift` | 顶部入口与搜索，非联系人行 renderer |
| C2CChatSettingConfig / GroupChatSettingConfig | `components/chatsetting/ChatSettingConfig.swift`、`impl/ChatSettingConfig+Defaults.swift` | 引用类型；初始化建议提供至少一个命名参数，避免 internal 无参 init 歧义 |
| MessageBubbleAppearance | `components/messagelist/config/MessageBubbleAppearance.swift` | 公开 init 支持 background/cornerRadius/stroke/contentInsets/minimumSize |

消息配置常用字段：isShowLeftAvatar/isShowRightAvatar/isShowTimeMessage/isSupportCopy/isSupportDelete/isSupportRecall/isSupportForward/isSupportQuote/isSupportMultiSelect/isSupportConvertToText/isSupportTranslate/isSupportReaction/enableTyping；全部精确拼写、参数顺序以构造器为准。

消息过滤：`addMessageExclusion(_:)`、`excludeMessagesByType(_:)`、`excludeCustomMessagesByBusinessID(_:)`、`clearMessageExclusions()`。这是 UI 过滤，不应拿它改变消息接收、服务器历史或未读统计。

## 扩展点

| 目标 | 实际 API | 来源 |
| --- | --- | --- |
| 自定义内容 | `MessageListView.registerCustomMessageCell(businessID:summaryProvider:makeContentView:)` | `components/messagelist/MessageListView.swift` |
| 摘要 | `MessageListView.registerCustomMessageSummary(matcher:)` | 同上 |
| 内容协议 | `MessageContentView: UIView`，`bind(message: MessageInfo, context: MessageContentContext)` | 同上 |
| 消息动作 | MessageActionCustomizer / MessageActionMenuAction | 同上 |
| 更多面板 | MessageInputActionCustomizer / MessageInputMenuAction / MessageInputActionIDs | `components/messageinput/MessageInputActions.swift` |
| 会话动作 | ConversationActionCustomizer / ConversationCustomAction | `components/conversationlist/ConversationListView.swift` |
| 联系人入口 | ContactListItemCustomizer / ContactCustomItem | `components/contactlist/ContactListView.swift` |
| 通用列表编辑 | CustomEditor / CustomItem | `components/common/uicustom/CustomEditor.swift` |
| 设置自定义行 | ChatSettingItemEditor / C2CChatSettingSection / GroupChatSettingSection | `components/chatsetting/ChatSettingItemEditor.swift` |

自定义业务 JSON 顶层包含 businessID；参考 Demo `Navigation/CustomLinkMessage.swift`，但不要照搬其未校验的外链跳转。通话/机器人等内置规则可能先匹配。

## Core 当前公开签名

- `LoginStore.shared.login(sdkAppID: Int32, userID: String, userSig: String, completion: CompletionClosure?)`
- `LoginStore.shared.logout(completion: CompletionClosure?)`
- `CompletionClosure = (Result<Void, ErrorInfo>) -> Void`；错误用 `code: Int` / `message: String`，不是 Android onSuccess/onFailure 参数。
- `ConversationInfo(conversationID: String)`，然后设置 `type`、`title`、`avatarURL`。
- `ChatUtil.getC2CConversationID(_:)`、`ChatUtil.getGroupConversationID(_:)`。
- `ConversationListStore.create()`；`loadConversations(option: ConversationLoadOption, completion: CompletionClosure?)`。
- `setReceiveMessageOpt(conversationID: String, opt: ReceiveMessageOption, completion: CompletionClosure?)`。
- `getConversationInfo(conversationID:completion:)` 的 completion 为 `GetConversationInfoCompletionHandler`，不能按上面的 Result closure 编造。具体 onSuccess/onFailure 要看 interface。
- `MessageInputStore.create(conversationID:)`；`sendMessage(payload:option:completion:)`。
- `CustomSendMessagePayload(customData: String, description: String? = nil, extensionInfo: String? = nil)`。
- `store.state.value`；`store.state.subscribe(StatePublisherSelector(keyPath: ...))`；Combine `.receive(on:)` / `.sink` / `.store(in:)`。

稳定持有 Store 和 tokens；Core 实现不可见时仅依据接口说明，不推测其重试/销毁/线程保证。基线中没有公开 destroy 方法。

## 主题与资源

- `components/basecomponent/theme/ThemeState.swift`：`ThemeState.shared.setThemeMode`、`setPrimaryColor`、`clearPrimaryColor`。
- `components/common/theme/TUIChatKitTheme.swift`：`TUIChatKitTheme.colors`。
- `components/basecomponent/utils/LanguageHelper.swift`：`LanguageHelper.saveLanguage`、`getCurrentLanguage`、`isRTL`、`applyLayoutDirection(to:)`、`LocalizedChatString`。
- `components/basecomponent/utils/AppBuilderHelper.swift`：`AppBuilderHelper.setJsonPath(path:)`，以及 JSON 读取。
- `TUIChatKit.podspec`、`resources/strings`、`resources/assets/chat`：资源必须保留到 `TUIChatKitBundle`。

## 外部 App 不可用的成员

不要在生成的 App 代码中使用：

- `ConversationListView`、`ContactListView`、`MessageInputView` 的业务实例化。
- `MessageListView(conversationID:...)`，其业务 init 为 internal。
- `ChatPage.implementation` / `ChatPageImpl`、internal config protocols、`MessageCellRegistry`、`CustomMessageSummaryRegistry`。
- `MessageActionIDs`、`ConversationActionIDs`、`FontScheme`、`RadiusScheme`、`SpacingScheme`、`AppLanguageChangedNotification`。
- 子类化非 open 的 `CustomNavigationBarViewController` 或调用其 internal 导航方法。
- Android 的 `MessageContentRenderer`、`ChatPageView.setup`、`ChatSettingCustomItem`、`ThemeStore`。

需要这些内部能力时先解释限制，再选择公开替代或明确的源码修改方案。
