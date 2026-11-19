# 声明式 SwiftUI 自定义

## 配置优先，先找消费者

本页用于 App 侧公开扩展；用户已要求改组件实现时，直接进入 [声明式源码索引](source/index.md)。不能把命令式的 `MessageContentView`、`UIView` 设置行、`TUIChatKitTheme` 或 Android 的 renderer/DSL 套到这里。页面创建后再修改原配置变量不保证已有界面重算；需要变化时重新创建对应页面。

| 目标 | 实际入口 | 注意 |
| --- | --- | --- |
| 对齐、头像/昵称、时间、气泡、背景、过滤、长按能力 | `ChatMessageListConfig` | 传入 `ChatPage(messageListConfig:)` |
| 录音、拍照、更多、表情、通话、回执、@、输入外观 | `ChatMessageInputConfig` | 传入 `ChatPage(messageInputConfig:)` |
| 会话侧滑/更多动作 | `ChatConversationActionConfig`（别名 `ConversationActionConfig`） | 传入 `ConversationsPage(config:)` |
| 联系人顶部入口/搜索 | `ChatContactListConfig`（未发布开发源码改名为 `ContactListConfig`） | 传入 `ContactsPage(config:)` |
| 单聊/群设置行 | `C2CChatSettingConfig` / `GroupChatSettingConfig` | 引用类型；`true` 仍受群权限约束 |
| 自定义消息 | `MessageListView.registerCustomMessageCell` | 内容是 SwiftUI `AnyView`，不是 UIView 协议 |
| 全局主题/语言/JSON | `ThemeState` / `LanguageState` / `AppBuilderHelper` | 先读刷新时机 |

前四个配置是值类型 `struct`，每项都有公开 init 命名参数和可读写的计算属性（如 `config.isShowVideoCall = false`）；底层存储是同名 `userXxx` 可选属性，`nil` 表示用缺省值。设置页配置是 `final class`。

## 功能开关

```swift
var input = ChatMessageInputConfig(
    isShowAudioRecorder: false,
    isShowVideoCall: false,
    isShowAudioCall: false
)
input.actionCustomizer = { editor in
    _ = editor.remove(MessageInputActionIDs.file)
}
let messages = ChatMessageListConfig(
    isShowRightAvatar: true,
    isSupportForward: false
)
let page = ChatPage(
    conversation: conversation,
    messageListConfig: messages,
    messageInputConfig: input,
    isShowMoreButton: false
)
```

- `ChatMessageListConfig` 的公开 init 必须按声明顺序传参。9.1.7821 的顺序为 …`isSupportMultiSelect, isSupportQuote, isSupportListenFromHere, isSupportConvertToText, isSupportTranslate, horizontalPadding, avatarSpacing, isSupportReaction, actionCustomizer`、各气泡外观、`bubbleMaxWidthRatio, background, enableTyping`；未发布开发源码已调整顺序。拿不准时先 `init()` 再逐项赋值属性，属性名两版一致。
- `isShowRightAvatar: true` 特意保留 `ChatPage` 不传配置时的外观；显式空配置的右头像缺省是 false。
- `isShowMoreButton` 是聊天标题栏“更多”，`input.isShowMore` 是输入栏更多面板。`actionCustomizer` 只改更多面板项。
- 多个开关的缺省来自 `AppBuilderConfig`：长按菜单五项（复制/撤回/引用/转发/删除）看 `messageActionList`，对齐看 `messageAlignment`，已读回执看 `enableReadReceipt`，发送按钮看 `hideSendButton`，会话动作看 `conversationActionList`。显式传值优先于 JSON。
- `isSupportForward: false` 是隐藏入口，不是服务端权限控制。

## 气泡与输入外观

```swift
let messages = ChatMessageListConfig(
    isShowRightAvatar: true,
    ownBubbleAppearance: MessageBubbleAppearance(
        background: .color(.systemBlue),
        cornerRadius: MessageBubbleCornerRadius(topLeft: 12, topRight: 12, bottomLeft: 12, bottomRight: 4)
    )
)
```

外观类型使用 UIKit 的 `UIColor`、`UIEdgeInsets`、`UIImage`，不是 SwiftUI `Color`。解析规则：`.left` 对齐取 left、`.right` 取 right、`.twoSided` 按自己/对方取 own/incoming；选中项再合并到 default 之上，没有选中项时直接用 default。列表背景用 `ChatMessageListConfig(background:)`，可为颜色、渐变或图片。

输入栏外观用 `ChatMessageInputConfig(appearance: MessageInputAppearance(...))`，分为容器填充、输入框 `MessageInputFieldAppearance`、录音/表情/更多/发送按钮 `MessageInputButtonAppearance`、更多面板 `MessageInputMorePanelAppearance`。浅色/深色、自己/对方、对齐模式、语音/图片/自定义消息都要验证。

## 自定义消息完整链路

按 [声明式自定义消息示例](examples/CustomMessage.swift)：

1. 定义稳定的 `businessID` 与 payload 版本，用 `JSONEncoder` 编码，顶层带 `businessID`。
2. 创建页面前注册一次 `MessageListView.registerCustomMessageCell(businessID:summaryProvider:contentViewBuilder:)`，`contentViewBuilder` 返回 `AnyView`。
3. 内容视图只画内容区：组件会自动套默认气泡背景，多选模式下禁用点击。视图内可用 `@EnvironmentObject var themeState: ThemeState` 取颜色字体。解析失败展示降级文案，不强制解包。
4. 用 `MessageInputStore.create(conversationID:)` 与 `.sendMessage(payload: .custom(...), option:completion:)` 发送；Store 放在持有者上。发送用 `CustomSendMessagePayload`，接收/摘要用 `CustomMessagePayload`，`customData` 是 String。
5. 附带摘要，验证会话预览、引用与转发；只需补摘要时用 `registerCustomMessageSummary(matcher:)`。

通话消息先于自定义注册匹配，不占用通话等内置 businessID。没有命令式那种 `MessageContentContext`；需要区分自己/对方时从 payload 外层取不到，内容视图应保持与左右无关，或另做源码方案。文字颜色必须匹配实际背景：默认气泡背景下用主文字色；自绘深色卡片时显式选可读颜色。打开链接前校验 URL。

## 菜单与自定义行

### 输入栏更多

```swift
let input = ChatMessageInputConfig(actionCustomizer: { editor in
    editor.add(MessageInputMenuAction(
        ID: "app.input.order",
        title: NSLocalizedString("SendOrder", comment: ""),
        iconName: "",
        icon: UIImage(systemName: "shippingbox"),
        onClick: openOrderPicker
    ))
})
```

`openOrderPicker` 是宿主的 `() -> Void`。`CustomEditor` 支持 add/remove/replace/insertBefore/insertAfter/moveBefore/moveAfter/clear；ID 非空且唯一，replace 保持旧 ID，锚点不存在不会插入。公开 ID 为 `MessageInputActionIDs.album/takePhoto/recordVideo/file/videoCall/audioCall`；拍照/录像项受 `isShowPhotoTaker` 控制，通话项受两个通话开关控制。

### 消息、会话与联系人

- 消息长按：`ChatMessageListConfig(actionCustomizer:)` 加 `MessageActionMenuAction(ID:iconName:systemIconFallback:label:isDangerous:isReactionEntry:handler:)`，handler 收到 `MessageInfo` 与 `MessageActionStore`；显式设非空 ID。内置动作 ID（如 `message.copy`）在 internal 枚举里，App 只能按字符串使用且需按当前源码核对，禁用内置动作优先用 Config 开关。
- 会话：`ChatConversationActionConfig(actionCustomizer:)` 加 `ConversationCustomAction(ID:title:dangerous:action:)`。`ConversationListView(onConversationClick:config:customActions:)` 的 `customActions` 只有直接使用该组件时可传，`ConversationsPage` 不透传。
- 联系人顶部：`ChatContactListConfig(itemCustomizer:)` 加 `ContactCustomItem(ID:title:iconName:badgeCount:onClick:)`；内置 ID 公开为 `ContactListItemIDs.newContacts/groupApplications/myGroups/blacklist`。只改顶部入口，不能替换 AZ 列表中的联系人行。

### 设置页行

`ChatSettingItemEditor<Section>.addCustomRow(_ view: AnyView, after:)`，没有 remove/replace；内置项用 Config 开关隐藏。

```swift
let config = GroupChatSettingConfig(
    isShowDoNotDisturb: true,
    itemCustomizer: { editor in
        editor.addCustomRow(AnyView(Text(NSLocalizedString("GroupHelp", comment: "")).padding()), after: .settings)
    }
)
```

C2C 分区：header/remark/switches/background/blacklist/actions/end；Group：header/memberPreview/settings/alias/switches/background/actions/end。

## 主题与语言

```swift
ThemeState.shared.setThemeMode(.dark)
ThemeState.shared.setPrimaryColor("#1C66E5")
languageState.setLanguage("ar")
```

- `ThemeState` 是 `ObservableObject`，设置后通过环境对象驱动组件重绘；颜色、字体、间距、圆角从 `themeState.colors/fonts/spacing/radius` 取。全局常量 `FontScheme`、`SpacingScheme`、`RadiusScheme` 是固定值，不随主题变化。`setPrimaryColor` 只接受 `#RRGGBB`，恢复用 `clearPrimaryColor()` 与 `.system`。主题会持久化到本地。
- 语言用宿主持有的 `LanguageState().setLanguage(_:)`，`LanguageHelper.saveLanguage` 不是公开 API。资源在 `ChatUIKitBundle`，当前有 en/zh-Hans/zh-Hant/ar；组件文本在渲染时读取，切换后需让页面重建（Demo 通过根视图 `.id` 与状态变化重建）。
- 组件不设置深浅色和方向：宿主根视图按 `themeState.isDarkMode` 设 `.preferredColorScheme`，按语言设 `.environment(\.layoutDirection, .rightToLeft)`。

## appConfig.json

声明式**不会自动加载** `Bundle.main` 中的 `appConfig.json`，需在创建任何组件前调用 `AppBuilderHelper.setJsonPath(path:)`（Demo 放在 AppDelegate 启动回调）。当前解析字段：`theme.mode/primaryColor`、`messageList.alignment/enableReadReceipt/messageActionList`、`conversationList.enableCreateConversation/conversationActionList`、`messageInput.hideSendButton`、`search.hideSearch`、`avatar.shape`。

- `theme.*` 只在 `ThemeState.shared` 首次创建且本地没有已保存主题时生效；调用晚于首次访问或旧安装已有主题都会让 JSON 看似无效。
- `search.hideSearch` 只被解析，开发基线中没有找到 UI 消费者，不能承诺有效。
- `enableCreateConversation` 由会话页右上角加号消费；`avatar.shape` 由头像组件消费。
