# 单群聊设置、免打扰与权限

## 何时读取

增加设置项/开关、群角色权限、免打扰读写/失败回滚、群资料或成员操作。先区分App加自定义行与修改内置源码。

## 首读（相对 U）

| 文件 | 符号/职责 |
| --- | --- |
| `components/chatsetting/impl/GroupChatSettingViewControllerImpl.swift` | 群设置组装、状态读取、按钮事件和Store动作 |
| `components/chatsetting/impl/ChatSettingConfig+Defaults.swift` | C2C/Group public init、显隐缺省 |
| `components/chatsetting/utils/GroupPermissionManager.swift` | 群类型/角色操作权限 |
| `components/chatsetting/ChatSettingItemEditor.swift` | 设置分区与addCustomRow |

仅单聊时将群Impl替换为 `components/chatsetting/impl/C2CChatSettingViewControllerImpl.swift`；新增公开配置再读 `components/chatsetting/ChatSettingConfig.swift`、`impl/ChatSettingConfig+Internal.swift`及对应公开控制器。不要默认同时读完所有子设置页。

## 调用链

公开C2C/GroupChatSettingViewController → private impl → 默认内置分区/行 + itemCustomizer → config显隐 AND 业务权限 → row事件 → ConversationListStore/GroupStore/其他对应Store → completion/state → UI更新。

群免打扰当前由ConversationListStore负责：`bindInteraction`中toggle转.notNotify/.receive，经完整conversationID调用setReceiveMessageOpt。首次状态由 `fetchInitialInfo` 的GroupSettingConversationInfoHandler获取，同时订阅ConversationListState.conversationList再 `refreshUI`，不能只看新建Store的空列表。`applyGroupInfo`、`canPerformAction`决定群资料/权限；显隐实际落在 `rebuildSwitchSection`，操作按钮落在 `rebuildActionSection`。

## 修改配方

### 新增设置行

只在App加业务行用ChatSettingItemEditor.addCustomRow(_:after:)，让UIView提供有效高度和事件；它不是支持remove/replace的通用CustomEditor。修改内置行则在Impl实际分区构建处添加，同时处理显隐和状态更新；不要只往配置里塞一行定义。

当前C2C分区含header/remark/switches/background/blacklist/actions/end，Group含header/memberPreview/settings/alias/switches/background/actions/end。默认发消息按钮要么接onSendMessageClick，要么明确隐藏，不能显示无响应按钮。

### 新增公开显隐/操作配置

走ChatSettingConfig存储 → convenience init/默认getter → internal协议（实际需要时）→ Impl消费；这两个Config为引用类型，区别于消息输入/列表的struct。保持未配置时原行为。提供至少一个命名参数以避免无参构造访问歧义，最终外部模块typecheck。

### 修改权限

先确定群类型/角色，再查GroupPermissionManager的操作能力；显隐config=true不代表可越过权限。界面状态改变、用户角色更新后重新计算相关行的可见和可操作性；动作前仍校验实际条件，服务端失败必须展示/回滚。

同一权限可能影响设置页、成员页及弹出菜单。只有需求涉及该能力时沿调用点查相关子页，不一次读完整chatsetting目录。

### 免打扰多状态/失败恢复

区分显示开关和数据动作；查初始会话查询、state订阅、toggle handler三个入口。普通bool切换可能覆盖.notNotifyExceptMention等细分模式，因此先定义新UI与枚举映射，再改写入和回显。

现状：免打扰/置顶调用的completion为nil，UISwitch先变化，尚无失败回滚；首载getInfo的失败处理也为空。要实现可靠失败恢复，需在这些实际调用点接Result/错误状态，再恢复先前可信state，不是复用一个已存在的回滚函数。设置已关闭/账号已变化时拒绝旧回调。

getConversationInfo使用真实completion handler类型，不臆造统一Result签名。群类型/角色首帧分别可能为work/member，最终由GroupInfo或成员列表更新；不能按初始默认值断言用户最终权限。

联动 [会话模块](conversations.md) 的formatter图标、badge、摘要前缀、菜单与@标签；仅改变这里开关会产生跨页口径不一致。涉及SDK总未读或离线推送的需求要说明Core/SDK能力，不能通过UI计数修复。

## 不变量

原始groupID用于群资料；conversationID用于会话动作；群免打扰不等于群禁言。权限与配置两道门不能互相替代。先查首载数据，不把“未查到”当false。切换/删除/退出/解散是不同动作，保留确认及服务端结果；所有UI回调需检查持有者与账号有效性。

## 最小回归

C2C及不同群类型；群主/管理员/普通成员、角色变化/退群；缺省与显式false/true；首载/失败/其他端更新；快速切换和返回；新项位置、空分区、长标题/RTL；免打扰全部相关枚举在设置与列表一致，不改变未授权的推送/统计语义。

未读布局/摘要联动只读conversations；控制器返回问题转 [navigation](navigation.md)，新增public API步骤转 [workflow](../workflow.md)。
