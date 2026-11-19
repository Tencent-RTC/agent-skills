# 声明式工作区经验：只复用证据，不照搬补丁

在对应问题出现时按需读本页，不作为每次任务必读。来源为本工作区声明式源码、Demo 与 2026-11 的修复记录；不携带账号、绝对路径或凭据。

## 已由源码/编译证据确认的规则

| 经验 | 证据入口（相对 U） | 如何应用 |
| --- | --- | --- |
| 页面依赖宿主注入 `ThemeState` | `page/impl/*PageImpl.swift` 的 `@EnvironmentObject var themeState` | 缺注入会运行时崩溃；每个独立 hosting 根、sheet、窗口浮层都要注入 |
| 页面内部跳转依赖 SwiftUI 导航容器 | `page/impl/ConversationsPageImpl.swift`、`ContactsPageImpl.swift` 的隐藏 `NavigationLink` | 宿主根放 `NavigationView`；只放在 UIKit 导航栈里不够 |
| 设置页用系统导航栏 | `components/chatsetting/impl/C2CChatSettingImpl.swift` 的 `navigationBarTitle` + `navBackButton` | 从隐藏栏的聊天页 push 过去时显式 `.navigationBarHidden(false)` |
| Page 特殊默认不等于空配置默认 | `page/impl/ChatPageImpl.swift` 的 `resolvedMessageListConfig` | 改右头像等缺省时比较未传、空配置、显式覆盖三种 |
| 协议默认实现会吞掉漏写的成员 | `components/messagelist/config/MessageListConfigProtocol.swift`、`MessageActionConfigProtocol.swift` | 新增配置项同时核对具体类型是否实现 getter |
| JSON 不自动加载，主题键只首启生效 | `components/basecomponent/utils/AppBuilderHelper.swift`、`theme/ThemeState.swift` 的 `loadTheme` | 宿主在创建视图前 `setJsonPath`；已有持久化主题时 JSON 不覆盖 |
| `search.hideSearch` 无消费者 | `AppBuilderHelper.swift` 与全局搜索 | 不承诺有效 |
| 发布版与开发源码 API 有差异 | 9.1.7821 Pod 与开发 `page/ContactsPage.swift`、`ChatMessageListConfig+Defaults.swift` | 以发布版为准写调用；客户用开发源码时先读其实际文件 |

## 已修复问题的有效经验

以下修复在内部开发源码中完成，**发布版 9.1.7821 尚未包含**；客户在 9.1.7821 上复现这些问题时，可按描述在其源码副本中做同样修改，或等待新版本。

- **表情回应撑大气泡**：回应容器上的 `.frame(maxWidth: maxMessageBubbleWidth)` 会撑满到上限。修复把上限移到消息行外层，并让几何上报（`ViewPositionKey`）挂在实际气泡上。改气泡宽度时回归“短文本 + 回应”。
- **长按热区与气泡不一致**：长按由 `BubbleLongPressBridge` 在窗口级识别，命中区域来自 `messageBubbleFrame`。上报的 frame 必须覆盖整个可见气泡（含回应栏），否则扩展区域长按无响应、菜单也会挡住回应栏。
- **点击输入栏“更多”菜单不消失**：消息列表在收到 `MessageInputView.didInteractNotification` 时关闭长按菜单与辅助文本菜单。仍有边界：更多面板已展开再点“更多”只是收起面板，不发该通知。
- **iOS 15 程序化 NavigationLink 连续激活**：已读回执详情改为 UIKit push（`ChatPageImpl.openReadReceiptDetailPage`）。只在确有复现时借用此做法，不全局替换。

以上修复对应当时的源码；当前文件可能已重构，按符号核对后再判断是否仍适用。

## 未验证或仅为线索

- 完整 Demo 用方法交换在全局恢复返回手势，Mini Demo 用页面级桥接；后者更适合客户，但不保证覆盖所有嵌套导航。
- 同时接入命令式与声明式两套组件未验证；资源包名不同不代表符号、通知和单例不会冲突。
- 发布版 9.1.7821 的视频录制是 Objective-C + Masonry，开发源码已改为 Swift；录制相关修复不能跨版本照搬。

## 维护本页

只记录能减少错误搜索/修改的知识，区分“源码确认”“已修复经验”“线索”。新源码否定某条经验时更新适用范围；模块配方只放在对应指南，避免重复。
