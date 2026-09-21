# Chat UI 排障

## 原则

- 默认只读诊断，不先改代码。
- 先收集证据，再给单一最可能根因；不能按“八成是某处”直接修。
- 用户要求“直接改”也必须先给文件级修复方案，并按主 `SKILL.md` 的“结构化提问与等待”发起明确授权。
- 不启动 App 或模拟器；需要复现或运行验证时给客户明确步骤。
- 编译问题先修依赖、路径、版本和 import，不写同名空类或 stub。

## 平台分流

- Android：分别确认宿主 UI 技术栈和实际接入的 Chat UI 版本。客户可以自由选择 View 或 Compose 版，未指定时默认 View 版；诊断必须跟随实际接入版本，不能由宿主技术栈反推。
- iOS、Flutter、uni-app 等：先说明本 Skill 没有该平台的内置 API 基线，提供匹配的官网入口，并按主 `SKILL.md` 的“结构化提问与等待”询问是否继续；客户确认后，基于官网文档、客户源码和错误证据继续诊断与修复，不能仅因平台不同而拒绝。

## 最少证据

先从工程和用户现象取得：

- 完整错误码、错误描述、异常栈或第一处编译错误
- 发生页面、操作顺序、会话类型、是否稳定复现
- Chat UI 依赖方式、版本、真实源码或制品
- 登录状态与失败回调
- 完整 `conversationID` 及来源
- 相关页面初始化调用或组件参数、配置实例、状态、生命周期和异步回调

无法从工程取得且会改变判断的信息，按主 `SKILL.md` 的“结构化提问与等待”一次只补问一个。

## 排查顺序

1. 把症状归入一个主类：构建、登录、会话、聊天页、消息、配置/扩展、宿主 UI、创建测试账号和体验消息或异常调用。
2. 沿真实调用链找到最后一个已确认正常点和第一个异常点。
3. 对照当前源码验证类名、参数、状态前置条件和消费位置。
4. 形成根因结论；证据不足时明确下一项最小取证动作，需要客户补充日志、现象或选择时按主 `SKILL.md` 的“结构化提问与等待”发起。
5. 给出文件级修复方案，并在同一回合按主 `SKILL.md` 的“结构化提问与等待”发起审批；不得默默停止。
6. 客户授权后修改、编译并检查本次触及的 SDK 调用。

不要同时尝试多个猜测性修复。

## 构建与依赖

Gradle Sync、编译失败、类找不到时依次检查：

- 当前平台、所选 Chat UI 版本和组件版本是否在对应官网文档支持范围内
- 目标 App 是否实际依赖所选 View 或 Compose 版 Chat UI 的正确模块或制品
- 源码模块路径、仓库、版本、sourceSet 和资源是否可用
- import 的包名是否属于所选 Chat UI 版本，是否误混另一版 UI 的符号
- 是否重复引入 SDK、UIKit 或不同版本的同一能力
- `minSdk`、Kotlin、Gradle 与当前制品要求是否匹配
- 宿主与 Chat UI 技术栈不一致时，互操作容器及其生命周期、主题、状态保存和导航边界是否正确
- Release 独有问题再检查 R8/ProGuard，不在无证据时批量添加 keep

## Android 兼容性排障

先记录完整第一处错误，不要看到“版本不兼容”就批量升级。至少确认：

- 客户选择 View 还是 Compose 版 Chat UI，以及源码分支、提交或制品版本
- Chat、AtomicXCore、CallKit、IM SDK、TRTC/TUICore 是源码还是制品，最终各解析到什么版本
- Gradle Wrapper、AGP、JDK、Kotlin、Compose Compiler、`compileSdk`、`targetSdk`、`minSdk`
- 问题只发生在 Debug、Release、特定 Android 版本、特定 CPU 架构，还是所有环境
- 宿主原来可工作的模块与 Chat Demo 的对应配置差异

实际使用本地 TUIKit Chat 源码时，只在当前工程和构建配置实际引用路径内按 [集成](integration.md#本地-tuikit-chat-源码版本核对) 完成 GitHub 最新版本核对，并在源码不完全一致或无法确认时取得客户的版本选择；发现不一致不等于可以把升级当作默认修复。

当前仓库只能作为排查基线，不能替代客户实际版本：

- View 版当前源码常见基线为 `compileSdk 35`、`minSdk 23`、Java/Kotlin JVM 17；对应官方入口为 [Android View](https://cloud.tencent.com/document/product/269/37059)。
- Compose 版当前源码模块常见基线为 `compileSdk 35`、`minSdk 21`，当前 Demo 使用 Gradle 8.9、AGP 8.6.1、Kotlin 2.0.21；对应官方入口为 [Android Compose](https://cloud.tencent.com/document/product/269/125127)。

客户配置不同不等于必须升级。先确认当前 Chat 源码的最低要求，再在“升级宿主工具链”与“选择兼容的 Chat 版本”之间给出文件级方案。

### Gradle、JDK 与 Kotlin

- `Unsupported class file major version`、`Android Gradle plugin requires Java...`：先核对 Gradle 实际使用的 JDK，而不只看 IDE 设置。
- `Inconsistent JVM-target compatibility`：统一相关模块的 Java `sourceCompatibility` / `targetCompatibility` 和 Kotlin `jvmTarget`；View 版当前源码要求 JVM 17 时不能只改单个 App 模块。
- `Module was compiled with an incompatible version of Kotlin`、Compose Compiler 报错：核对 Kotlin、Compose 插件和 Compose BOM 的兼容组合，不逐个依赖试版本。
- 插件或 DSL 找不到：先比较客户 wrapper、AGP 和当前 Demo 的工作配置，再决定升级哪一层。
- 始终使用客户工程自己的 wrapper 构建；IDE Sync 成功不能代替目标模块编译。

### SDK、Manifest 与资源

- `uses-sdk:minSdkVersion ... cannot be smaller`：选择满足组件要求的 `minSdk` 或兼容版本，不能用 `tools:overrideLibrary` 强行绕过。
- `Namespace not specified`、资源类或 `R` 找不到：检查源码模块是否以正确路径加入 settings、是否应用 Android library 插件、`namespace` 与资源 sourceSet 是否有效。
- Manifest merge 失败：逐条比较冲突来源。带 intent-filter 的宿主组件按 Android 12+ 要求明确 `android:exported`；Chat 内部页面不能为省事全部设为 `true`。
- `FileProvider` authorities 冲突：检查 `${applicationId}.MessageList.FileProvider` 等占位符是否被多个变体或重复 UIKit 模块声明。
- `Resources$NotFoundException`、主题启动崩溃：确认 AtomicX 与 UIKit 资源实际打包、Activity 使用兼容的 AndroidX/AppCompat 主题；不要仅为消除主题错误把宿主切到 `Theme.MaterialComponents`。

### 依赖与原生库

- `Duplicate class`：用依赖树和 `dependencyInsight` 找出重复的 IM SDK、TUICommon/TUICore、AtomicXCore 或 CallKit 来源，统一到一条依赖链；不能直接全局 exclude。
- `More than one file was found with OS independent path`、重复 `.so`：先确认两个 native 库是否真是同一实现。只有内容和版本兼容时才使用精准 packaging 规则，不能批量 `pickFirst` 掩盖冲突。
- `UnsatisfiedLinkError`、启动时找不到符号：检查最终 APK/AAB 中实际打包的 ABI 和 `.so` 来源，确认 Java/Kotlin 包与 native 库来自兼容版本。
- `INSTALL_FAILED_NO_MATCHING_ABIS`：比较设备 ABI 与产物。当前 View Demo 默认可配置 `armeabi-v7a`、`arm64-v8a`、`x86_64`；当前 Compose Demo 因 LiteAV native 库默认只打 ARM。不能为通过安装删除真实设备需要的 ABI。
- 源码与 AAR 混用时，先确认模块替换和版本解析结果，避免同一 SDK 同时打包两份。

### 权限与系统版本

- 相机、录音、文件等入口不可用：同时检查合并后的 Manifest、当前 Android 版本要求的运行时权限和失败回调，不能只看源码 Manifest。
- Android 12+ 启动组件失败：检查 `android:exported` 与 intent-filter；不要扩大无外部入口组件的导出范围。
- 高版本 Android 页面遮挡、键盘错位或系统栏异常：进入下文 Edge-to-Edge 排查，不通过降低 `targetSdk` 或关闭 Edge-to-Edge 规避。
- 权限被拒绝时应保留失败路径并允许重试；不能因默认集成 CallKit 就在启动时一次申请所有权限，应在实际使用相机、麦克风等能力时按当前组件流程申请。

### Release 与 R8

- 仅 Release 崩溃或类找不到：用相同版本先构建未混淆 Release 对比，再检查组件 `consumer-rules.pro`、`missing_rules.txt`、mapping 和反射/JNI 入口。
- 优先使用组件自带 consumer rules；只有证据指向具体类时才增加最小 keep，禁止 `-keep class ** { *; }`。
- 修复后同时重跑 Debug 和实际 Release 构建，不能用 Debug 通过推断 Release 已修复。

## 登录

必须保留 `onFailure(code, desc)`，再核对：

- `sdkAppID` 是否与 UserSig 签发环境一致
- `userID` 是否与签名中的用户一致
- UserSig 是否过期、登录是否被踢下线
- 是否把管理员 UserSig 当成客户端用户 UserSig
- 网络和当前登录状态

若客户端使用 SecretKey 参考 Demo 生成签名，按主 Skill 要求重复风险提示，但不能因此跳过实际错误码排查。

## CallKit

Android Chat 默认包含 CallKit。集成后通话入口出现但无法呼叫时，依次检查：

- `tuicallkit-kt` 是否已被 settings 和 App 模块正确引入
- `LoginStore` 成功后是否使用相同的 `sdkAppID`、`userID`、`userSig` 初始化 `TUICallEngine`
- 初始化失败回调的完整 `errCode`、`errMsg`，以及对应应用是否具备可用的通话服务
- Manifest、运行时相机/麦克风权限和 CallKit 源码版本是否匹配
- 是否重复初始化、在登录失败前初始化，或混用其他应用的鉴权参数

CallKit 引发构建问题时先修依赖、版本和源码路径，不能自行删除 CallKit。只有客户明确不需要 Call 时，才按 [集成](integration.md) 同时删除模块、依赖、初始化和全部 Chat 通话入口。

客户已明确移除 Call 但入口仍显示时，View 版同时检查 `ChatMessageInputConfig.isShowAudioCall/isShowVideoCall` 和 `C2CChatSettingConfig.isShowVoiceCall/isShowVideoCall` 是否传给实际页面；Compose 版以当前源码真实入口配置为准。

## 会话与聊天页

- 会话列表为空：先确认登录成功、远端确有会话或消息，再看筛选和分页。
- 点击不跳转：从点击项读取完整 `conversationID`，不要重新拼接未知格式。
- 手工构造时核对当前 `ConversationIDUtil`；常见前缀是单聊 `c2c_`、群聊 `group_`。
- 使用 View 版 Chat UI 时页面空白：检查 `setup(conversationID)` 是否执行、ID 是否有效、宿主或互操作容器是否提供 `ViewModelStoreOwner` 等源码要求。
- 使用 Compose 版 Chat UI 时页面空白：检查目标 Composable 是否进入组合、`conversationID` 是否有效、状态和数据层是否就绪，以及导航返回或重组是否覆盖状态。
- 退出、解散、被踢出群后：停止使用旧群 ID，删除或刷新对应会话，并结束失效页面。

## 消息与自定义

- 发送失败：检查登录态、会话类型、群成员状态、消息构造和失败回调。
- 配置不生效：确认传给实际页面的是同一个配置实例，并沿 View/factory/binder 找到字段消费。
- 自定义消息不展示：检查消息类型、data JSON、`businessID`/matcher、priority 和 renderer 注册时机。
- 列表复用错乱：检查 `bindView` 是否重置旧状态，回收时是否取消异步任务。
- action 不出现：核对当前版本的 `customizeActions`、内置 ID、条件过滤和页面配置来源。

## Edge-to-Edge 与系统栏

高版本 Android 出现标题栏、消息列表、输入栏、底部按钮被遮挡，或者页面四周重复留白时，依次检查：

先取得系统版本、`targetSdk`、导航模式、横竖屏、是否有刘海/挖孔、键盘展开与收起截图，以及当前 Activity/BaseActivity 和根布局 Insets 代码。找一个正常页面对比，不同时改多个 padding。

1. 当前 Activity 是否在 `setContentView` 或 Compose 内容创建前，直接或通过 BaseActivity 调用了 `enableEdgeToEdge()`，并采用一致的 `WindowCompat.setDecorFitsSystemWindows(window, false)` 策略；BaseActivity 已处理时不要重复调用。
2. `ChatActivity`、会话、联系人、搜索、聊天设置等所有页面容器是否分别处理了自己负责的系统栏和刘海屏安全区，不能只修一个页面。
3. View 页面是否使用 `WindowInsetsCompat.Type.systemBars()` 与 `displayCutout()`；Compose 页面是否在正确层使用 `statusBarsPadding()`、`navigationBarsPadding()`、`systemBarsPadding()` 或 `safeDrawingPadding()`。
4. Insets listener 是否基于初始 padding 计算，避免每次回调重复累加。
5. 父容器是否错误消费 Insets，导致 Chat 输入组件收不到 IME 或导航栏信息。
6. 外层容器、`Scaffold`、`AndroidView` / `ComposeView` 与内层 Chat 组件是否重复处理同一 Insets。
7. Chat 输入组件已有 IME 处理时，外层是否又把 `ime()` 加到底部，造成键盘弹出后双倍空白或输入栏跳动。
8. 是否使用了固定状态栏或导航栏高度；若有，改为实时 `WindowInsetsCompat` 或 Compose Insets。
9. 浅色/深色主题切换后，状态栏和导航栏图标明暗是否同步更新。

只改 `fitsSystemWindows`、给根布局增加固定 top margin，降低 `targetSdk` 或关闭 Edge-to-Edge 都不是高版本 Android 的正确修复。修复模式参考 [集成中的 Android Edge-to-Edge 页面容器](integration.md#android-edge-to-edge-页面容器)。

## 使用 Android View 版 UI

- 主题崩溃：核对实际 Activity 基类、Manifest 主题和组件源码要求，不改 Chat View 掩盖宿主问题。
- 媒体入口不可用：同时检查 Manifest、运行时权限和对应能力依赖。
- Compose 宿主承载 View 版时，额外检查 `AndroidView`、Fragment 或 Activity 边界以及 owner、销毁和重建行为。

## 使用 Android Compose 版 UI

- 先对照 [Android Compose 全功能接入](https://cloud.tencent.com/document/product/269/125127)检查 Gradle、AGP、JDK、Kotlin 和源码模块兼容性。
- UI 不更新或重复请求：检查状态是否可观察、状态对象是否稳定、effect key 是否正确，以及重组中是否重复执行副作用。
- 导航或返回异常：检查 `conversationID` 参数、路由作用域、状态保存和页面离开后的异步回调。
- 主题、Insets 和权限沿用宿主策略；View 宿主承载 Compose 版时，额外检查 `ComposeView` 或 Compose Activity 的 composition 生命周期、主题和状态恢复。

## iOS、Flutter、uni-app 等平台

客户确认继续后，从[全功能接入](https://cloud.tencent.com/document/product/269/79075)选择匹配文档，再按当前平台的依赖锁文件、构建日志、生命周期、状态管理和源码调用链取证。官网没有匹配组件或本地缺少必要工具链时，说明具体阻塞与替代验证方式；不得猜测平台 API。

## 异常调用检查

集成、自定义或修复后只检查本次触及代码：

1. ID 在调用前非空，且用户、群、会话 ID 类型没有混用。
2. 页面销毁、View detach、切换会话或退出群后，异步结果不会回写旧 UI 或继续请求旧对象。
3. 退出/解散/被踢群成功后，不再刷新原群资料或拉成员。
4. 高频回调不重复拉全量成员、历史消息或资料。
5. 分页有 `isLoading`、`hasMore` 等门闩；搜索和刷新按需要做去重、节流或防抖。
6. matcher、binder 和主线程回调不执行网络请求或重 IO。

只有客户明确要求时才扩大到全工程扫描。

## 创建测试账号和体验消息

- 先区分鉴权、账号、好友、群和消息步骤。
- 保留 REST `ErrorCode`、`ErrorInfo`、HTTP 状态和失败步骤。
- 固定群已存在可以复用；其他失败不能按成功继续。
- 重跑会重复新增单聊和群消息。

## 输出与修复

诊断输出只包含：

1. 症状分类
2. 已确认事实
3. 最可能根因及证据
4. 下一项最小动作，或文件级修复方案
5. 编译和客户复验方式

授权修复后使用工程现有工具执行目标构建或可行的静态检查。交付时区分已验证通过、受工具链限制未验证与仍待客户运行验证的项目。
