# 声明式 API 地图与源码依据

## 如何使用

本页是公开 API 查表，不是源码任务的必读大纲。修改内部实现先读 [声明式源码索引](source/index.md)，仅在访问级别、构造器或公开调用不明确时查对应节。

路径相对声明式源码根：发布 Pod 为 `Pods/TUIChatKit_Swift/TUIChatKit_Swift`，内部开发源码为 `ios_swiftui/chat/uikit`。本表以已发布的 9.1.7821 为准，并标注未发布开发源码的差异；先按 [版本](integration.md#目录与版本) 核对客户 `Podfile.lock` 与实际文件。Core 查 `AtomicXCore.framework/Modules/AtomicXCore.swiftmodule/*.swiftinterface`。

## 页面

| 符号 | 公开入口 | 源码 |
| --- | --- | --- |
| ChatPage | `init(conversation:locateMessage:messageListConfig:messageInputConfig:isShowMoreButton:showsNavigationBar:topBannerView:onBack:onUserClick:onMoreClick:)`，除 conversation 外都有默认值 | `page/ChatPage.swift` |
| ConversationsPage | `init(config: ConversationActionConfig? = nil, onConversationClick: ((NavigationInfo) -> Void)? = nil)` | `page/ConversationsPage.swift` |
| NavigationInfo | `conversation`、`locateMessage`，有公开 init | 同上 |
| ContactsPage | 9.1.7821：`init(config: ChatContactListConfig?, onContactClick: ((AZOrderedListItem) -> Void)?, onGroupClick: ((AZOrderedListItem) -> Void)?)`；`AZOrderedListItem` 有 `userID`、`title`、`avatarURL`、`extraData`（`ContactInfo`/`GroupInfo`）。开发源码改为 `ContactListConfig?` 与 `ContactInfo`/`GroupInfo` 回调 | `page/ContactsPage.swift` |
| C2CChatSettingView | `init(userID:config:onSendMessageClick:onContactDelete:onBack:)` | `components/chatsetting/C2CChatSettingView.swift` |
| GroupChatSettingView | `init(groupID:config:onSendMessageClick:onGroupDelete:onGroupMemberClick:memberDetailDestination:onBack:)` | `components/chatsetting/GroupChatSettingView.swift` |
| FriendAwareUserProfileView | `init(userID:friendContent:)`，好友显示宿主内容，非好友显示加好友资料 | `components/chatsetting/FriendAwareUserProfileView.swift` |
| SearchBarView | `init(onTapItem:chatDestination:)`、`init(onTapItem:preservesSearchOnSelection:)`，回调 `Any` | `components/search/SearchBarView.swift` |

`topBannerView` 是 `AnyView?`。页面都是 `View` 结构体，内部持有 private `*Impl`；没有公开的列表/输入实例属性或任意 cell builder。

## 与命令式不同：组件视图是公开的

声明式的四个组件视图有公开构造器，可以脱离页面单独组装（命令式对应 init 是 internal）：

- `MessageListView(conversationID:config:locateMessage:onUserClick:onMultiSelectModeChange:)`
- `MessageInputView(conversationID:config:)`
- `ConversationListView(onConversationClick:config:customActions:)`
- `ContactListView(config:onContactClick:onGroupClick:)`（参数类型同 `ContactsPage`）

单独组装时由宿主负责页面职责：标题栏、`ThemeState` 环境对象、导航容器、多选模式下隐藏输入栏、合并消息详情与已读回执的跳转（通过环境值 `openMergedMessageDetail`、`openReadReceiptDetail` 接入），以及 `MessageInputView.typingStatusBusinessID` 消息的过滤。优先使用 `ChatPage`，确有布局需求再拆。

## 配置定义与消费者

| 配置 | 定义 / 默认值 | 关键消费者或限制 |
| --- | --- | --- |
| ChatMessageListConfig | `components/messagelist/MessageListConfig.swift`、`config/ChatMessageListConfig+Defaults.swift` | 经 internal `MessageListConfigProtocol` 与 `MessageActionConfigProtocol` 被列表、cell、菜单消费；`ChatPageImpl.resolvedMessageListConfig` 有特殊默认 |
| ChatMessageInputConfig | `components/messageinput/MessageInputConfig.swift`、`config/ChatMessageInputConfig+Defaults.swift` | 录音/拍照/更多/表情/通话默认 true；录音时长缺省见 `defaultAudioMaxRecordDurationMs` |
| MessageInputAppearance 等 | `config/MessageInputAppearance+Defaults.swift` | 按钮、输入框、更多面板外观 |
| ChatConversationActionConfig | `components/conversationlist/ChatConversationActionConfig.swift`、`config/...+Defaults.swift` | 会话侧滑/更多动作；缺省读 `AppBuilderConfig.conversationActionList` |
| ChatContactListConfig | `components/contactlist/ChatContactListConfig.swift`、`config/ChatContactListConfig+Defaults.swift`（开发源码改名为 `ContactListConfig`） | 顶部入口与搜索，非联系人行 renderer |
| C2C/GroupChatSettingConfig | `components/chatsetting/ChatSettingConfig.swift`、`config/*ChatSettingConfig+Defaults.swift` | `final class`，公开 convenience init；群项还受 `GroupPermissionManager` 约束 |
| MessageBubbleAppearance | `config/MessageBubbleAppearance+Defaults.swift` | background/cornerRadius/stroke/contentInsets/minimumSize，`merged(over:)` |

消息过滤：`addMessageExclusion(_:)`、`excludeMessagesByType(_:)`、`excludeCustomMessagesByBusinessID(_:)`、`clearMessageExclusions()`（mutating），只影响 UI 显示。

## 扩展点

| 目标 | 实际 API | 来源 |
| --- | --- | --- |
| 自定义内容 | `MessageListView.registerCustomMessageCell(businessID:summaryProvider:contentViewBuilder:)`，内容为 `AnyView` | `components/messagelist/MessageListView.swift` |
| 摘要 | `MessageListView.registerCustomMessageSummary(matcher:)` | 同上 |
| 占位消息 | `MessageListView.addPlaceholder(conversationID:info:)` / `removePlaceholder` + `MessagePlaceholderInfo` | 同上 |
| 消息动作 | `MessageActionCustomizer` / `MessageActionMenuAction` | 同上 |
| 更多面板 | `MessageInputActionCustomizer` / `MessageInputMenuAction` / `MessageInputActionIDs` | `components/messageinput/MessageInputView.swift` |
| 会话动作 | `ConversationActionCustomizer` / `ConversationCustomAction` | `components/conversationlist/ChatConversationActionConfig.swift` |
| 联系人入口 | `ContactListItemCustomizer` / `ContactCustomItem` / `ContactListItemIDs` | `components/contactlist/ChatContactListConfig.swift` |
| 通用列表编辑 | `CustomEditor` / `CustomItem` | `components/common/CustomEditor.swift` |
| 设置自定义行 | `ChatSettingItemEditor` / `C2CChatSettingSection` / `GroupChatSettingSection`，行为 `AnyView` | `components/chatsetting/ChatSettingConfig.swift` |

另有公开的基础控件（`AvatarView`、`ButtonView`、`Toast`、`AlertDialogView`、`AZOrderedListView`、`UserPickerView`、`EmojiPickerView`、`ImageViewerView`、`VideoPlayer`、`VideoRecorderView`、`AudioRecorder`、`AudioPlayer`、`FilePicker` 等），宿主可复用其样式，但它们不是 Chat 页面的替换插槽。

## Core 当前公开签名

与命令式相同，见 [命令式 API 地图·Core](../shared/api-map.md#core-当前公开签名)：`LoginStore.shared.login(sdkAppID:userID:userSig:completion:)`、`logout(completion:)`、`ConversationInfo(conversationID:)`、`ChatUtil.getC2CConversationID/getGroupConversationID/getUserID/getGroupID`、`MessageInputStore.create(conversationID:)`、`CustomSendMessagePayload(customData:description:extensionInfo:)`、`StatePublisherSelector`。SwiftUI 中用 `.onReceive(store.state.subscribe(...))` 或在 `ObservableObject` 中持有 Combine token。

## 主题与资源

- `components/basecomponent/theme/ThemeState.swift`：`ThemeState.shared`、`setThemeMode`、`setPrimaryColor`、`clearPrimaryColor`、`colors/fonts/spacing/radius`、`isDarkMode`、`currentMode`。
- `components/basecomponent/utils/LanguageState.swift`：`LanguageState.setLanguage`、`LanguageHelper.getCurrentLanguage`、`LocalizedChatString`。
- `components/basecomponent/utils/AppBuilderHelper.swift`：`AppBuilderHelper.setJsonPath(path:)`、`AppBuilderConfig.shared`。
- `components/basecomponent/utils/AtomicXChatResources.swift`：`AtomicXChatResources.resourceBundle`、`image(named:)`；资源包 `ChatUIKitBundle`。

## 外部 App 不可用的成员

不要在生成的 App 代码中使用：

- `ChatPageImpl` 等 `*Impl`、`MessageCellRegistry`、`CustomMessageSummaryRegistry`、`MenuButtonConfig`、`MessageMenuManager`、`MultiSelectManager`。
- internal 协议 `MessageListConfigProtocol`、`MessageActionConfigProtocol`、`*ConfigProtocol`，以及 `RoomMessageListConfig`。
- `ConversationActionIDs`（internal）、`LanguageHelper.saveLanguage`、`ChatCallEventPublisher`、`HostViewControllerBeacon`、`ChatUIKitNavigation`。
- 命令式符号：`MessageContentView`、`MessageContentContext`、`TUIChatKitTheme`、`C2CChatSettingViewController`、`UIView` 版设置行；以及 Android 的 renderer/`ThemeStore`。

需要这些内部能力时先解释限制，再选择公开替代或明确的源码修改方案。
