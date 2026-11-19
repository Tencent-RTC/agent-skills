# 声明式一页架构地图

## 代码的三条链

1. **页面装配**：宿主 `NavigationView` → `page/ChatPage.swift` / `ConversationsPage.swift` / `ContactsPage.swift`（公开 `View`，只持有 private Impl）→ `page/impl/*PageImpl.swift` → 组件公开视图（`MessageListView`、`MessageInputView`、`ConversationListView`、`ContactListView`）→ `components/*/impl/*Impl.swift`。
2. **行为/数据**：视图事件 → Impl 中的 `@State` / `@StateObject` 持有者（如 `MessageListStoreHolder`、`MessageMenuManager`、`MultiSelectManager`、`VoiceInputRecordController`）→ `AtomicXCore.*Store` 动作 → `.onReceive(store.state.subscribe(StatePublisherSelector(...)))` 写回 `@State` → `body` 重算。部分页面直接调 Store，不强制有 ViewModel。
3. **配置**：公开 `struct`/`class` 中的 `userXxx` → `config/*+Defaults.swift` 的计算属性缺省（部分读 `AppBuilderConfig`）→ internal `*ConfigProtocol`（消息列表还有 `MessageActionConfigProtocol`）→ Impl 与子视图消费。协议扩展里有默认实现，**新增成员漏写 getter 也能编译通过但行为丢失**。

跨组件的少量事件走 `NotificationCenter`（如 `MessageInputView.didInteractNotification`、`messageListBlankAreaClickNotification`、`quoteMessageNotification`、`exitMultiSelectMode`、`tuicallkit.startCall`），改名前全局搜索所有发送与接收方。

## 模块归属

| 路径（相对 U） | 负责 | 常见不归它负责的事 |
| --- | --- | --- |
| `page/`、`page/impl/` | 组装组件、公开构造、自绘标题栏、页面内 NavigationLink | 宿主导航容器与环境对象注入 |
| `components/messagelist/` | 消息加载/滚动（倒置 ScrollView+LazyVStack）、消息行、菜单、回应、已读、定位、转发 | 宿主 Tab 角标 |
| `components/messageinput/` | 输入栏、更多/表情面板、@/引用/草稿、录音与转写浮层、发送 | 会话总未读 |
| `components/conversationlist/` | 会话行、侧滑与更多动作、未读/@/草稿摘要 | 群角色权限 |
| `components/contactlist/` | 联系人 AZ 列表、顶部入口、申请/群/黑名单子页、加好友/加群 | 用户身份/签名 |
| `components/chatsetting/` | 单聊/群资料、开关、成员管理、权限矩阵、自定义行 | 用显示开关改变服务端权限 |
| `components/basecomponent/` | 主题 `ThemeState`、语言、JSON 配置、资源包、基础控件、键盘监听 | 宿主 `preferredColorScheme` / `layoutDirection` |
| `components/common/` | `CustomEditor`、通话事件发布、摘要注册、宿主控制器信标 | Call 模块的订阅实现 |
| `components/emojipicker`、`imageviewer`、`videoplayer`、`videorecorder`、`audiorecorder`、`audioplayer`、`filepicker`、`userpicker`、`search` | 可复用子组件 | 页面装配 |
| `resources/`、`TUIChatKit_Swift.podspec` | 资源包 `ChatUIKitBundle` 与依赖 | App 签名/APNs |

## SwiftUI 特有的状态与生命周期

- **环境对象**：`ThemeState` 由宿主注入；`MessageMenuManager`、`AuxiliaryTextMenuManager`、`MultiSelectManager` 由 `MessageListImpl` 创建并向下注入。新增子视图读取环境对象时，确认其所在层级确实被注入，跨 `UIHostingController` / window 浮层（`WindowOverlayPresenter`）要重新注入。
- **身份与重建**：`ForEach` 的 id、`.id(...)` 修饰和 `@StateObject` 的初始化参数决定状态是否保留；`@StateObject(wrappedValue:)` 只在首次创建时取值，会话切换要靠新的视图身份，不要指望 init 参数变化会重建持有者。
- **订阅时机**：`.onReceive` 跟随视图存活；`onAppear` / `onDisappear` 在 `NavigationLink` 推入、Tab 切换和 iOS 15 的部分转场中会多次触发，加载与清未读需要防重入（参考 `isPageVisible`、`isFirstFetchCompleted`、`isClearingUnreadCount`）。
- **UIKit 桥接**：长按菜单用窗口级 `UILongPressGestureRecognizer`（`BubbleLongPressBridge`），已读回执详情用 `ChatUIKitNavigation.topNavigationController()` 做 UIKit push，录音/转写浮层挂在窗口上。改这些路径时同时考虑 SwiftUI 手势与 UIKit 层的命中关系。

## 数据层定位

UI 一般 `import AtomicXCore`，不直接调 `V2TIMManager`。Store 用 `.create(...)` / `.shared`，读 `.state.value`，订阅 `.state.subscribe(StatePublisherSelector(keyPath:))`。先读当前 `Podfile.lock` 和 swiftinterface；另有 Core 源码时要证明构建确实引用它。

UI 有数据但画错 → 视图/配置/布局；UI 未拿到状态 → 订阅与视图生命周期；Store 动作失败 → 错误与 SDK 前置条件。沿证据下钻，不同时改三层。

## Demo 与产品源码

D 的 `ChatDemo/Sources/Navigation/ChatNavPage.swift`、`Pages/HomePage.swift`、`App/ContentView.swift` 是外部接线样例，不是公共 API；完整 Demo 的全局返回手势方法交换、登录持久化都属于 Demo 自身。`demo_mini/Sources/ChatDemoMiniApp.swift` 是最小接入样例，显式写出页面全部公开参数。

## 修改前的两个判断

- **谁拥有这个状态？** 视图 `@State`、`@StateObject` 持有者、Config 缺省、Store 数据、宿主环境对象不要互相覆盖。
- **谁负责这次刷新/清理？** `body` 重算、`.onReceive`、`onAppear/onDisappear`、`.id` 重建、窗口浮层各不相同；改一处不等于其他入口同步生效。

具体首读文件和配方回到 [任务索引](index.md)。
