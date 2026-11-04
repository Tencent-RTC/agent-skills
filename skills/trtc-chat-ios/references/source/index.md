# 源码任务索引

## 用法：从需求定位，而不是从目录遍历

先确认实际命令式UI根U，按 [版本/能力检查](../shared/versions.md) 区分 `page/ChatPage.swift` 重构布局和发布Pod源码根中的 `ChatPage.swift` 平铺布局。定位器支持用户明确传入的这两种根及固定常见上层目录，不要求发布Pod必须带podspec。平铺页面不必存在PageImpl，以下模块路径来自重构基线，缺失时报partial并在对应模块查当前符号，不新建同名假Impl。相邻Demo记为D，未带Demo不假设存在。

从下表选择一个主任务；只在“联动条件”命中时读取第二个模块。指南里的路径是相对 U 的定位线索，不是免读源码的权威事实，修改前检查符号和调用关系。没有对应任务时先读 [精简架构](architecture.md) 定位责任模块，不直接搜索所有平台。

| 需求/症状 | task | 主指南 | 何时联动 |
| --- | --- | --- | --- |
| 气泡、消息 cell、高度/复用、时间/头像、列表局部刷新 | messages | [消息显示](modules/messages.md) | 键盘/滚动跟随读 navigation；新增选项读 workflow |
| 自定义消息不展示、摘要不对、默认协议解析 | custom-message | [消息显示](modules/messages.md) | 发送 payload 读 input；会话预览读 conversations |
| 输入按钮、更多菜单、发送、草稿、引用、@ | input | [输入与发送](modules/input.md) | 布局与键盘读 navigation |
| 录音、实时转文字、松手收尾、取消后重启 | recording | [输入与发送](modules/input.md) | 仅服务端失败时进入 Core/SDK 边界 |
| 会话 cell、侧滑、红点/数字、摘要、分页/刷新 | conversations | [会话列表](modules/conversations.md) | 改接收选项读 settings；Tab角标读 navigation |
| 群/单聊设置、免打扰、权限、自定义设置项 | settings | [聊天设置](modules/settings.md) | 细分免打扰需同步 conversations |
| 联系人列表/顶部入口、申请角标、好友资料/导航 | contacts | [联系人](modules/contacts.md) | 改聊天跳转读 navigation |
| 返回/关闭、双导航栏、child VC、安全区、键盘 | navigation | [导航与生命周期](modules/navigation.md) | 消息定位/已读读 messages，录音读 input |
| 宿主 Home Tab 未读角标布局/拖拽/转场 | tab-badge | [导航指南的Tab分支](modules/navigation.md) | 直接读宿主Home文件，不先读ChatPage组件 |
| 品牌色、深浅色、阿拉伯语、资源丢失、JSON开关 | theme | [主题与资源](modules/theme.md) | 字段读到了但不生效时回到对应 UI 模块 |
| 新增公开配置、跨模块开关、API重构 | config | [变更配方](workflow.md) | 必须再选真正消费该配置的模块 |

## 可选定位器

先读取脚本了解其只读行为，再按宿主授权规则执行。将 `<UI_ROOT>` 替换成已经确认的现有目录；路径空格要加引号。脚本不会 clone、联网、打开整个文件树或输出源码正文。

```bash
python3 scripts/locate_source.py --root '<UI_ROOT>' --task settings
python3 scripts/locate_source.py --root '<UI_ROOT>' --task recording --check-symbols
```

命令以 Skill 根为工作目录，或使用脚本绝对路径。默认最多返回任务的 4 个首读文件；`--check-symbols` 仅在这些明确文件中过滤注释/字符串后匹配标识符提示，仍不是Swift语义解析。输出 `missing`/`symbol-missing` 时不能声称当前代码与基线一致。状态为 `partial`（退出码1）时先在同模块定位改名/拆分文件；退出码2表示根错误或索引不合法。无匹配根就停止，不能自动递归扫描用户磁盘。

特殊路由：`config` 只返回 `select-module` 与候选模块，不读取无关配置文件；先根据需求选择消费者，再运行对应task。`tab-badge` 的 `--root` 必须显式传Demo的 `ChatDemo/Sources` 目录（不是U），直接匹配HomeTab源码；其他宿主不匹配时按导航指南查自己的Tab实现，不自动扫描或下载Demo。

可查 [机器索引](tasks.json)，但通常不需要阅读全文；脚本已给出当前任务切片。不要同时读取所有任务切片和所有模块指南。

## 扩大搜索与停止条件

- 首读文件不足：按主指南中的任务配方，打开下一个明确的消费者、配置或子视图。
- 符号移动：先在该组件目录搜索该符号，再查页面接线；根/版本不对时重新确认依赖来源。
- 涉及 Core 动作：读当前 interface 与实际调用点；只有用户授权且该源码确实参与构建时才改 Core 实现。
- 已找到“事件发起者、状态来源、渲染消费者、必须联动点、验证方法”后停止拓展，不以“先完整理解仓库”为前置。
- 无法解释现象：明确缺哪条证据，再取最小日志/复现；不依赖历史成功修复的猜测。

## 非默认参考

- [architecture.md](architecture.md)：只在首次认知代码结构或跨层改动时读。
- [workflow.md](workflow.md)：新增 API/配置、涉及多个模块时读。
- [lessons.md](lessons.md)：遇到角标、默认值、调用资格或版本偏差时查经验；包含证据等级，不是可机械套用的补丁库。
