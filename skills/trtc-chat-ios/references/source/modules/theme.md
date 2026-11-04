# 主题、语言、资源与JSON配置

## 何时读取

品牌色/深浅色不刷新、Arabic/RTL、文案资源丢失、新增主题token、appConfig键定义了但不生效时读。本页只描述源码改法；只调用现有公开setter看 app/customization。

## 首读（相对 U）

| 文件 | 符号/职责 |
| --- | --- |
| `components/basecomponent/theme/ThemeState.swift` | ThemeState；主题持久化、setter、样式刷新副作用 |
| `components/basecomponent/utils/LanguageHelper.swift` | saveLanguage/getCurrentLanguage/applyLayoutDirection/LocalizedChatString |
| `components/basecomponent/utils/AppBuilderHelper.swift` | JSON读取、AppBuilderHelper、AppBuilderConfig |
| `components/common/theme/TUIChatKitTheme.swift` | colors；组件读取主题颜色的入口 |

资源打包故障再读 `TUIChatKit.podspec` 与 `resources/strings`、`resources/assets/chat`；不要一开始读完所有xcassets/xcstrings。用key精确定位需要变更的资源。

## 调用链

- 主题：ThemeState.loadTheme优先持久化主题，其次才读AppBuilder；setter → 保存/发布并清缓存 → TUIChatKitTheme.colors动态UIColor → UIView/Cell消费。setThemeMode还更新window.overrideUserInterfaceStyle，主色setter不执行这一步；Demo的Root额外订阅主色重建页面，不能当作组件setter的固有副作用。
- 语言：saveLanguage → 持久化/通知 → 页面重建或刷新label → LanguageHelper/BundleHelper查包。缺语言bundle会回退en，已找到语言bundle但缺某key不会逐key回退英译。RTL还需applyLayoutDirection；kit的布局方向处理不包办宿主或独立window。
- JSON：Bundle.main配置或setJsonPath → AppBuilder解码 → Config缺省getter或页面直接读取 → UI构建。setJsonPath本身不广播刷新，已建页面不自动重搭；字段定义、解析、消费和持久化覆盖必须分别检查。

## 修改配方

### 品牌色/主题切换

1. 保留public setter的持久化与状态发布，不直接写currentTheme绕过副作用。
2. 找到出问题的label/background/layer赋值；若为静态CGColor/缓存图片，明确刷新时机，而非只给ThemeState再发一条无消费者通知。
3. 新token在语义颜色定义与不同模式取值中补齐，再接到真正消费者。源码内部可以使用internal设计token；App示例不可以。
4. 只改目标模块刷新，确认不会触发整棵视图无限重建或重复订阅。

验证JSON主题键时执行明确步骤：先看当前AppBuilder.parseConfig的字段名；本轮核查的客户9.1.7822与开发源码都读取 `theme.mode` / `theme.primaryColor`，不能按客户文字报告改成不存在的 `theme.themeMode`；确认文件属于App bundle且加载早于ThemeState首次初始化；观察持久化主题是否覆盖它。用独立测试安装/新模拟器App验证缺省，或经用户授权只清理当前源码确认的主题持久化key再冷启动。不要自动卸载客户App/清整个UserDefaults，不能把BaseComponentThemeKey和其他版本ThemeKey混用。已有安装需要即时变更时优先public setter，测试后恢复原设置。

### 新增语言或修文案

核对真实资源key、bundle和回退；当前资源包含 en/zh-Hans/zh-Hant/ar。加文案同时检查相应语言、format参数/复数及RTL；显示名与代码字段不要混淆。更新已建页面的label或重建有状态恢复的页面，不假设saveLanguage自动刷新所有UI。方向使用leading/trailing与natural，不靠翻转图片补布局。

### 增加JSON开关的真实支持

以 `search.hideSearch` 为搜索线索：基线能解析字段不等于有UI消费者。找到目标page构建搜索入口的位置，将开关接到显隐/布局，并定义缺省与页面级配置的优先级。ContactsPage/ContactList已有独立showSearchBar时不要重复抵消；如果没有公开页面参数，按 [配置配方](../workflow.md) 增加且传透。

只隐藏会话页创建入口时查 `page/impl/ConversationsPageImpl.swift` 对enableCreateConversation的消费，不据此推断ContactsPage顶部加号也同样可控。

### 资源在源码有、App没有

检查podspec资源glob → CocoaPods bundle → App拷贝 → 运行时查包路径，基线为TUIChatKitBundle。不要通过清空资源脚本、改成Bundle.main或手抄绝对路径掩盖打包问题。新增文件确认target membership/glob。

## 不变量

保留主题状态持久化和现有未指定配置的默认值；新增JSON配置仍需消费者。现有页面、复用cell和动态layer应使用同一主题口径。用户级语言设置与SDK识别语言不是同一功能。资源key缺失应走明确fallback而非崩溃。

## 最小回归

- system/light/dark切换与App重新启动；品牌色设置/清除。
- 页面已打开与新创建、长列表复用、自定义气泡/layer。
- 中文/英文/Arabic，返回/箭头/leading/trailing及消息左右语义。
- JSON缺失、合法false/true、错误类型、页面显式配置优先级。
- Debug/Release资源拷贝，未引入内部token到外部模板。

只有具体布局异常才继续读 [导航模块](navigation.md)；新增配置的公共链路读workflow，不加载其他业务模块。
