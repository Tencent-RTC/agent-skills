# Chat UI 集成

## 默认目标

未指定范围时，主动按最小链路设计：

登录 → 会话列表 → 点击会话进入聊天页 → 文本消息收发

Android 同时默认集成 CallKit，包括模块依赖、登录成功后的初始化和 Chat 中的语音/视频通话入口。不询问客户是否需要，也不把它单独说明为可选步骤。

联系人、搜索、主题、Push 等不混入首轮，除非客户明确要求。

## 只读检查

先从工程确认：

- 宿主平台、UI 技术栈、目标模块、工程类型和可用构建命令
- 客户是否已选择 View 或 Compose 版 Chat UI；未选择时记录默认使用 View 版
- Chat UI 的依赖方式、版本、源码或制品，以及真实包名或模块名
- Android 工程是否已有 `tuicallkit-kt`、CallKit 初始化或自定义通话入口；默认集成时避免重复引入和重复初始化
- 已有应用入口、登录、导航、页面容器、生命周期和主题
- 是接入已有 App，还是改造 Chat Demo
- `sdkAppID`、`userID`、`userSig` 的获取方式
- 客户要求的页面范围和验收目标

缺失信息会改变方案时，按主 `SKILL.md` 的“结构化提问与等待”一次只问一个问题。源码可回答的内容不要问客户。

## 本地 TUIKit Chat 源码版本核对

当前工程或其构建配置实际引用的本地路径中发现 TUIKit Chat 源码时，文件级方案前必须完成本节。只检查当前工程、`settings.gradle(.kts)`、`includeBuild`、模块 `projectDir`、本地依赖声明和客户明确提供的路径；不扫描整个用户主目录，也不把未被工程引用的同名目录当作当前源码。

1. 找到全部实际引用的 TUIKit 源码根目录，核对 `chat`、`atomic_x`、`call/tuicallkit-kt` 等真实模块；多个根目录使用不同版本时必须一并报告。
2. 先判定源码身份，禁止直接把最近的 Git 仓库当作 TUIKit 仓库：
   - 先执行 `git -C "<candidate>" rev-parse --show-toplevel`，规范化结果路径。
   - 只有该 Git 根目录通过 remote、子模块 URL 或可信安装记录确认属于 `Tencent-RTC/TUIKit_Android` 或其 fork/mirror，才能把它的提交作为 TUIKit 提交。
   - `rev-parse --show-toplevel` 失败时直接按“复制源码”处理。
   - Git 根目录是宿主 App 仓库且无法证明宿主本身就是 TUIKit 仓库时，立即按“复制源码”处理；禁止使用宿主仓库的 `HEAD`、分支、remote 或状态作为 TUIKit 版本证据，禁止对宿主仓库执行任何版本切换命令。
3. 对已确认的 TUIKit Git 仓库，只读记录当前分支、`HEAD`、已修改/未跟踪源码和脱敏后的 remote URL。对复制源码，优先读取子模块 gitlink、锁文件或安装记录中明确保存的上游提交；没有可信记录时不得借用宿主提交。
4. 以 `https://github.com/Tencent-RTC/TUIKit_Android.git` 为上游，通过只读远端查询动态取得默认分支名称和该分支 `HEAD` 提交；不得硬编码 `main`、不得用最新 tag 代替。核对阶段禁止对客户源码或其所属仓库执行 `pull`、`fetch`、`checkout`、`switch`、`restore`、`reset`、`clean`、remote 修改、删除或覆盖。可使用：

```bash
git -C "<candidate>" rev-parse --show-toplevel
git -C "<tui-kit-root>" rev-parse HEAD
git -C "<tui-kit-root>" status --short
git -C "<tui-kit-root>" remote -v
git ls-remote --symref https://github.com/Tencent-RTC/TUIKit_Android.git HEAD
```

5. 比较方式：
   - 独立 TUIKit Git 仓库：本地 `HEAD` 与 GitHub 默认分支 `HEAD` 相同且工作区干净，才记录“当前即 GitHub 默认分支最新源码”。提交不同、工作区有源码改动或存在额外本地提交，都记录为“与 GitHub 默认分支最新源码不完全一致”。
   - 复制源码：环境允许只读网络和临时文件时，把 GitHub 默认分支最新快照下载到工程外的系统临时目录，只比较工程实际引用的 TUIKit 模块及对应上游路径，排除 `.git`、构建产物和 IDE 临时文件；比较后确认临时路径位于系统临时目录且使用了 `tuikit-check` 前缀，再通过宿主安全删除工具清理。不得把快照写入客户工程。内容完全一致才记录为最新，否则记录为不完全一致。创建并清理这种工程外临时快照属于只读核对的临时产物，可以在文件级方案授权前执行，但绝不授予客户工程或现有源码路径的写入权限。创建快照可使用：

```bash
snapshot_root="$(mktemp -d "${TMPDIR:-/tmp}/tuikit-check.XXXXXX)" &&
git clone --depth 1 https://github.com/Tencent-RTC/TUIKit_Android.git "$snapshot_root/TUIKit_Android"
```

   - 缺少可信版本证据且无法完成临时快照比较，或 GitHub 无法访问：记录“无法确认是否最新”和具体原因，不得根据目录时间、版本名或模型记忆猜测。
   - 只有已有提交关系或 GitHub compare 证据时，才能进一步说明本地落后、领先或分叉；仅凭 SHA 不同不得推断。
6. 源码与 GitHub 最新不完全一致或无法确认时，先告诉客户本地提交/快照结论、GitHub 默认分支及最新提交、本地修改状态和已确认的工具链兼容性，再按主 `SKILL.md` 的“结构化提问与等待”只问一次：
   - `使用 GitHub 默认分支最新源码`
   - `保留当前本地源码`
   只有 GitHub compare 或已有且对应当前远端提交的本地对象证明本地是上游默认分支旧提交、工作区干净且最新源码与宿主兼容时，第一项标为“推荐”；不得只依据可能过期的 `origin/*` 引用，也不得为取得关系证据而 fetch 客户仓库。存在本地修改、额外提交、fork、分叉、固定提交或兼容性/版本状态无法确认时，第二项标为“推荐”。只能标一个推荐项，调用结构化提问工具时把推荐项排在第一位。
7. 版本选择只确定文件级方案输入，不能替代写入授权：
   - 客户选择 GitHub 最新源码时，在方案中列出新源码的独立暂存/目标目录、受影响模块、引用切换或复制步骤、Gradle/AGP/JDK/minSdk 等兼容变化和旧源码保留方式。授权后也不得在现有源码或外部引用仓库中原地执行 `pull`、`fetch`、`rebase`、`merge`、`checkout`、`switch`、`restore`、`reset`、`clean`、remote 修改、强制覆盖或删除；应把最新源码放入新的独立目录，验证后再按方案切换工程引用，保留原目录供回退。
   - 客户选择保留当前本地源码时，以该源码的真实 API 和构建要求继续，方案中明确记录未采用 GitHub 最新提交或版本无法确认的风险；源码内容和版本证据未变化时不重复询问。
8. 文件级方案必须列出：实际引用源码路径、源码身份判定、本地提交或快照比较结论、GitHub 默认分支和最新提交、工作区修改状态、客户的版本选择、推荐依据、升级/保留方式与回退路径。不得把“无法确认”写成“已经是最新”或默默停止。

## Android UI 源码下载

客户工程没有可用的 Android Chat UI 源码、且集成方案需要源码时，不得立即下载；先把来源、目标新目录、引用方式和回退路径写入文件级方案并取得授权。授权后优先从 GitHub 下载：

```bash
git clone https://github.com/Tencent-RTC/TUIKit_Android.git "<方案指定的新目录>"
```

GitHub 无法访问时使用 CNB：

```bash
git clone https://cnb.cool/tencent/cloud/trtc/TUIKit_Android "<方案指定的新目录>"
```

客户工程已经包含源码时不要重复下载，先按上一节核对版本并在需要时取得客户选择。只锁定制品版本且没有本地源码时，不执行本地源码版本核对。克隆或下载的新源码只能写入方案指定的新目录。随后检查仓库 README、分支或提交、目录结构和构建配置，确认所选 View 或 Compose 版 UI 的真实模块及兼容要求；不能凭本 Skill 写死相对路径。

Android 源码方式集成 Chat 时，默认同时使用仓库中的 `atomic_x`、所选 Chat UI 源码和 `call/tuicallkit-kt`。只有客户完成集成后明确不需要 Call，才按下文移除流程删除 CallKit。

## 真实 API 核对

先搜索客户工程中的定义和调用，再参考所选 Chat UI 版本的官方文档。宿主 UI 技术栈不决定 Chat UI 版本；客户明确选择优先，未指定时默认 View 版。

Chat UI 与宿主技术栈不一致时可以接入，但必须先确认互操作边界：

- Compose 宿主接入 View 版：根据现有导航选择 `AndroidView`、Fragment 或独立 Activity 等容器，并核对 `ViewModelStoreOwner`、生命周期、主题和 Insets。
- View 宿主接入 Compose 版：根据现有页面选择 `ComposeView` 或 Compose Activity 等容器，并核对 composition 生命周期、主题、状态保存和导航。

互操作容器只是承载边界。组件、配置和自定义 API 始终来自客户所选的 Chat UI 版本，不能混用两版 API。

### Android View

下面示例只适用于 View 版 Chat UI，但宿主本身可以是 View 或 Compose。当前源码基线常见入口为：

- `LoginStore.shared.login(...)`
- `ConversationsPageView.setup(...)`
- `ChatPageView.setup(conversationID, ...)`
- `ConversationIDUtil.fromUser(...)` / `fromGroup(...)`

类、包名、参数和配置都以客户工程真实源码为准。不要凭记忆补 API，也不要假设存在手动配置加载方法。

```kotlin
LoginStore.shared.login(context, sdkAppID, userID, userSig, object : CompletionHandler {
    override fun onSuccess() {
        initCallKit(context, sdkAppID, userID, userSig)
        openConversations()
    }
    override fun onFailure(code: Int, desc: String) = showLoginError(code, desc)
})
```

```kotlin
conversationsPageView.setup(
    onConversationClick = { conversation ->
        openHostChatPage(conversation.conversationID)
    }
)
chatPageView.setup(conversationID)
```

上例 `openHostChatPage` 是宿主工程自己的导航函数，不是 Chat UI API；目标页面负责承载 `ChatPageView` 并把完整 `conversationID` 传给 `setup`。

```kotlin
val c2cID = ConversationIDUtil.fromUser(userID)
val groupID = ConversationIDUtil.fromGroup(rawGroupID)
```

### Android Compose

1. 先读 [Android Compose 全功能接入](https://cloud.tencent.com/document/product/269/125127)，核对客户工程的 Android Studio、Gradle、AGP、JDK、Kotlin 和最低系统版本是否兼容。
2. 当前官方方案为手动集成源码；必须以官网当前步骤、客户已引入源码和真实包名为准，不假设 Maven 制品或 View 版 Chat UI API 可用。
3. 优先复用官方 Page 层和 Compose 组件层提供的会话、聊天、联系人组件，并从客户当前源码确认参数、导航回调、状态和生命周期要求。
4. 宿主是 Compose 时沿用其导航、主题和状态管理；宿主是 View 时通过 Compose 互操作容器承载，并明确 composition 生命周期和导航边界。
5. 完整传递 `conversationID`，不把原始用户 ID 或群 ID 当作会话 ID。

## Android 默认 CallKit

默认集成不向客户发起 Call 能力选择，也不单独等待 CallKit 授权；它随 Android Chat 的文件级方案一并实施。方案仍需如实列出实际新增模块、依赖、初始化代码、Manifest 和权限。

源码结构以当前仓库为准。把 `atomic_x`、`chat`、`call` 复制到工程根目录时，常见 View 版接入需要：

```kotlin
// settings.gradle.kts
include(":atomic_x", ":uikit", ":tuicallkit-kt")
project(":atomic_x").projectDir = file("${settingsDir.path}/atomic_x")
project(":uikit").projectDir = file("${settingsDir.path}/chat/uikit")
project(":tuicallkit-kt").projectDir = file("${settingsDir.path}/call/tuicallkit-kt")
```

```kotlin
// app/build.gradle.kts
dependencies {
    implementation(project(":atomic_x"))
    implementation(project(":uikit"))
    implementation(project(":tuicallkit-kt"))
}
```

`LoginStore` 登录成功后初始化 `TUICallEngine`，保留失败错误：

```kotlin
private fun initCallKit(context: Context, sdkAppID: Int, userID: String, userSig: String) {
    TUICallEngine.createInstance(context).init(
        sdkAppID,
        userID,
        userSig,
        object : TUICommonDefine.Callback {
            override fun onSuccess() = Unit
            override fun onError(errCode: Int, errMsg: String) {
                showCallInitError(errCode, errMsg)
            }
        },
    )
}
```

以上相对路径和签名必须以客户实际克隆的源码为准。Compose 版 Chat UI 也默认集成 CallKit，但 Chat 内入口必须按当前 Compose 源码或官方文档的真实扩展点接入，不能套用 View 版配置类。

## Android Edge-to-Edge 页面容器

`ChatActivity`、会话列表、联系人、搜索、聊天设置、合并消息详情及其他承载 Chat UI 的 Activity 或页面容器都必须适配 Edge-to-Edge。不能只处理聊天页；高版本 Android 或较新的 `targetSdk` 会采用强制 Edge-to-Edge 行为，遗漏 Insets 会导致标题栏、内容或输入栏被系统栏遮挡。

先检查宿主是否已在统一 BaseActivity 或主题层完成处理，避免重复应用。View 页面常见窗口基线如下：

```kotlin
abstract class ChatBaseActivity : AppCompatActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        WindowCompat.setDecorFitsSystemWindows(window, false)
    }
}
```

每个页面再按真实布局分配 Insets。以下模式把顶部和左右安全区交给根容器，把底部导航栏安全区交给 Chat 内容容器：

```kotlin
val initialLeft = rootContainer.paddingLeft
val initialTop = rootContainer.paddingTop
val initialRight = rootContainer.paddingRight
val initialBottom = chatPageContainer.paddingBottom

ViewCompat.setOnApplyWindowInsetsListener(rootContainer) { view, insets ->
    val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars())
    val cutout = insets.getInsets(WindowInsetsCompat.Type.displayCutout())
    view.updatePadding(
        left = initialLeft + maxOf(bars.left, cutout.left),
        top = initialTop + maxOf(bars.top, cutout.top),
        right = initialRight + maxOf(bars.right, cutout.right),
    )
    chatPageContainer.updatePadding(
        bottom = initialBottom + maxOf(bars.bottom, cutout.bottom),
    )
    insets
}
ViewCompat.requestApplyInsets(rootContainer)
```

具体分配必须跟随页面层级，不得机械复制：

- 保留原始 padding，避免每次 Insets 分发时重复累加。
- 返回原始 `insets`，除非已经确认某一层必须消费；不能让子 View 收不到键盘或系统栏 Insets。
- Chat 输入组件已有键盘 Insets 处理时，外层只补导航栏安全区，不再把 `ime()` 高度重复加到底部。
- 根据主题更新状态栏和导航栏图标明暗，不能只设置透明系统栏。
- 禁止使用固定状态栏高度、固定导航栏高度或仅依赖 `fitsSystemWindows`。

选择 Compose 版 UI 时，承载 Activity 同样启用 Edge-to-Edge；页面根据职责使用 `statusBarsPadding()`、`navigationBarsPadding()`、`systemBarsPadding()` 或 `safeDrawingPadding()`。使用 `Scaffold`、宿主 padding 和组件 padding 时先明确唯一 Insets 负责人，避免重复留白。

宿主与 Chat UI 技术栈不一致时，外层 Activity 和 `AndroidView` / `ComposeView` 互操作边界也必须纳入 Insets 设计，不能假设内嵌组件会自动修复宿主系统栏问题。

## 选择 View 版 Chat UI

1. 对齐仓库、制品或本地模块依赖，不复制当前 Skill 所在仓库的相对路径。
2. 在现有账号流程取得登录参数并调用真实登录入口，完整保留失败 `code` 和 `desc`。
3. 宿主是 View 时直接用现有 Activity、Fragment 或 View 容器承载；宿主是 Compose 时通过合适的 View 互操作容器承载。
4. 用宿主页面承载真实聊天页组件，把完整会话 ID 传给 `setup`。
5. 宿主必须满足组件实际要求，例如 `ViewModelStoreOwner`；主题沿用工程策略，所有页面容器按上文完成 Edge-to-Edge 和 Insets。
6. 只在最小链路编译通过后追加联系人、搜索或自定义。

## 选择 Compose 版 Chat UI

1. 按官方文档和当前源码接入所需 Compose 模块，不复制无关 Demo 功能。
2. 在现有账号流程取得登录参数，调用当前 AtomicXCore 数据层的真实登录入口并保留失败信息。
3. 宿主是 Compose 时直接使用现有 Compose 页面和导航；宿主是 View 时通过 `ComposeView` 或 Compose Activity 等互操作边界承载。
4. 从点击项传递完整 `conversationID`，复用宿主的主题、状态保存和生命周期策略，并按上文完成 Edge-to-Edge 和 Insets。
5. 先编译最小聊天链路，再追加联系人、搜索或自定义。

## 客户明确不需要 Call

仅当客户完成集成后明确表示不需要 Call 功能时执行：

1. 从 `settings.gradle.kts` 或 `settings.gradle` 删除 `tuicallkit-kt` 的 `include` 和 `projectDir`。
2. 从 App 模块删除 `implementation(project(":tuicallkit-kt"))` 或对应依赖。
3. 删除 `TUICallEngine` / `TUICallKit` 初始化、相关 import、仅供 Call 使用的权限与代码；共用权限必须先确认没有其他功能使用。
4. View 版 Chat 同时隐藏消息输入栏和单聊设置页中的全部语音/视频通话入口：

```kotlin
val messageInputConfig = ChatMessageInputConfig(
    isShowAudioCall = false,
    isShowVideoCall = false,
)
chatPageView.setup(
    conversationID = conversationID,
    messageInputConfig = messageInputConfig,
)

val c2cSettingConfig = C2CChatSettingConfig(
    isShowVoiceCall = false,
    isShowVideoCall = false,
)
```

5. 将 `c2cSettingConfig` 传给实际 `C2CChatSettingView.setup(..., config = c2cSettingConfig)`；检查宿主或自定义 action 是否还添加了 Call 入口。
6. Compose 版使用当前源码真实配置或扩展点隐藏入口；没有对应 API 时删除宿主层入口，禁止编造 View 版同名配置。
7. 编译目标模块，确认不存在 CallKit 符号、资源或依赖残留。不得只删依赖而保留入口，也不得只隐藏入口而保留无用初始化。

## Android Demo 改造路径

1. 先记录 Demo 当前可编译的模块、入口和依赖。
2. 修改包名、品牌资源和宿主导航时，保留真实登录、会话页和聊天页。
3. 替换登录参数来源；不要用本地假消息替换远端链路。
4. 保持 Demo 已有的主题、Manifest 和页面初始化约定，除非客户明确要求调整。
5. 最小链路稳定后再做 UI 自定义和其他产品能力。

## iOS、Flutter、uni-app 等平台

1. 先说明本 Skill 没有该平台的内置 API 基线，给出[全功能接入](https://cloud.tencent.com/document/product/269/79075)或匹配的平台文档，并按主 `SKILL.md` 的“结构化提问与等待”询问是否继续。
2. 客户确认继续后，核对具体平台、框架版本、目标端、组件版本和官方支持范围。
3. 以官网当前指引、客户锁定依赖和真实源码为事实来源，完成只读检查；不得翻译 Android 示例冒充该平台实现。
4. 主动给出文件级方案，并在同一回合按主 `SKILL.md` 的“结构化提问与等待”发起写入授权；授权后可以直接修改客户工程。
5. 使用工程现有工具执行可行的构建、分析或静态检查。签名、证书、设备或本地工具链缺失时，说明未验证项并给客户明确验证步骤，不能因此把已完成部分描述为全部通过。

## 文件级方案与授权

方案必须列出：

- Android 宿主技术栈、客户所选 Chat UI 版本、选择依据；未指定时明确记录默认 View 版
- 宿主与 Chat UI 技术栈不一致时采用的互操作容器及生命周期、主题、状态和导航边界
- 每个 Android Chat 页面容器的 Edge-to-Edge 启用位置、Insets 负责人、顶部/底部/左右安全区和键盘处理
- 默认 CallKit 的模块、依赖、初始化、Manifest 和权限改动；不把它列为待客户选择项
- 采用的平台文档、真实类或组件、源码位置及版本差异
- 发现本地 TUIKit Chat 源码时，列出实际引用路径、源码身份、本地提交或快照结论、GitHub 默认分支最新提交、工作区状态、客户版本选择、推荐依据、新目录切换方式和旧源码回退路径
- 每个新增或修改文件、动作和目的
- 登录参数来源、会话 ID 来源、页面跳转
- 依赖、平台配置、主题、生命周期与构建风险
- 构建或静态检查命令和客户手动验证路径

输出后在同一回合按主 `SKILL.md` 的“结构化提问与等待”发起审批，不得默默停止。只有客户看到该方案并明确授权，才可写文件；方案变化后重新发起审批。

若选择把 SecretKey 放入客户端参考 Chat Demo 调试，在方案、授权前和交付时分别说明其可被提取，并推荐生产改为服务端签发 UserSig；提示风险但不阻断客户选择。

## 实施与验收

授权后按方案修改，只处理必要文件。随后：

1. 执行当前平台和环境可行的目标构建或静态检查，不启动 App 或模拟器。
2. 检查本次新增调用的 ID、会话类型、宿主生命周期和重复请求。
3. 静态检查所有新增或修改的 Android Chat 页面容器都已启用或继承 Edge-to-Edge，并且 Insets 没有重复应用。
4. 验证失败时保留完整错误并转入排障，不写同名空类或 stub。
5. 交付客户验证：登录成功、会话出现、点击进入正确会话、双方文本收发正常；在高版本 Android 上切换手势/三键导航、键盘、横竖屏、刘海屏和浅色/深色主题，确认标题、列表和输入栏均未被遮挡或重复留白。
6. 登录链路已经接好，或客户确认登录成功，但聊天页面还没完成时，按主 `SKILL.md` 的“结构化提问与等待”主动询问，工具问题文本使用“要不要我帮你创建几个测试账号，再准备一些好友、群聊和消息？等聊天页面接好后就能直接体验。”

   最小聊天链路已完成并可交给客户体验时，按同一规则主动询问，工具问题文本使用“要不要我帮你创建几个测试账号，再准备一些好友、群聊和消息？这样你打开 App 就能直接体验聊天。”

   根据当前进度二选一，只问一次，不得只把问题写进正文后结束。不要对客户使用“造数”“灌数据”“seed”“远端对象”“dry-run”等内部术语；客户同意后转入 [体验账号和消息](demo-data.md)，客户拒绝后停止。
