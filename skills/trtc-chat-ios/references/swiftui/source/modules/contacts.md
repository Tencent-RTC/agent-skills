# 声明式联系人

## 何时读取

联系人 AZ 列表、搜索、顶部入口（新的联系人/群申请/我的群聊/黑名单）及角标、申请处理、加好友/加群、联系人或群点击跳转异常时读。跳转后的聊天页问题读 navigation。

## 首读（相对 U）

| 文件 | 符号/职责 |
| --- | --- |
| `page/impl/ContactsPageImpl.swift` | 标题栏与加号菜单、`AddFriendView` / `JoinGroupView` 跳转、宿主回调 |
| `components/contactlist/impl/ContactListImpl.swift` | `ContactListImpl`（`headerItems`、搜索过滤、AZ 列表、子页呈现）、`ContactBadgeCounts`、申请/群/黑名单子页 Impl |
| `components/contactlist/config/ChatContactListConfig+Defaults.swift` | 顶部入口与搜索开关缺省、公开 init（开发源码为 `ContactListConfig+Defaults.swift`） |
| `components/contactlist/impl/AddContactViewImpl.swift` | 加好友/加群搜索、详情、申请发送 |

以发布版 9.1.7821 为准：配置为 `ChatContactListConfig`，回调为 `AZOrderedListItem`（`extraData` 携带 `ContactInfo` / `GroupInfo`）；未发布开发源码改为 `ContactListConfig` 与直接回调 `ContactInfo` / `GroupInfo`，先读客户实际 `page/ContactsPage.swift`。

## 调用链

`ContactsPage` → `ContactsPageImpl` → `ContactListView` → `ContactListImpl` → `ContactStore.shared.loadFriends` + 状态订阅得到 `friendList` → 搜索过滤 `matchesSearchQuery` → 包装为 `AZOrderedListItem(extraData: contact)` → `AZOrderedListView` 分组渲染 → 点击回调 `onContactClick(AZOrderedListItem)`。

顶部入口：`headerItems` 按开关构建内置 `ContactCustomItem`（ID 见公开 `ContactListItemIDs`）→ `itemCustomizer` 经 `CustomEditor` 编辑 → 渲染为 `ContactNavigationRow`。角标由 `ContactBadgeCounts` 订阅 `ContactState.friendApplicationUnreadCount` 与 `GroupState.unreadApplicationCount`。新的联系人与群申请用 `fullScreenCover` 呈现并显式注入 `ThemeState`；我的群聊、黑名单用 `NavigationLink`，群点击经 `GroupListView` 转成 `onGroupClick(GroupInfo)`。

## 修改配方

### 列表与搜索

显示名统一走 `ContactDisplayName.name(for:)`（备注 → 昵称 → userID）；搜索候选同时匹配显示名、userID、昵称与备注。改排序或分组先看 `basecomponent/basiccontrols/AZOrderedListView.swift` 与 `PinyinIndexHelper.swift`，不要只改联系人这一处。搜索栏显隐读 `showSearchBar`。

### 顶部入口与角标

新增内置入口：在 `headerItems` 增加 `ContactCustomItem`、在 `ContactListItemIDs` 增加公开 ID、在配置加开关（走 [配置配方](../workflow.md)），并补资源与多语言。角标只读 Store 计数，处理申请后由 Store 更新，不在 UI 本地减数；清申请未读属于业务动作，确认调用位置与失败处理。`itemCustomizer` 只改顶部入口，不能替换好友行。

### 申请与加好友/加群

好友申请 `FriendApplicationListViewImpl` / `FriendApplicationCell`，群申请 `GroupApplicationListViewImpl` / `GroupApplicationCell`，按钮 `ContactApplicationButton`。加好友/加群流程在 `AddContactViewImpl.swift` 的 `AddFriendViewImpl`、`AddContactDetailViewImpl`、`JoinGroupViewImpl`、`JoinGroupDetailViewImpl`。这些是远端副作用，测试需授权；失败保留错误并恢复按钮状态。

### 回调与跳转

页面不自己打开聊天，只回调 `ContactInfo` / `GroupInfo`；宿主用 `ChatUtil.getC2CConversationID` / `getGroupConversationID` 构造 `ConversationInfo`，不要重复拼前缀。从加群流程进入群聊时 `ContactsPageImpl` 复用 `onGroupClick`。

## 不变量

- 好友、申请、群、黑名单数据来自 Store，不在 UI 伪造或本地修改计数。
- 每个独立呈现的子页都注入 `ThemeState`。
- 回调参数类型与公开签名一致；跨版本差异只在宿主适配，不在组件内做隐式转换。

## 最小回归

空列表/大量联系人与 AZ 索引、搜索（备注/昵称/ID/中文拼音）、顶部入口开关与自定义入口、申请角标增减、同意/拒绝申请、加好友与加群流程、黑名单增删、群列表进入群聊、联系人点击进入单聊；深浅色/RTL。

聊天页跳转转 [导航](navigation.md)；好友资料与设置页转 [设置](settings.md)。
