# 声明式主题、语言与资源

## 何时读取

品牌色、深浅色不生效或不刷新、阿拉伯语/RTL 布局、文案缺失、图片/表情资源丢失、`appConfig.json` 字段不生效时读。字段读到了但某个界面不变时，回到对应 UI 模块找消费者。

## 首读（相对 U）

| 文件 | 符号/职责 |
| --- | --- |
| `components/basecomponent/theme/ThemeState.swift` | `ThemeState.shared`、`setThemeMode`、`setPrimaryColor`、`clearPrimaryColor`、`colors` 缓存、`loadTheme` / `saveTheme`、系统外观监听 |
| `components/basecomponent/utils/LanguageState.swift` | `LanguageState.setLanguage`、`LanguageHelper` 本地化查找与 `getCurrentLanguage` |
| `components/basecomponent/utils/AppBuilderHelper.swift` | `AppBuilderHelper.setJsonPath`、`parseConfig`、`AppBuilderConfig` 字段 |
| `components/basecomponent/impl/BundleHelperImpl.swift` | `ChatUIKitBundle` 与本地化 bundle 定位 |

颜色定义在 `theme/Colors.swift`，字体/间距/圆角在 `Fonts.swift`、`Spacing.swift`、`Radius.swift`；图片入口 `utils/AtomicXChatResources.swift`。

## 调用链

主题：`ThemeState.init` → `loadTheme`（优先读本地保存的主题，否则用 `AppBuilderConfig.themeMode/primaryColor`）→ `@Published currentTheme` → 组件经 `@EnvironmentObject` 读 `themeState.colors/fonts/...` → 视图重算。`setThemeMode` / `setPrimaryColor` 清颜色缓存并保存。`isDarkMode` 结合系统外观；组件**不**设置 `preferredColorScheme`，由宿主根视图设置。

语言：宿主 `LanguageState.setLanguage` → `LanguageHelper.saveLanguage` 写入 `UserDefaults` → 组件渲染时 `LocalizedChatString(key)` 经 `BundleHelper.findLocalizableBundle` 读取 `ChatLocalizable.bundle/Localizable/<语言>.lproj`。RTL 由宿主设置 `.environment(\.layoutDirection, ...)`。

JSON：宿主调 `AppBuilderHelper.setJsonPath` → `parseConfig` 写 `AppBuilderConfig.shared` → 各配置 getter 缺省与少数 UI 直接读取。声明式不会自动加载 `Bundle.main` 中的文件。

## 修改配方

### 主题不生效或不刷新

先确认三件事：宿主是否注入了同一个 `ThemeState.shared`；视图是否通过环境对象读取（而非全局常量 `FontScheme`/`SpacingScheme`/`RadiusScheme` 或一次性取值的 UIKit 颜色）；本地是否已有保存主题覆盖了 JSON。UIKit 包装视图（如会话摘要的 `TruncatingSubtitleLabel`、录音浮层）需要在主题变化时主动更新，不能只靠 SwiftUI 重算。`setPrimaryColor` 只接受 `#RRGGBB`，其他格式静默忽略。

新增语义颜色：在 `Colors.swift` 的浅色、深色与自定义主色派生（`ThemeState.getCustomScheme`）三处都补齐，再在视图中通过 `themeState.colors` 使用。

### 语言与 RTL

新增文案在 `resources/strings/ChatLocalizable.bundle/Localizable/` 的 en、zh-Hans、zh-Hant、ar 四份同步添加。切换语言后已显示的文本要靠视图重建刷新（Demo 用根视图状态与 `.id`），不要改为在组件内部监听全局通知强刷。RTL 下检查 `HStack` 顺序、图标镜像、`.leading/.trailing` 对齐和手写偏移；UIKit 包装视图需单独设置 `semanticContentAttribute`。

### 资源丢失

确认 `ChatUIKitBundle` 进入 App、图片名存在于 `resources/assets/chat/chat.xcassets`、调用使用 `AtomicXChatResources.resourceBundle` 或 `Image(_:bundle:)`。不要回退到 `Bundle.main` 同名资源，也不要删除 CocoaPods 资源拷贝阶段。

### JSON 字段

从 `parseConfig` 追到 `AppBuilderConfig` 属性，再追到 getter 缺省与 UI 消费。已确认消费：主题（仅首次加载）、`messageAlignment`、`enableReadReceipt`、`messageActionList`、`enableCreateConversation`、`conversationActionList`、`hideSendButton`、`avatarShape`；`hideSearch` 仅解析无消费者。新增字段按 [配置配方](../workflow.md) 接完整链路。

## 不变量

- 主题与语言的唯一状态源分别是 `ThemeState.shared` 与本地保存的语言；不在组件内另存副本。
- 显式配置优先于 JSON；JSON 不覆盖用户已保存的主题。
- 四种语言资源同步，RTL 布局不靠硬编码方向。

## 最小回归

浅色/深色/跟随系统切换与重启、设置与清除品牌色、JSON 主题在全新安装与已有主题时的表现；中英繁阿切换后各页面文案与 RTL 布局（会话、聊天、输入、设置、联系人）；表情与图标资源；头像形状 JSON。

界面字段不变时回到对应模块：[消息](messages.md)、[输入](input.md)、[会话](conversations.md)、[设置](settings.md)。
