# 声明式源码变更配方

仅新增公共 API/配置、跨文件功能、内部缺陷修复时读。修改闭环、跨层判断与验证顺序的通用部分与 [命令式变更配方](../../source/workflow.md) 相同；本页只写声明式不同之处，两页不需要同时通读。

## 配方 A：新增一个公开配置项

以消息列表或输入为例，按真实链逐层检查：

1. 在公开配置 `struct`（如 `components/messagelist/MessageListConfig.swift`）增加 `public var userXxx: T? = nil`，保持现有分组注释风格。
2. 在 `config/*+Defaults.swift` 增加公开计算属性 `xxx`（get 用 `userXxx ?? 缺省`，set 写回 `userXxx`）；缺省来自常量还是 `AppBuilderConfig` 要与同类项一致。
3. 在公开 init 增加带默认值的参数并赋值。**优先追加在末尾**：Swift 按声明顺序传参，插到中间会破坏客户已有调用（已发布 9.1.7821 与未发布开发源码的 `ChatMessageListConfig` init 已因调整顺序互不兼容）。
4. 消费方通过 internal 协议读取时，同时在 `MessageListConfigProtocol` / `MessageActionConfigProtocol` / `*ConfigProtocol` 增加成员。协议扩展若提供了默认值，具体配置未实现 getter 时也能编译，会静默使用默认值，必须核对。
5. 在真正渲染的视图使用它：消息行在 `impl/cells/MessageView.swift`，菜单在 `impl/actions/MessageMenuButtons.swift`，输入面板在 `impl/core/MessageInputContentView.swift`。
6. 查页面层是否传透或改写：`ChatPageImpl.resolvedMessageListConfig` 会在未传配置时设置右头像并追加 typing 消息过滤；`ChatPageImpl` 对输入配置也有缺省创建。
7. 需要 `appConfig.json` 时另接 `AppBuilderHelper.parseConfig` → `AppBuilderConfig` 属性 → getter 缺省 → UI 消费；只加 JSON 键不算完成。
8. 验证：未传参数、传 true、传 false、页面重建；兼容旧构造调用；做普通 `import TUIChatKit_Swift` 的外部类型检查，不用 `@testable`。

## 配方 B：修改布局/样式

先确认是否已有公开外观（`MessageBubbleAppearance`、`MessageInputAppearance`）可满足。找到三个点：视图层级与修饰符顺序（`frame` / `fixedSize` / `padding` 先后决定尺寸）、宽度上限来源（如 `MessageView.maxMessageBubbleWidth`）、几何上报（`GeometryReader` + `PreferenceKey`，长按与菜单定位依赖它）。

`.frame(maxWidth: X)` 会让视图在父容器允许时撑满到 X，不是“最多 X”；需要贴合内容时把上限放在外层或配合 `fixedSize`。改后回归长短文本、表情回应、图片/语音/自定义消息、左右对齐、多选、深浅色、RTL、Dynamic Type。

## 配方 C：新增动作/状态

区分入口显示与执行。新增菜单项要同时更新 `MenuButtonConfig.allButtons`/`getVisibleButtons` 与 `actionID(for:)` 映射，确认 `actionCustomizer` 能按 ID 编辑。菜单关闭统一走 `MessageMenuManager.hideMenu()`；发布版 9.1.7821 只在列表空白点击时关闭；输入面板交互（`didInteractNotification`）、滚动和多选是否关闭需按需求补齐。

动作成功以 Store 结果为准；乐观更新（如 `toggleReactionOptimistic`）失败要回滚。离开页面后丢弃迟到回调，不在 `body` 中触发副作用。

## 配方 D：SwiftUI 状态与导航

- 新状态放在拥有它的视图：页面级用 `@State` / `@StateObject`，跨子视图用环境对象或绑定，不要用全局单例绕过。
- 新增 `NavigationLink` 页面需在 iOS 15 的 `NavigationView` 下验证连续激活、返回后再次进入与交互返回；已知 iOS 15 连续激活程序化链接会出错时，参照 `ChatPageImpl.openReadReceiptDetailPage` 的 UIKit push 兜底，不要盲目全局替换。
- 新的窗口浮层或 `UIHostingController` 根要注入 `ThemeState`，并在离页/后台时移除。

## 修改闭环与验证

编辑前能回答：请求从哪进来、谁持有状态、哪处真正消费、还会影响谁、如何判定成功且不回归。只改必要文件；新增文件确认落在 podspec 的 `source_files` 通配内（`*.{swift,h,m}`、`page/**`、`components/**`），资源确认进入 `ChatUIKitBundle`，多语言同步 en/zh-Hans/zh-Hant/ar。

验证顺序：精确 diff → 外部模块类型检查 → 构建实际 App 目标（如 `demo_mini/ChatDemoMini.xcworkspace` 的 `ChatDemoMini` scheme）→ 经授权的 UI 回归。按 [排障](../../shared/troubleshooting.md#构建结果与模拟器启动不是同一层) 保留真实退出码；环境不能构建时诚实报告，不用 stub 或删依赖换取表面成功。
