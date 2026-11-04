# 一页架构地图

## 代码的三条链

下图为重构开发源码基线；发布Pod可能是平铺ChatPage并直接持有组件，没有PageImpl。先按 [版本能力](../shared/versions.md) 匹配实际布局，不照图创建不存在的类。

1. **页面装配**：宿主导航 → `page/ChatPage.swift` / `ConversationsPage.swift` / `ContactsPage.swift` → `page/impl/*PageImpl.swift` → 对应组件。
2. **行为/数据**：组件 UI 事件 → ViewModel/Coordinator → `AtomicXCore.*Store` 动作 → 状态发布 → UI sink/bind/render。部分设置页直接调用 Store，不强制套一层不存在的 ViewModel。
3. **配置**：公开具体 Config 中 `userXxx` → 公开 init 与缺省 getter → internal protocol/解析器（若存在）→ 页面/视图消费。颜色/资源/JSON 各有独立链，定义一个属性并不保证任何消费者使用它。

`page/*.swift` 是公开 façade，转发生命周期给 private impl；不要只在 façade 加一个字段却忘记给 impl 传入。页面多为 final 影响 App 扩展，但源码维护者可在模块内部修改其实现，不必把所有成员公开。

## 模块归属

| 路径（相对 U） | 负责 | 常见不归它负责的事 |
| --- | --- | --- |
| `page/`、`page/impl/` | 组装组件、公开构造、页面事件和生命周期 | 服务端账号/消息协议 |
| `components/messagelist/` | 历史/新消息渲染、cell、菜单、复用、滚动、局部已读触发 | 生产签名、Tab级导航 |
| `components/messageinput/` | 输入状态、更多、@/引用、媒体采集、发送协调 | 会话总未读口径 |
| `components/conversationlist/` | 会话状态消费、cell摘要/未读、侧滑菜单 | 改群角色权限 |
| `components/contactlist/` | 好友/申请/分组顶部入口和选择事件 | 用户身份/签名服务 |
| `components/chatsetting/` | 群/单聊资料、操作权限、开关和自定义行 | 仅凭可见开关改变服务端权限 |
| `components/basecomponent/`、`components/common/` | 主题、语言、公共 UI、配置工具、通话事件桥接 | 用户 App 内全部容器和系统权限 |
| `components/ai/` | UIKit ASR/TTS等封装和采集链 | 自动证明服务端语言范围、超时/计费契约 |
| `resources/`、`TUIChatKit.podspec` | 可分发资源和打包依赖 | App bundle/team/APNs 实际配置 |

## 数据层定位

UI 一般 `import AtomicXCore`，不是每处直接调用 `V2TIMManager`。Store 用 `.create()` / `.shared`，读取 `.state.value`，用 `StatePublisherSelector`+Combine订阅并保持 tokens。在接口 façade 看到空方法不能据此认定功能未实现。

先读当前 `Podfile.lock` 和 framework `.swiftinterface`。找到另一份 Core 源码时需证明构建确实引用它、接口版本匹配，才能用它解释本二进制行为。仅存在源码目录不是版本证据。IM SDK 的头文件/实验接口与 TUIChatKit 显示开关不可混为一层。

UI有数据但画错 → 组件配置/布局；UI未拿到状态 → Store订阅/生命周期；Store动作失败 → 错误和SDK前置条件。沿证据下钻，不先同时改三层。

## Demo 与产品源码

D 的 `Sources/Navigation/ChatFlowCoordinator.swift`、`DemoPageConfigs.swift` 是外部模块接线样例，不是 TUIChatKit 公共 API。Home Tab未读、登录切页、App导航归宿主；不要为修Demo角标去改消息cell。

公开仓库 `chat/...` 与内部 `ios/chat/...` 的 UI 布局通常对应，但发布 Demo 可能裁剪内部登录/客服/Push。只复制已核实的公开示例；不要把内部环境和账号纳入 Skill。

## 修改前的两个判断

- **谁拥有这个状态？** View自己的临时选择、Config缺省、Store数据、SDK同步、宿主导航不要互相覆盖。
- **谁负责这次刷新/清理？** `bind`、Combine sink、页面转场、回收、后台切换各不同；正确改一处不等于其他入口同步生效。

具体首读文件和配方回到 [任务索引](index.md)。本图不是要求加载全部模块。
