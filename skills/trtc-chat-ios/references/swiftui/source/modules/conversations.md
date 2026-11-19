# 声明式会话列表

## 何时读取

会话行显示（头像、标题、摘要、时间、未读/免打扰/@/草稿/置顶）、侧滑与更多动作、加载刷新、会话页标题栏加号（新建单聊/建群）或搜索跳转异常时读。改接收选项的设置入口联动 settings。

## 首读（相对 U）

| 文件 | 符号/职责 |
| --- | --- |
| `components/conversationlist/impl/ConversationListImpl.swift` | `ConversationListImpl`（列表、`swipeActions`、动作执行、加载）与私有 `ConversationCell`（行绘制、摘要） |
| `components/conversationlist/config/ChatConversationActionConfig+Defaults.swift` | 动作开关缺省（读 `AppBuilderConfig.conversationActionList`）与公开 init |
| `page/impl/ConversationsPageImpl.swift` | 标题栏、加号菜单、`SearchBarView` 结果分支、新建会话/群后的跳转 |
| `components/messagelist/impl/core/MessageListHelper.swift` | `getMessageAbstract`，会话摘要的真实来源 |

## 调用链

`ConversationsPage` → `ConversationsPageImpl`（标题、搜索、加号）→ `ConversationListView` → `ConversationListImpl`（`ConversationListStoreHolder` 持有 `ConversationListStore`）→ `loadConversations` 与状态订阅 → `List` + `ForEach` 渲染 `ConversationCell` → 点击回调 `onConversationClick(ConversationInfo)` → 页面包装成 `NavigationInfo` 交给宿主。

动作：`configuredActions` = `defaultActions`（已读/未读、免打扰、置顶、清空、删除，各受配置开关控制）经 `actionCustomizer` 编辑，再加 `customActions`；`swipeActions` 显示前几项，其余进入 `presentMoreActionSheet`。动作直接调 Store：`deleteConversation`、`setReceiveMessageOpt`、`pinConversation`、`clearConversationMessages`、`markConversation`。

## 修改配方

### 行显示

`ConversationCell` 负责头像、标题、时间、发送状态图标与摘要。摘要规则在行内：有草稿时显示草稿前缀；否则用 `MessageListView.getMessageAbstract(lastMessage)`；免打扰且有未读时加 `[n条]` 前缀；群 @ 提示读 `groupAtInfoList`。未读显示同时看 `unreadCount` 与 `conversationMarkList.contains(.unread)`。截断用 `TruncatingSubtitleLabel`（UIKit 包装）。修改摘要文案时同步检查消息模块的摘要与自定义消息摘要注册。

行身份带 `isPinned`（`.id("\(conversationID)-\(isPinned)")`），置顶变化会重建行；改 id 规则要回归置顶/取消置顶动画与滚动位置。置顶背景色在 `conversationBackgroundColor`。

### 动作与配置

新增内置动作：在 `defaultActions` 增加、给 internal `ConversationActionIDs` 新 ID、在配置中加开关（走 [配置配方](../workflow.md)）。开关为 false 是隐藏入口，不改服务端状态；动作失败要给反馈，不只依赖状态推送。`ConversationsPage` 不透传 `customActions`，只能用 `actionCustomizer`。

免打扰写 `.notNotify` / `.receive`；细分的 `.notNotifyExceptMention` 等模式不能被一个布尔值抹掉，显示判断（文件开头 `ConversationInfo` 扩展）与设置页要同步。

### 加载、刷新与跳转

首载在 `onAppear` 中且有防重入；单条刷新 `refreshConversation`。搜索结果经 `ConversationsPageImpl.handleSearchResult` → `components/search/impl/SearchBarImpl.swift` 的 `searchResultNavigationInfo` 转成 `NavigationInfo`，保留定位消息。新建单聊/群完成后通过 `pendingCreatedChat` 与 `deliverCreatedChatIfReady` 等待页面可见再回调，避免在 NavigationLink 收起过程中跳转；加号是否显示读 `AppBuilderConfig.enableCreateConversation`。

## 不变量

- 会话数量、单会话 `unreadCount`、总未读、@ 提示、标记未读是不同口径，不互相替代。
- UI 动作不伪造状态，以 Store 结果和状态推送为准。
- 点击只回传导航信息，不负责清未读；清未读在聊天页可见时由消息模块完成。
- `NavigationInfo.locateMessage` 从搜索透传到聊天页。

## 最小回归

单聊/群聊、有/无草稿、免打扰有未读、@我、标记未读、置顶/取消、清空、删除、空列表、大量会话滚动；侧滑与更多面板、自定义动作；搜索结果跳转并定位；新建单聊/群后进入聊天页；深浅色/RTL。

总未读角标属于宿主；聊天页内的清未读转 [消息](messages.md)；免打扰设置转 [设置](settings.md)。
