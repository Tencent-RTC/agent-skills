# 选择接入命令式还是声明式

客户要求“接入 Chat / TUIChatKit”但没有说明用命令式 `TUIChatKit`（UIKit）还是声明式 `TUIChatKit_Swift`（SwiftUI）时，先按本页决定，再进入对应接入文档。客户已明确指定时直接按其选择，不再判断。

## 默认结论

| 工程情况 | 接入套件 | 是否询问 |
| --- | --- | --- |
| 空工程 | **命令式** | 不问，在方案中说明 |
| 已依赖其中一套 | 沿用已依赖的那套 | 不问 |
| 分析后明确是 UIKit 工程 | 命令式 | 不问 |
| 分析后明确是 SwiftUI 工程 | 声明式 | 不问，在方案中说明依据 |
| 证据不足或混合，且倾向声明式 | 倾向声明式 | **必须先向客户确认** |
| 证据不足或混合，倾向命令式 | 命令式 | 不问，在方案中说明可改选声明式 |

## 什么算空工程

满足任一条件即视为空工程：

- 还没有 Xcode 工程，需要新建。
- 只有 Xcode 模板生成的文件，没有业务代码：例如只有默认 `AppDelegate` / `SceneDelegate` / `ViewController`，或只有模板 `App` 结构体加内容为占位文字的 `ContentView`，没有其他页面、业务模型、第三方 UI 依赖。

空工程一律接入命令式，包括 SwiftUI 模板创建的空工程。需要新建工程时按 UIKit 生命周期创建（`AppDelegate` + `SceneDelegate` + 根 `UINavigationController`）；已有 SwiftUI 模板空工程时保留其生命周期，用 `UIViewControllerRepresentable` 承载命令式页面，见 [命令式接入·导航](../app/integration.md#导航与页面生命周期)，不擅自删除模板文件。

## 已有工程的分析方法

只读检查以下证据，不递归扫描 `Pods/`、构建目录或整个磁盘：

1. **已有依赖（决定性）**：`Podfile` / `Podfile.lock` / `Package.resolved` 中是否已有 `TUIChatKit` 或 `TUIChatKit_Swift`，源码中是否 `import TUIChatKit` / `import TUIChatKit_Swift`。已有哪套就沿用哪套。两套同时存在时停下说明，询问客户保留哪一套。
2. **硬性限制（决定性，排除声明式）**：
   - 最低部署版本低于 iOS 15：声明式要求 iOS 15，只能用命令式。
   - 宿主主要是 Objective-C、或接入点在 Objective-C 页面：用命令式，通过自有 Swift wrapper 暴露。
3. **应用入口**：`@main struct ...: App` + `WindowGroup` 偏 SwiftUI；`@main` / `@UIApplicationMain` 的 `AppDelegate`、`SceneDelegate` 中创建 `UIWindow` 并设置 `rootViewController`、或使用 `Main.storyboard` 偏 UIKit。
4. **页面构成**：统计业务源码（排除 Pods、生成代码、测试）中 `struct ...: View` 与 `UIViewController` 子类的数量；关注计划放置聊天入口的那个页面或 Tab 是哪一种。
5. **导航方式**：`NavigationView` / `NavigationStack` / `TabView` 为主，还是 `UINavigationController` / `UITabBarController` 为主。

## 判定标准

- **明确 UIKit**：应用入口是 UIKit，且聊天入口所在页面是 `UIViewController`；SwiftUI 只是零星嵌入。
- **明确 SwiftUI**：同时满足——应用入口是 SwiftUI `App`；业务页面几乎全部是 SwiftUI `View`，没有自有 `UIViewController` 页面或 storyboard；导航使用 SwiftUI 容器；最低版本 ≥ iOS 15。
- **其他情况都算“证据不足或混合”**。例如：SwiftUI 入口但主要页面是 UIKit；UIKit 入口但新页面都用 SwiftUI 写；聊天入口所在页面与工程主体不一致；两类页面数量接近。此时按聊天入口所在页面的技术栈确定倾向；入口位置不明确时按页面数量较多的一方确定倾向。

## 倾向声明式时如何确认

不确定且倾向声明式时，在写入任何文件之前只问一次，给出两个选项，并把推荐项放在前面：

- **声明式 SwiftUI（推荐）**：说明依据，例如“入口是 SwiftUI App，聊天入口所在的 X 页面是 SwiftUI View”。同时说明声明式需要 iOS 15、宿主要注入 `ThemeState` 并放在 `NavigationView` 中。
- **命令式 UIKit**：说明需要用 `UIViewControllerRepresentable` 承载，功能完整度更高，版本更新更频繁。

客户回复后按其选择继续，不再重复判断。客户在本轮无法回答或选择“你决定”时，按倾向的声明式继续，并在方案和交付中写明依据和改选方式。

## 交付中的说明

方案和最终回复都要用一句话写明选用的套件及依据，例如“空工程，按默认接入命令式 TUIChatKit”或“检测到 SwiftUI App 入口且页面均为 SwiftUI，接入声明式 TUIChatKit_Swift”。选定后：命令式继续读 [命令式接入](../app/integration.md)；声明式转到 [声明式入口](../swiftui/index.md)。
