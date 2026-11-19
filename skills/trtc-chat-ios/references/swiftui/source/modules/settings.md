# 声明式聊天设置

## 何时读取

单聊/群资料、备注、免打扰、置顶、聊天背景、黑名单、清空/删除/退群/解散、群公告/类型/加群方式/邀请方式、成员列表与管理（管理员、禁言、转让、添加/移除）、权限显隐、自定义设置行异常时读。

## 首读（相对 U）

| 文件 | 符号/职责 |
| --- | --- |
| `components/chatsetting/impl/GroupChatSettingImpl.swift` | `GroupChatSettingImpl` 各分区（`headerSection`、`memberSection`、`settingsSection`、`switchSection`、`actionSection`）、`canPerformAction`、`customRowsPlain`；同文件含成员管理等子视图 |
| `components/chatsetting/impl/C2CChatSettingImpl.swift` | 单聊资料与开关、黑名单、删除好友、清空、`customRows` |
| `components/chatsetting/impl/GroupPermissionManagerImpl.swift` | 群类型 × 角色 × `GroupPermission` 权限矩阵 |
| `components/chatsetting/config/GroupChatSettingConfig+Defaults.swift` | 群设置显示开关缺省与公开 init（单聊对应 `C2CChatSettingConfig+Defaults.swift`） |

`GroupChatSettingImpl.swift` 近两千行，按符号读相关区间：成员管理 `GroupManagementView`、禁言 `MuteMemberSelectionView`、管理员 `GroupAdminPickerView`、添加/移除 `AddGroupMemberView` / `RemoveGroupMemberView`、成员列表 `GroupMemberListView`、转让 `TransferOwnershipView`。行控件在 `impl/SettingComponentsImpl.swift`（`SettingRowView`、`SettingRowToggle`、`SettingActionRow`），背景选择在 `impl/ChatBackgroundPickerView.swift`。

## 调用链

`C2CChatSettingView` / `GroupChatSettingView` → 对应 Impl → Store：单聊用 `ContactStore.shared`（备注、黑名单、删除好友）与 `ConversationListStore.create()`（免打扰、置顶、清空）；群用 `GroupStore.shared`、`GroupMemberStore.create(groupID:)` 与 `ConversationListStore`。结果写回 `@State` 并渲染行；行显隐 = 配置开关 **且** `canPerformAction(权限)`（`GroupPermissionManager.hasPermission(groupType:memberRole:permission:)`）。

自定义行：配置的 `itemCustomizer` 在 Impl 中被调用生成 `ChatSettingItemEditor.customRows`，再在每个分区之后插入（群为 `customRowsPlain(after:)`）。聊天背景存于 `components/common/impl/ChatBackgroundStore.swift`，通过 `ChatBackgroundStore.didChangeNotification` 通知消息列表刷新。

## 修改配方

### 显隐与权限

隐藏某行改配置开关；“可见但无权操作”改权限矩阵。两者不要混用：配置 true 也不能越过群类型/角色，矩阵放开也不等于服务端允许。改矩阵时检查所有 `GroupType`（`work`、`publicGroup`、`meeting`、`avChatRoom`、`community`）与 owner/admin/member 三种角色，并确认对应动作在服务端确实可执行。新增权限要同时加 `GroupPermission` 枚举、矩阵各行与 UI 判断。

### 开关动作

免打扰写 `.notNotify` / `.receive`，置顶写 `pinConversation`。当前这些写入传 `completion: nil`，界面先变、失败不回滚；需要严格一致时补失败回滚与提示，不能用 UI 开关值覆盖服务端状态。细分接收模式需与会话行的免打扰判断同步。

### 资料编辑与群管理

群名称/公告/备注编辑经 `TextEditSheetImpl`，头像经 `AvatarSelectorImpl`；加群/邀请方式、管理员、禁言、转让、移除成员均为远端副作用，改动后用真实账号授权验证。退群/解散在 `actionSection` 的确认弹窗与 `quitGroup` / `dismissGroup`，成功后回调 `onGroupDelete` 交宿主返回；单聊删除好友回调 `onContactDelete`。

### 导航与自定义行

设置页用系统导航栏（`navigationBarTitle` + `navBackButton`）：传了 `onBack` 时调用它，否则 `presentationMode.dismiss()`。成员详情可由宿主通过 `onGroupMemberClick` 或 `memberDetailDestination` 接管。自定义行是 `AnyView`，自行负责高度与点击，不能删除或替换内置行。

## 不变量

- 显示开关、权限矩阵、服务端权限三层分开；UI 不伪造免打扰/置顶/角色状态。
- 远端副作用（删好友、退群、解散、禁言、转让）需确认弹窗，失败保留错误。
- 删除/退出后宿主负责回到合适的页面，不留下指向已失效会话的聊天页。
- 子页与弹层都能拿到 `ThemeState`。

## 最小回归

单聊：备注、免打扰、置顶、背景、黑名单、清空、删除好友、发消息/通话入口开关、自定义行。群聊：群主/管理员/成员三种角色 × 至少两种群类型下的各行显隐；公告与名称编辑、加群/邀请方式、管理员增删、禁言、转让、添加/移除成员、退群、解散；返回与删除后的导航；深浅色/RTL。

免打扰在会话行的显示转 [会话](conversations.md)；聊天背景在消息页的显示转 [消息](messages.md)。
