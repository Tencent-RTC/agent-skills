# 声明式消息显示、消息行与自定义消息

## 何时读取

气泡/头像/昵称/时间/间距、表情回应、长按菜单、消息加载/滚动/定位、已读、自定义消息匹配或摘要异常时读。发送内容本身错误联动 input；纯 App 自定义先看 [声明式定制](../../customization.md)。

## 首读（相对 U）

| 文件 | 符号/职责 |
| --- | --- |
| `components/messagelist/MessageListView.swift` | 公开门面、`registerCustomMessageCell`、`registerCustomMessageSummary`、详情页工厂 |
| `components/messagelist/impl/core/MessageListImpl.swift` | `MessageListImpl` 的状态、`messageListContent`、倒置滚动、通知接收 |
| `components/messagelist/impl/cells/MessageView.swift` | 单条消息行：头像昵称、`messageContent`、`messageContentBody`、状态位、回应容器、长按 |
| `components/messagelist/config/ChatMessageListConfig+Defaults.swift` | 公开 init、各项缺省与 `AppBuilderConfig` 来源 |

自定义消息任务把后两项换成 `impl/cells/MessageCellRegistry.swift` 与 `components/common/impl/CustomMessageSummaryRegistry.swift`，摘要消费再看 `impl/core/MessageListHelper.swift` 的 `getMessageAbstract`。不要两组一次全读。

## 调用链

`ChatPageImpl` 创建 `MessageListView` → `MessageListImpl`（`MessageListStoreHolder` 持有 `MessageListStore`）→ `fetchMessages` / `loadMoreOlderMessages` / `handleMessageEvent` 写入 `messageList` → `filteredMessageList` 与 `mergePlaceholders` → 倒置 `ScrollView` + `LazyVStack` 中逐条 `MessageView` → 按 payload 选 `TextMessageView`、`ImageMessageView`、`VideoMessageView`、`AudioMessageView`、`FileMessageView`、`MessageCallContentView`、`MergeMessageView` 或注册的自定义 `AnyView` → `BubbleBackground` 绘制气泡。

自定义：`registerCustomMessageCell` → `MessageCellRegistry.register`（同时登记摘要）→ 从 `customData` JSON 取 `businessID` → `MessageView` 中先判 `CallMessageParser.parse`，再查 registry，最后按 `isShowUnsupportMessage` 降级。摘要经 `CustomMessageSummaryRegistry` 被 `getMessageAbstract` 读取，与内容视图是两条链。

长按：`MessageView` 背景中的 `BubbleLongPressBridge`（窗口级 `UILongPressGestureRecognizer`）→ 命中 `messageBubbleFrame`（来自 `ViewPositionKey` 上报）→ `MessageMenuManager.showMenu` → `impl/actions/MessageActionView.swift` 定位与绘制 → `MessageMenuButtons.swift` 的 `MenuButtonConfig.getVisibleButtons` 决定按钮。

## 修改配方

### 气泡、头像、时间和行布局

行结构在 `MessageView.messageContentWrapper`（左右、头像、多选框、`Spacer`）与 `messageContent`（状态位、主气泡、引用、辅助文本）。宽度上限看 `maxMessageBubbleWidth` / `availableMessageColumnWidth`，文本宽度看 `maxAttributedTextContentWidth`；气泡背景、圆角、描边与高亮在 `impl/cells/MessageViewExtensions.swift` 的 `BubbleBackground`、`ReactionBubbleContainer`、`LocateFlashOverlay`。外观解析在 `config/MessageListConfigProtocol+Appearance.swift` 的 `resolvedBubbleAppearance`。时间分隔看 `MessageView.getMessageTimeString`。

改宽度时注意 `.frame(maxWidth:)` 会撑满，改后回归“短文本 + 表情回应”；改几何时同时保证 `ViewPositionKey` 上报的是可见气泡，否则长按热区和菜单位置会错。发布版 9.1.7821 中回应容器仍带 `.frame(maxWidth: maxMessageBubbleWidth)`、位置上报挂在内层 `messageContentBody`，因此有“短消息加回应后气泡被撑宽、撑大部分长按无效”的已知问题。改缺省前比较 `ChatPage` 未传配置、空配置、显式覆盖三种情况。

### 表情回应

显示在 `impl/reactions/MessageReactionBar.swift`（`computeRows`、`chipLayout`），选择在 `ReactionEmojiPanelView.swift` 与 `ReactionEmojiPickerSheet.swift`，详情在 `ReactionDetailSheet.swift`。切换走 `MessageListImpl+Actions.swift` 的 `toggleReactionOptimistic`，失败要回滚；`isSupportReaction` 关闭时入口和栏都应隐藏。

### 加载、滚动、定位和已读

列表是倒置的（`flippedForInvertedList`），“到底部”是滚动到最新消息。首屏/定位看 `MessageListImpl+LoadingAndReceipts.swift` 的 `fetchMessagesWithTarget` / `fetchMessagesNormal`，引用定位与回跳看 `MessageListImpl+Navigation.swift` 的 `loadMessagesAroundQuoteTarget`、`performPendingQuoteLocateScroll`、`scrollToBottom`，@定位看 `loadMessagesAroundMention`。悬浮入口（回到最新、@我、回到引用）在 `impl/status/MessageTongueView.swift` 与 `MessageListFloatingEntry.swift`。

两条已读链分开：会话清未读在 `clearUnreadCountIfVisible`，门控为 `isPageVisible`、`isApplicationActive`、首屏完成与 @ 解析完成；逐消息回执在 `handleMessageAppear` → `debounceReadReceipt` → `sendBatchReadReceipts`，只对对方发送且 `needReadReceipt` 的消息。已读显示在 `MessageListHelper.shouldShowReadReceipt`。

### 长按菜单与多选

按钮集合改 `MenuButtonConfig.allButtons` / `getVisibleButtons` 与 `actionID(for:)`；位置改 `MessageActionView.MenuContentCalculator.calculateMenuPosition`；关闭统一 `MessageMenuManager.hideMenu()`。发布版 9.1.7821 中由列表空白点击触发；收到输入面板交互通知（`MessageInputView.didInteractNotification`）时只滚动到底部、不关闭菜单，点输入栏“更多”菜单不消失是已知问题，开发源码已在该通知处理中补关闭，见 [经验](../lessons.md)。多选状态在 `MessageListEnvironment.swift` 的 `MultiSelectManager`，进入/退出与批量转发删除在 `MessageListImpl+Actions.swift`。转发选择在 `impl/forwarding/ForwardTargetSelector.swift`。

### 自定义协议与摘要

改匹配顺序前读 `MessageView` 中 `.custom` 分支：通话消息优先，注册内容会被套上默认气泡并在多选下禁用点击。解析失败要降级。内容与摘要分别验证：会话预览、引用条、转发标题都读摘要。

## 不变量

- UI 显示与 Store 状态分离，失败不假造成功；过滤只影响显示。
- 消息身份（`generateMessageViewId`）、时序、分页、搜索 `locateMessage` 与阅读位置稳定。
- 修改后长按命中区域应等于可见气泡；菜单打开期间其他交互能按约定关闭。
- 已读只由真实可见且前台的页面触发；纯样式修改不引入业务动作。

## 最小回归

自己/对方、单群聊；短/长文本、表情、图片、视频、语音、文件、通话、合并、自定义、撤回、系统提示；左右/两侧对齐；表情回应增删与长按回应区域；深浅色/RTL；首屏、上拉历史、搜索与引用定位、@定位、新消息到达时在底部/在历史；多选转发删除；发送中→成功/失败。

键盘或返回问题转 [导航](navigation.md)；发送 payload 转 [输入](input.md)；会话摘要显示转 [会话](conversations.md)。
