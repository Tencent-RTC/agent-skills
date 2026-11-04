# 会话列表、摘要、未读和动作

## 何时读取

会话cell布局/复用、红点/数字/免打扰标识、摘要/@标签、侧滑/更多、会话分页和刷新。Home Tab角标不是这个cell，转navigation的宿主分支。

## 首读（相对 U）

| 文件 | 符号/职责 |
| --- | --- |
| `components/conversationlist/viewmodel/ConversationListViewModel.swift` | Store订阅、加载、静音/删除等业务动作 |
| `components/conversationlist/view/ConversationCell.swift` | cell绑定、布局与未读显示 |
| `components/conversationlist/utils/ConversationCellFormatter.swift` | 摘要、免打扰图标、@信息格式 |
| `components/conversationlist/view/ConversationListViewImpl.swift` | 列表事件、侧滑/更多和配置消费 |

页面入口/搜索路由才读 `page/ConversationsPage.swift`、`page/impl/ConversationsPageImpl.swift`。动作配置默认值在 `components/conversationlist/config/ConversationActionConfig+Defaults.swift`。

## 调用链

ConversationsPage → PageImpl装配内部ConversationListView → ViewModel的ConversationListStore → subscribe conversationList → 列表刷新/cell bind → formatter生成展示信息。点击回传NavigationInfo给宿主，是否导航取决于宿主回调。

侧滑/更多 → 配置筛选与自定义动作 → ViewModel或宿主动作 → Store结果/状态 → 刷新。不能把App侧config只作用于动作列表的事实推导成支持任意会话cell builder。

## 修改配方

### cell布局或摘要

先用ConversationCell的绑定数据确认是不是正确conversation，再改实际约束/样式；同时检查复用重置。摘要显示问题看formatter和common/MessageListHelper的摘要消费，自定义消息注册由messagelist维护。不要直接从消息JSON拼文本绕过全局摘要规则，导致引用与列表不一致。

### 免打扰红点/数字/@标记

分别查formatter的免打扰图标判断、cell的badge选择，以及 `subtitleAttributedText/appendUnreadPrefixIfNeeded/finalSubtitleText/atTagText`；菜单切换实际动作在ViewModel的 `muteConversation`。基线图标只认.notNotify，副标题与设置页使用!=.receive；先检查当前版本，新增细分接收模式时统一产品定义而非一律!=receive。

数据首读ViewModel的 `subscribeState/loadConversations/sanitize`；清未读、标未读和清历史分别是 `clearUnreadCount/markAsUnread/clearHistory`，不能互换。

免打扰不等于禁言；unreadCount、mark unread、groupAtInfoList、totalUnreadCount和离线推送不是同一数值。只改显示不改Store总未读口径；如果新需求改变统计，必须明确数据层支持。实际设置链联动settings，不只增加cell枚举分支。

### 侧滑/更多动作

找ViewImpl中的动作列表构建、内置ID和顺序，再查Config默认/customizer。添加操作同时接权限、确认、失败回滚。当前会话入口有侧滑/更多，不照Android说明承诺所有操作通过长按。

内部ConversationActionIDs可在模块源码修改；外部App不能引用internal ID常量。修改内置ID可能影响customizer顺序和已有集成，需兼容说明。

### 分页/过滤/首载刷新

当前UI只做默认load，尚未接入loadMore/触底分页；`sanitize` 仅去空ID和按ID去重，没有业务过滤入口。新增分页/过滤必须接首载参数、hasMore、触底加载、推送增量更新与空态，不是修一段现有分页代码或只过滤cell。

当前load回调无论成功失败都会结束首载标记，空态仅依据首载结束和列表为空；多数操作completion为nil，没有统一失败提示/回滚。需要区分加载失败与真实空列表时，明确增加错误状态和消费者，不能声称已有错误页。

重绑定取消旧tokens，不让一次事件导致多次load；新增分页后同步检查过滤和排序。

同一会话更新用稳定conversationID。置顶/排序、删除/清历史/清未读三种操作语义不同，不用本地数组删除替代Store成功，不为刷新bug清空历史。

## 不变量

保留完整conversationID、稳定排序/分页和消息定位；单群聊/会议群等规则由实际类型与权限决定；复用不串头像/角标；Store是状态来源，失败不假造成功。totalUnread由Core发布，未经明确需求不自己逐cell求和覆盖它。

## 最小回归

首次空/非空、分页与重复刷新；置顶/取消、侧滑自定义动作、取消/失败；新消息、草稿、撤回摘要、@我/@全体、标记未读、免打扰各枚举模式；左右布局/RTL、快滚复用。设置页返回或其他端改变接收选项后列表同步更新。

涉及群设置的真实接收模式转 [settings](settings.md)，自定义协议摘要转 [messages](messages.md)，Home总未读角标转 [navigation](navigation.md)，只在这些条件命中时读额外指南。
