# 消息显示、cell与自定义协议

## 何时读取

消息气泡/头像/时间/间距、渲染复用、列表刷新/滚动、自定义协议匹配、引用或会话摘要异常时读。发送内容本身错误再联动input；纯App自定义先看公开注册，不改registry。

## 首读（相对 U）

| 文件 | 符号/职责 |
| --- | --- |
| `components/messagelist/MessageListView.swift` | 组件门面、registerCustomMessageCell、MessageContentView、可见性转发 |
| `components/messagelist/view/MessageListViewImpl.swift` | 状态渲染到列表、滚动/更新及可见性 |
| `components/messagelist/viewmodel/MessageListViewModel.swift` | Store订阅、历史加载、消息处理 |
| `components/messagelist/MessageConfig.swift` | ChatMessageListConfig存储及外观类型 |

自定义协议任务替换后两项为 `components/messagelist/cell/MessageCellRegistry.swift`、`components/common/MessageListHelper.swift`，见定位器custom-message任务。不要两组一次全读。

## 调用链

ChatPageImpl创建MessageListView → 内部MessageListViewImpl与ViewModel → Core MessageListStore状态 → 数据处理/列表更新 → registry选内容 → cell bind与布局。用户动作/已读通过相应Store回到业务层，不能只把UI数组移除当作删除消息成功。

自定义注册：公开registerCustomMessageCell → 内部MessageCellRegistry工厂及摘要登记 → 解析messagePayload.custom中的String customData/businessID → 匹配规则 → makeContentView/bind；摘要由公共MessageListHelper等消费者读取，不等于view里的label。

## 修改配方

### 气泡、头像、时间和行布局

行容器直接读 `components/messagelist/cell/MessageBaseCell.swift` 的 `configure`、`rebuildLayout`、`layoutLeft/layoutRight`、`applyBubbleBackground/applyCustomBubbleAppearance`；内容复用走 `installContentViewIfNeeded`，清理在 `prepareForReuse`。动态高度从该内容view回到列表布局，再回查 `components/messagelist/config/MessageListConfig.swift` 与 `MessageListConfig+Internal.swift` 的默认/解析。外框、avatar/nickname、内容insets分别验证，不把全部间距叠加到内容view。

默认气泡按当前alignment选own/incoming或固定left/right，再与default字段合并。改getter默认前检查 `page/ChatPage.swift` 对右头像的特殊默认。新选项走 [配置配方](../workflow.md)，只增加user字段不算完成。

### 复用、异步尺寸和列表刷新

从出错消息的bind和更新入口看起：旧文本/图像/任务是否被重置、异步返回是否仍对应当前消息、尺寸变动是否使布局缓存失效。状态入口为 `MessageListViewModel.subscribeState/mergeMessageList`，历史从 `fetchInitialMessages/loadOlderMessages/loadMessagesAroundMessage` 进入；UI消费在 `MessageListViewImpl.subscribeViewModel/applyMessageList`。保持消息稳定身份，不用全量reload掩盖重复/顺序问题。

滚动锚点查Impl的 `topAnchor/restore(anchor:)/isPrepend`，跟随底部查 `isNearBottom/handleContentLayout/pinToBottomIfFollowing/handleStreamingContentDidGrow`；只读相关方法区间，不把整个大文件作为首轮上下文。已读分开查 `refreshResumedAndShown` 与 `syncVisibleMessageReadReceipts`。

新增渲染字段时同步检查Impl的 `mediaProgressOnlyChangedMsgIDs/reactionOnlyChangedMsgIDs/updateVisibleCells*` 快路径，避免被误判为只需更新进度或回应而吞掉新字段。气泡样式进一步读 `cell/MessageBubbleStyler.swift`；新增内置内容类型再核对 `cell/MessageContentView.swift` 的MessageContentViewFactory与registry/reuse ID，协议本身仍定义在MessageListView.swift，别读错同名文件。

仅影响某类消息就修改其cell，不把整个MessageListViewImpl重写。滚动修复还要检查用户是否在读历史、是否正在分页/定位，以及布局完成后是否被重复强制滚到底部。

### 自定义协议、工厂与摘要

修改匹配顺序前读registry真实分支：通话、机器人、系统协议可能优先于客户注册，不能占用保留businessID。确认payload解析失败降级到unsupported，而不是强制cast崩溃。

内容与摘要分别处理：显示正确不代表会话预览/引用正确。新增业务规则时登记factory和summaryProvider；仅补摘要用公开registerCustomMessageSummary，来源仍查registry消费。引用和转发需要解析同一稳定payload，不用显示字符串代替业务数据。

修改内容view时只使用真实MessageContentContext；源码内可读内部字段，但不能让外部协议实现依赖internal config/messageListStore。模板/公开契约变更必须普通import类型检查。

### 消息过滤、长按与已读

过滤规则在Config到实际数据处理链上确认，不用隐藏cell改变服务端历史/未读。动作配置还可能在 `config/MessageActionConfig.swift` 与 `menu/`构建，禁用一个入口不表示禁止服务端动作。

分开检查三条链，不把它们概括成同一“已读开关”：

- 会话清未读：`refreshResumedAndShown` 以host可见、app active、window存在作为门控，调用ViewModel.syncConversationAsRead清计数并取消.unread标记；会话列表点击只回传导航信息，不负责点击即清未读。
- 逐消息回执：`syncVisibleMessageReadReceipts` 对可见消息按对方发送且needReadReceipt过滤，当前没有复用上面的active门控；需改变此条件时单独设计并验证。
- 已读状态显示：`components/messagelist/readreceipt/MessageReadReceiptHelper.swift` 按全局显示配置、本方消息、needReadReceipt、发送成功、非tips等条件决定。

长按用Impl中按msgID重新取得的latestMessage，不用过时cell绑定对象；菜单显隐查 `menu/MessageActionMenuAction.swift.MessageActionMenuProvider.visibleActions`，弹层查 `menu/MessageActionMenuController.swift`，辅助文本状态查ViewModel。多选下业务点击、头像点击和长按均需对应状态。

## 不变量

- UI显示与Store业务状态分离，错误/失败路径不假造成功。
- 消息身份、时序、分页、搜索locateMessage和历史滚动位置保持稳定。
- 每次bind重置复用状态；取消迟到异步回调，避免旧内容/尺寸覆盖新消息。
- 默认协议优先级和自定义降级可解释，摘要覆盖引用/会话等实际消费者。
- 可见性与已读不因纯样式变化触发额外业务动作；保留原缺省显示。

## 最小回归

自己/对方、单群聊、长短文本/图片/语音/系统/自定义消息；左右/固定对齐；深浅色/RTL；首次加载、上拉历史、搜索定位、发送中→成功/失败、修改/撤回、多选、快滚复用、异步高度变化。摘要检查会话预览和引用，分页/定位不跳到底部。

键盘遮挡或转场后未读错误转 [导航模块](navigation.md)；发送payload/输入态转 [输入模块](input.md)；会话摘要最终绘制转 [会话模块](conversations.md)。
