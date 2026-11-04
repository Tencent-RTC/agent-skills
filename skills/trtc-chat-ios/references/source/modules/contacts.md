# 联系人、顶部入口与申请状态

## 何时读取

联系人顶部行、自定义入口/搜索、AZ好友列表、申请角标、联系人/群点击路由或好友变化后不刷新。

## 首读（相对 U）

| 文件 | 符号/职责 |
| --- | --- |
| `page/impl/ContactsPageImpl.swift` | 页面装配、搜索/加号及宿主点击回调 |
| `components/contactlist/ContactListView.swift` | 内部列表门面、公开ContactCustomItem等扩展类型 |
| `components/contactlist/view/ContactListViewImpl.swift` | 顶部行和联系人列表渲染、事件消费 |
| `components/contactlist/config/ContactListConfig+Defaults.swift` | 新联系人/群申请/群组/黑名单/搜索默认开关 |

数据/申请角标再读 `components/contactlist/viewmodel/ContactListViewModel.swift` 的 `syncInitialState/subscribeState/loadData`；布局细分只读 `components/contactlist/view/ContactNavigationHeaderView.swift` 或 `components/common/azorderedlist/AZOrderedListCell.swift`、`AZOrderedListSorter.swift`。联系人备注/黑名单/删除落在C2C设置实现时才转settings，不把所有资料页面都归群设置。

## 调用链

ContactsPage公开config/callback → ContactsPageImpl组装组件 → ContactListView/Impl生成顶部项与好友列表 → 对应Store订阅/加载 → 行内容和badge更新。顶部入口和AZ好友cell是两条渲染路径。

ContactCustomItem的badgeCount可为AnyPublisher；持有和取消订阅由实际渲染实现负责。页面回传ContactInfo或GroupInfo给宿主，宿主再构造ConversationInfo/导航，不自动假设有完整Chat flow。

## 修改配方

### 增加/移动顶部入口

先看ContactListConfig各show开关与itemCustomizer，然后读 `ContactListViewImpl.buildHeaderItems` 生成内置项，`bindInteraction` 将结果交给headerView.setItems；好友列表走 `renderFriendList` → AZOrderedListItem → listView.setItems，搜索走 `matchesSearchQuery`。外部扩展不提供任意好友cell builder；源码改顶部项不得误改AZ列表的数据源。

新项ID唯一、badgeCount来源可取消、onClick有处理；只更换标题不能完成业务入口。通用CustomEditor与ChatSettingItemEditor不是同一套API。

### 修改好友cell/分组/搜索

从实际好友cell绑定与分组数据生成位置下钻，检查联系人显示名、头像、索引/搜索行为。仅改变显示字段不能破坏好友唯一ID；删除/改名/新增后排序和分组同步更新，快滚时清理旧头像/异步结果。

联系人列表搜索可由ContactListConfig.showSearchBar控制；ContactsPage顶部加号与搜索入口可能属于页面层，不能把列表配置误当所有页面控件的开关。JSON hideSearch需确认真实消费者。

### 申请角标与多源刷新

`ContactListViewModel` 初始从state.value同步，再订阅 `ContactState.friendList/friendApplicationUnreadCount` 与 `GroupState.unreadApplicationCount`；`loadData` 调用loadFriends/loadFriendApplications/loadApplications。它对“新friendList为空且旧列表非空”有保留旧值分支，最后一个好友删除后残留时必须检查此分支，不能只改cell。顶部badge来自两个Published计数，在buildHeaderItems绑定。不要用静态初始数字代替publisher，不在每次bind叠加新sink；切页/账号切换后旧订阅和迟到回调必须失效。

申请子页直接读 `components/contactlist/viewmodel/ContactSubPageViewModels.swift`、`view/subpage/FriendApplicationListViewController.swift` 和 `FriendApplicationCell.swift`；群申请查对应GroupApplication文件。当前进入申请页立即发起load和clearUnread，不等待加载成功；初始空态没有首载完成门控。同意/拒绝有成功失败提示，列表靠Store回推，不是本地手工删行。

`ContactNavigationHeaderView.setItems` 会取消旧badge订阅再重新绑定。修改时保持此清理链；角标清零、列表空态和业务操作结果分开处理，不能把顶部申请数等同Home消息总未读。

### 点击到聊天/群设置

沿公开onContactClick/onGroupClick查宿主是否接好，ContactsPage本身不固定打开用户资料。群成员详情的独立入口在 `components/chatsetting/UserProfileRouter.swift` 与 `impl/UserProfileRouterImpl.swift`；Group设置优先调用外部onGroupMemberClick，无回调才使用 `UserProfileRouter.open(userID:from:)`，不能概括为所有好友点击均走此Router。

联系人原始userID和群原始groupID分开，经ChatUtil构造会话ID，并设置正确type；删除好友/退出群后的旧对象不能继续路由。

## 不变量

顶部项、自定义项与好友列表身份分开；业务ID不随显示名变化。订阅持有唯一且可释放；申请处理失败不伪造成功；页面显隐配置不改变服务端好友关系/权限；公开页面与internal View访问级别明确。

## 最小回归

无好友/大量好友、分组边界、多语言名字、更新头像/备注/删除后排序；每个内置与自定义顶部项的显隐/重排/点击；好友与群申请角标分别增加/清零/失败；重复进出与账号切换；搜索结果导航、RTL和深浅色。

只有资料操作才读 [settings](settings.md)，只有聊天路由/子VC可见性才读 [navigation](navigation.md)，不要把三份指南都作为默认输入。
