# 声明式导航、安全区、键盘与页面生命周期

## 何时读取

返回/更多无效、双标题栏、组件内 `NavigationLink` 不跳转或跳两次、iOS 15 转场异常、嵌入 UIKit 后子页打不开、边缘返回手势失效、键盘遮挡或留白、页面重复进入导致重复加载时读。先判断问题在组件页面还是宿主导航；宿主 Tab 与登录切页不要改组件。

## 首读（相对 U）

| 文件 | 符号/职责 |
| --- | --- |
| `page/impl/ChatPageImpl.swift` | `navigationBarView`、安全区补偿、多选模式、合并详情/已读回执跳转、`ChatUIKitNavigation` |
| `page/ChatPage.swift` | 公开构造与参数透传 |
| `components/basecomponent/impl/KeyboardHandlerImpl.swift` | `KeyboardHandler` 键盘高度、动画与 `didShowPublisher` |
| `components/common/HostViewControllerBeacon.swift` | 从 SwiftUI 找宿主 `UIViewController` |

会话页与联系人页的内部跳转在 `page/impl/ConversationsPageImpl.swift`、`ContactsPageImpl.swift`。宿主侧样例在 D 的 `ChatDemo/Sources/Navigation/ChatNavPage.swift`、`Pages/HomePage.swift`、`App/ContentView.swift` 与 `demo_mini/Sources/ChatDemoMiniApp.swift`。

## 调用链

宿主 `NavigationView` → 页面 `View` → Impl 自绘标题栏（返回调 `onBack`，标题与“更多”调 `onMoreClick`，多选时显示取消）→ 页面内隐藏 `NavigationLink(isActive:)` 打开子页；已读回执优先用 `ChatUIKitNavigation.topNavigationController()` 做 UIKit push，找不到才回落到 `NavigationLink`。

安全区：`ChatPageImpl` 用 `GeometryReader` 取实际安全区，与窗口安全区比较后补 padding，并对整页 `.ignoresSafeArea(.keyboard)`；键盘占位由输入组件根据 `KeyboardHandler` 负责。可见性：消息列表在 `onAppear` / `onDisappear` 维护 `isPageVisible`，结合应用前后台决定清未读与回执。

## 修改配方

### 返回、更多和标题栏

返回按钮只调用 `onBack`，不自动 pop；宿主没传则无效。`onMoreClick` 同时绑定标题与“更多”。`showsNavigationBar: false` 时组件不画标题栏，宿主需提供返回入口与多选取消入口。返回按钮旁的总未读来自 `ConversationListState.totalUnreadCount`。修改时保持“组件页隐藏系统栏、设置等子页使用系统栏”的约定，避免双标题栏或无标题栏。

### NavigationLink 与 iOS 15

页面内跳转依赖外层 `NavigationView`。排查不跳转时先确认宿主容器与 `isActive` 状态；排查连跳/自动返回时检查同一页面是否存在多个同时激活的隐藏链接、`isActive` 是否在转场中被重置，以及视图身份是否因状态变化重建。已知问题的修复方式是对特定页面改用 UIKit push（见 `openReadReceiptDetailPage`），不要全局替换导航方式。`NavigationStack` 需 iOS 16，只能在最低版本允许时引入。

### 嵌入 UIKit 与返回手势

`UIHostingController` 中的根必须包一层 `NavigationView` 并注入 `ThemeState`，否则组件内部跳转失效。`HostViewControllerBeacon` / `ChatUIKitNavigation` 依赖视图已进入窗口，过早调用会拿不到控制器。隐藏系统导航栏会让边缘返回手势失效：组件源码中不做全局方法交换，宿主按页面桥接恢复（Mini Demo `SwipeBackSupport`），离开页面时还原原委托。

### 键盘与安全区

先确定每项的唯一负责人：顶部安全区补偿在 `ChatPageImpl`，底部键盘与面板在输入组件，列表可见区由消息列表随输入高度变化。宿主不要再加 `.padding(.bottom, keyboardHeight)` 或外层 `ignoresSafeArea` 改变这一分工。改补偿逻辑要在刘海机型、Home 键机型、横竖屏、iPad 分屏与嵌入 TabView 中验证。

### 重复进入与生命周期

`onAppear` 可能多次触发：首载与清未读都要防重入。`@StateObject` 只初始化一次，切换会话需要新的视图身份；窗口浮层（录音、转写）与 `Timer` 在离页时清理。

## 不变量

- 系统栏、组件栏、安全区、键盘各有唯一负责人。
- 只有真实可见且前台的聊天页清未读与发回执；导航重构不能改变这一点。
- 每个独立承载的组件根都有 `NavigationView` 与 `ThemeState`。
- 返回、删除好友/退群后的回退路径由宿主回调决定，组件不擅自 pop 多层。

## 最小回归

push/pop、交互返回与取消、连续进入同一会话、从搜索/联系人/新建会话进入、设置页进出、合并消息与已读回执详情、多选进入退出；iOS 15 与当前最新系统；UIKit 嵌入场景；键盘、表情、更多切换与旋转；前后台切换后未读与回执。

消息定位与已读转 [消息](messages.md)；输入高度与面板转 [输入](input.md)。
