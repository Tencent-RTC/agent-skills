# 声明式源码任务索引

## 用法：从需求定位，而不是从目录遍历

先确认声明式 UI 根 U：以已发布 Pod 为准，`Pods/TUIChatKit_Swift/TUIChatKit_Swift`（9.1.7821）；内部未发布开发源码为 `ios_swiftui/chat/uikit`。两者都按 `page/` + `components/<模块>/{公开文件, config/, impl/}` 分层；联系人配置、视频录制实现与若干修复不同，见 [版本](../integration.md#目录与版本)。下文路径以发布版为准。相邻 Demo 记为 D（`ios_swiftui/chat/demo`、`demo_mini`），未带 Demo 不假设存在。

从下表选一个主任务；只在“联动条件”命中时读第二个模块。指南里的路径是相对 U 的定位线索，修改前检查符号和调用关系。没有对应任务时先读 [精简架构](architecture.md)。

| 需求/症状 | task | 主指南 | 何时联动 |
| --- | --- | --- | --- |
| 气泡、消息行、头像/昵称/时间、表情回应、长按菜单、滚动/定位 | messages | [消息显示](modules/messages.md) | 键盘/返回读 navigation；新增选项读 workflow |
| 自定义消息不展示、摘要不对 | custom-message | [消息显示](modules/messages.md) | 发送 payload 读 input；会话预览读 conversations |
| 输入工具栏、更多面板、表情、发送、草稿、引用、@ | input | [输入与发送](modules/input.md) | 面板与键盘高度读 navigation |
| 录音、转文字、取消、浮层 | recording | [输入与发送](modules/input.md) | 仅服务端失败进入 Core/SDK 边界 |
| 会话行、侧滑/更多、未读、摘要、新建会话/群 | conversations | [会话列表](modules/conversations.md) | 改接收选项读 settings |
| 单聊/群设置、免打扰、权限、成员管理、自定义行 | settings | [聊天设置](modules/settings.md) | 免打扰显示联动 conversations |
| 联系人列表/顶部入口、申请角标、加好友/加群 | contacts | [联系人](modules/contacts.md) | 跳转聊天读 navigation |
| 返回/更多、双标题栏、NavigationLink 不跳、安全区、键盘 | navigation | [导航与生命周期](modules/navigation.md) | 已读/定位读 messages |
| 品牌色、深浅色、语言/RTL、资源丢失、JSON 开关 | theme | [主题与资源](modules/theme.md) | 字段读到但不生效时回到对应 UI 模块 |
| 新增公开配置、跨模块开关 | config | [变更配方](workflow.md) | 必须再选真正消费该配置的模块 |

## 可选定位器

与命令式共用同一脚本，加 `--kit swiftui`。先读取脚本了解其只读行为，再按宿主授权规则执行；`<UI_ROOT>` 换成已确认的目录：

```bash
python3 scripts/locate_source.py --kit swiftui --root '<UI_ROOT>' --task messages
python3 scripts/locate_source.py --kit swiftui --root '<UI_ROOT>' --task settings --check-symbols
```

命令以 Skill 根为工作目录。脚本只检查固定候选目录（传入目录本身、`ios_swiftui/chat/uikit`、`TUIChatKit_Swift`、`Pods/TUIChatKit_Swift/TUIChatKit_Swift`），要求 `page/ChatPage.swift` 中有 `struct ChatPage: View` 且导入 SwiftUI；不 clone、不联网、不递归扫描。默认最多返回 4 个首读文件；输出 `missing` / `symbol-missing`（退出码 1）时先在同模块找改名或拆分，不能声称与基线一致。机器索引在 [tasks.json](tasks.json)，通常无需读全文。

## 扩大搜索与停止条件

- 首读不足：按主指南的配方打开下一个明确的消费者、配置或子视图。
- 大文件（`MessageView.swift`、`MessageListImpl.swift`、`GroupChatSettingImpl.swift` 等）先按符号读相关区间，不整文件作为首轮上下文。
- 涉及 Core 动作：读当前 swiftinterface 与实际调用点；只有用户授权且源码确实参与构建时才改 Core。
- 已找到“事件发起者、状态来源、渲染消费者、必须联动点、验证方法”后停止扩展。

## 非默认参考

- [architecture.md](architecture.md)：首次认知结构或跨层改动时读。
- [workflow.md](workflow.md)：新增 API/配置、多模块改动时读。
- [lessons.md](lessons.md)：遇到环境对象、导航、长按、主题 JSON 或版本差异时查经验。
