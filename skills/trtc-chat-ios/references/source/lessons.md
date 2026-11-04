# 工作区经验：只复用证据，不照搬补丁

在对应问题出现时按需读本页，不作为每次任务必读。来源为本工作区历史对话、已有维护记录和本次源码复核；不携带个人账号、目录绝对路径、凭据或内部服务。

## 已由源码/编译证据确认的规则

| 经验 | 当前证据入口（相对 U） | 如何应用 |
| --- | --- | --- |
| 类型公开但构造器/成员可能internal | `components/messagelist/MessageListView.swift`、`page/ChatPage.swift` | App示例必须普通import类型检查；源码维护可改internal，不批量公开 |
| Page特殊默认不等于空Config默认 | `page/ChatPage.swift`、`components/messagelist/config/MessageListConfig.swift` | 改配置同时比较未传配置、空配置、显式覆盖；右头像是现成回归用例 |
| JSON键存在不等于UI消费 | `components/basecomponent/utils/AppBuilderHelper.swift`与各PageImpl | 从解析追到getter和可见UI；hideSearch只解析而缺消费者时不能称支持 |
| 设置项显隐不等于实际免打扰 | `components/chatsetting/impl/GroupChatSettingViewControllerImpl.swift` | 读Store结果与receiveOption，不用UI开关值覆盖服务端状态 |
| 原始View嵌入不等于页面生命周期 | `page/ChatPage.swift`、`page/impl/ChatPageImpl.swift` | child VC containment关联可见性、已读、录音停止；导航修复连同这些回归 |
| Core依赖形态会变化 | 当前工程Podfile/lock和AtomicXCore swiftinterface | 旧本地源码路径、podspec范围不能替代现装二进制版本；查构建引用后再改 |
| 通话消息/横幅不是输入栏按钮 | `components/messagelist/cell/MessageCallContentView.swift`、`components/messagelist/view/MessageListJoinCallBanner.swift` | 无Call场景除按钮外再查历史重拨和进行中群通话；不要声称两个开关彻底去除Call |

## 历史排障线索：必须重新验证

工作区 `.codebuddy/parity-fix-batch.md` 的对齐记录提供了以下额外线索（不少条目标注待验证，不能据此承诺已修复）：

- 键盘与表情面板同时动画造成中间空白：回查命令式 `MessageInputViewImpl.syncBottomAreaHeight`，防止宿主padding与组件内部填充叠加；不要照搬SwiftUI补丁到UIKit。
- 已翻译/已转写内容重进页面后菜单与气泡不一致：分别检查持久化payload和临时UI展开状态，消息模块的auxiliaryTextState与菜单判定都核对。
- 压缩进度与SDK上传进度是两个阶段：检查占位消息替换和真实消息状态，不只改一条文案。
- 记录中的“当前本地Core源码”可能已被后续二进制Pod替换；旧版本号/目录只能作为线索，锁文件和实际构建引用重新确认。

另按标题核查过 `.workbuddy/memory/` 的三份10月记录，主要为cmark拆分、模块名及发布经验，不是页面/角标实现的权威说明；`.codebuddy/alignment/TRACKER.md` 的旧轮次“已验证”仅对应当时版本和截图。上述记忆路径是维护来源，不是要求使用者必须持有或加载的Skill依赖。

这些记录是查找入口，不是本Skill对另一套SwiftUI实现的支持承诺；不执行记录中的构建/清理命令。

### Tab未读角标

工作区曾先把角标移出tabBar解决疑似命中问题，随后暴露聊天页残留；再遇到返回时位置跳动。最终能长期复用的是验证顺序，而不是某次父视图或固定偏移补丁：

1. 找当前宿主Home Tab实现，区分它与会话cell未读。
2. 记录父视图、bounds/frame、坐标系转换、可见性和hitTest；检查转场期间的中间几何。
3. 区分SDK未读更新、布局赋值动画和用户拖拽清除动画。
4. 推栈/返回/交互取消、0→有未读、有→0、RTL、不同Tab数量都验证。
5. 最小探针未复现真实iOS 26样式时，不声称根因已确认；禁止将根view挂载或一刀切禁动画写成万能方案。

宿主版本可能已经重构，不把历史文件内容或行号硬编码为当前事实。命中该问题读 [导航模块](modules/navigation.md)。

### Xcode权限与构建

Desktop目录、跨目录Pod和脚本沙盒曾被作为线索，但不是同一个权限系统。分别取 macOS目录授权提示、构建sandbox日志和实际引用路径；不未经授权重置TCC、要求全盘权限或清空构建目录。见 [排障](../shared/troubleshooting.md)。

### 实验ASR语义

会话开始/上传/停止与采集是不同链路；历史文档和UI超时常量未必对应同一SDK发布包。需要修取消/迟到回调时先研究本地状态机，不把服务端语言范围或“固定秒数返回”猜测写进代码。用户曾回退文档中的语言/超时扩展，这不改变源码事实，也不授权将旧说明当作接口保证。

## 维护本页

只记录能减少错误搜索/修改的知识；区分“当前源码确认”“历史现象”“未验证猜测”。用户或新源码否定某条经验时更新其适用范围，不建立永远有效的修复规则。具体模块配方只保留在对应指南，避免一条经验在多个文件长篇重复。
