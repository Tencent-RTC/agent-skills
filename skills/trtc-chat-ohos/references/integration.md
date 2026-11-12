# 鸿蒙 Chat UI 集成

遵循[本技能入口的隐私与授权闸门](../SKILL.md)及其引用的共享 Root 约束、[公共约束](constraints.md)；已有报错先读[排障](troubleshooting.md)，定制或创建体验数据分别读[自定义](customization.md)、[体验数据](demo-data.md)，范围争议见[边界](boundaries.md)。以下路径均**相对于 TUIKit Harmony 源码根**（公开仓库 `Tencent-RTC/TUIKit_Harmony` 的根目录，下含 `atomic_x/`、`chat/uikit/`、`chat/demo/`、`call/`），不是当前技能仓库的下载/安装路径；逐项核对客户版本。工程内没有任何 TUIKit 源码或依赖时，按[空白工程最小模板](blank-project-template.md)落地，本文其余章节用于核对与定制。

## 默认目标与只读清单

最小链路为 `LoginStore.shared().login` → `ConversationsPage` → 点击项的完整 `conversationID` → `ChatDialog`（内含 `ChatPage` / `MessageList` / `MessageInput`）→ 双向文本收发。首次集成默认同案纳入 CallKit `@tencentcloud/tuicallkit` 的真实依赖、窗口 attach/detach 和通话事件消费；不要求客户再选择是否集成 Call。联系人和搜索可后加；Push、Room、生产签名服务及 Call 深度定制不混入首轮。

先从宿主确认：Stage/ArkTS 工程与 DevEco/Harmony SDK 版本，目标 entry 模块、`oh-package.json5`、`build-profile.json5`、`hvigorfile.ts`、锁文件、入口 `module.json5`、页面路由、现有 UIAbility 与窗口生命周期、依赖是否是本地源码/制品、已有 Chat/Call 初始化、登录参数来源、资源/权限/主题、安全区责任。需要客户信息时按[入口的结构化提问](../SKILL.md#结构化提问与等待所有业务文件共用)单问；先读源码能知道的不要问。不要把 Android View/Compose 混用判断套到鸿蒙 ArkUI。

## 本地 TUIKit Harmony 源码版本核对

只检查当前工程、`oh-package.json5` 中 `file:` 引用、`build-profile.json5` 的 `srcPath`、锁文件和客户明确给出的源码位置；**未引用的邻近仓库不等于当前版本**。在方案前：

1. 列明实际引用的 `atomic_x`、`chat/uikit`、`call` 路径与 `@tencentcloud/atomicxcore` 版本。公开上游的 `chat/demo/entry/oh-package.json5` 将 `chatuikit` 指向 `file:../../uikit`、`@tencentcloud/atomicx` 指向 `file:../../../atomic_x`、`@tencentcloud/tuicallkit` 指向 `file:../../../call`，`@tencentcloud/atomicxcore` 为 ohpm 依赖 `^5.1.0`；`chat/demo/build-profile.json5` 只声明 `entry/atomic_x/chatuikit/tuicallkit` 四个模块。内部仓库可能出现 `call_v2` 或本地 core 模块，以客户实际配置为准。以上仅是 Demo 的引用事实，不能直接移植到客户目录。
2. `git -C <候选源码路径> rev-parse --show-toplevel` 仅用于识别边界；只有 remote、子模块或可靠安装记录证实仓库属于相应 TUIKit Harmony 上游/fork，才能把其 `HEAD` 当作 TUIKit 提交。若返回宿主 App 仓库或无法证明源码身份，按**复制源码**处理，禁止以宿主 `HEAD` 冒充上游版本。只读记下独立仓库 `HEAD`、工作区状态和已脱敏 remote；复制源码优先查有证据的 gitlink/安装记录。
3. 官方上游为 GitHub `https://github.com/Tencent-RTC/TUIKit_Harmony.git`，GitHub 不可达时用 CNB `https://cnb.cool/tencent/cloud/trtc/TUIKit_Harmony`；客户源码有可信记录指向其他 fork/mirror 时以该记录为准。用 `git ls-remote --symref <上游地址> HEAD` 动态取得默认分支及当前提交；不能照抄 Android 上游地址、硬编码 `main` 或用 tag 当最新。无网络则记为“无法确认”，不猜。
4. 独立同源 Git 仓库仅在本地 `HEAD` 与上游默认分支 `HEAD` 相同且相关工作区干净时标记“当前即最新”；其他情况标记“不完全一致”。复制快照仅在允许的情况下，将上游最新源码放到**客户工程外**的系统临时目录，只比较实际引用的模块、排除构建产物和 `.git`；不能生成工程内比较产物。没有可信记录且不能比较就标“无法确认”。只凭 SHA 不同不能推断落后/领先/分叉；需已有提交关系或上游 compare 证据。
5. 不一致/无法确认时用结构化提问让客户选择“保留当前本地源码（有修改/版本不明时推荐）”或“使用经核对的上游默认分支最新源码（仅在干净、确知兼容且确实落后时可推荐）”。这个**版本选择不是写入授权**；方案列出实际路径、来源证据、提交或快照结果、上游默认分支及提交、状态、推荐依据、兼容性、选择、回退。禁止在客户现有仓库上 `pull/fetch/checkout/switch/reset/clean` 或原地覆盖；若授权采用新源码，在独立新目录暂存并验证后按批准方案切换引用，旧目录保留。
6. 工程尚无可用鸿蒙源码时：出方案前可把第 3 条的官方上游 `git clone --depth 1` 到**客户工程外的系统临时目录**只读核对模块、导出和依赖版本（不写客户工程）；文件级方案批准后，再按[空白工程最小模板](blank-project-template.md#1-获取源码)把 `atomic_x`、`chat/uikit`、`call` 保持相对层级复制到工程内新目录，并记录上游地址与提交号。依赖版本以复制下来的 `oh-package.json5` 为准，不凭记忆填写。

## 真实模块、依赖与构建

- `atomic_x/oh-package.json5` 的名称是 `@tencentcloud/atomicx`，`main` 为 `Index.ets`，其 `src/main/Index.ets` re-export `messagelist/Index`、`messageinput/Index`、`conversationlist/Index`、`contactlist/Index` 等；包依赖 `@tencentcloud/atomicxcore`、`@tencentcloud/imsdk`、`@tencent/mmkv`。宿主常用的 `ContextProvider`、`TUIEventBus`、`TUIObserver`、`NotifyParams`、`ThemeState` 从 `@tencentcloud/atomicx/src/main/ets/basecomponent/Index` 引入；`LoginStore`、`LoginEvent`、`ConversationInfo`、`ErrorInfo` 从 `@tencentcloud/atomicxcore` 引入。
- `chat/uikit/oh-package.json5` 名称是 `chatuikit`，以 `file:../../atomic_x/` 引用 AtomicX（复制时必须保持 `atomic_x` 与 `chat/uikit` 的相对层级）；`chat/uikit/src/main/ets/index.ets` 声明 `ContactsPage`、`ConversationsPage`、`ChatPage`、`ChatDialog`，包根 `Index.ets` 已重导出，可直接从 `chatuikit` import。
- `call/Index.ets` 是 `@tencentcloud/tuicallkit` 的公开入口，导出 `TUICallKit`，并从 atomicxcore 转导出 `CallMediaType`、`CallParams`、`CloudRecordPolicy`。
- 对宿主采用其实际相对路径，核对每条 core/IM/Call 版本只解析一份；`ohpm install` 报 `@tencentcloud/imsdk` 版本冲突并自动解析为较高版本属于预期，同时会改写各模块的 `oh-package-lock.json5`。CallKit/AtomicX 的 HAR 会自动合并相机、麦克风、后台运行等权限，宿主只需声明 `INTERNET` 和 `GET_NETWORK_INFO`（见[模板](blank-project-template.md#2-工程配置)）。不复制 Demo 中的签名证书路径/口令，也不提交本地签名材料。
- 依工程现有工具执行 `ohpm install` 和目标 HAP 构建；工程有 `hvigorw` 时用其 `--help` 确认 `assembleHap` 及模块参数；没有时使用 DevEco Studio 的 Build HAP，或按[模板的构建命令](blank-project-template.md#6-构建)调用 DevEco 自带 hvigor。不能假设 Gradle/AGP/JDK 适用，也不能把 IDE 解析成功当作 HAP 编译通过。编译器的 ArkTS 严格诊断必须按第一处错误修正，不用 `any`、动态属性、同名 stub 掩盖问题。

## 登录、页面与会话

现有 `chat/demo/entry/src/main/ets/pages/LoginPage.ets` 从业务登录返回 `sdkAppId/userId/userSig` 后调用 `LoginStore.shared().login(sdkAppId, userId, userSig, getContext())`，成功后 `router.replaceUrl({ url: 'pages/HomePage' })`；Demo 的 IM 登录失败处理把错误码固定为 `0`，只记录错误描述而未向用户展示，**不能照抄作为生产失败处理**。先成功登录再呈现会话页；宿主须保留真实错误码/描述并使用自己的错误展示入口，实际 Promise 可能 reject 非 `Error`，要按当前工程的类型/错误结构安全转换，不能无声吞掉。`DevLoginPage.ets` 的 `genTestUserSig` 与 `SplashScreenPage.ets` 自动登录只作调试/复登参考，**生产由服务端签发目标用户自己的 UserSig**。不得把管理员签名用于客户端。现有 `chat/demo/entry/src/main/ets/entryability/EntryAbility.ets` 在 `onCreate` 初始化 `MMKV` / `ContextProvider`；宿主若已有相同初始化则复用，不二次初始化。`SplashScreenPage.ets` 的自动登录还需要核对持久化 SDKAppID 与缓存 userID/userSig 的一致性，不能照抄其常量签名逻辑到生产。

`chat/demo/entry/src/main/ets/pages/HomePage.ets` 提供可核对的 ArkUI 用法：

```ts
ConversationsPage({
  onConversationClick: (item: ConversationInfo) => {
    this.showChatDialog(item.conversationID, item.title || 'Chat', item.avatarURL);
  }
})
```

其中 `showChatDialog` 是 **Demo 的宿主私有导航函数**，不是 UIKit API；Demo 在该函数中创建 `CustomDialogController({ builder: ChatDialog({ conversationID, title, avatarUrl, status: '', onBack: ... }) })` 并 `open()`。宿主可改用自己的页面路由承载 `ChatPage({ conversationID, title, ... })`，但必须传真实 `ConversationInfo.conversationID`；`ContactsPage({ contactStore: ContactStore.shared, groupStore: GroupStore.shared, onContactClick, onGroupClick })` 的参数见 `chat/uikit/src/main/ets/pages/ContactsPage.ets`。从联系人主动开启时 Demo 构造 `c2c_${contact.userID}`、`group_${group.userID}`，但**点击已有会话优先使用列表原值**，不要截断或二次拼接。空 ID、错误类型或群已解散不打开聊天。

## 默认 CallKit：宿主必须接线

`call/Index.ets` 导出 `TUICallKit`，并转导出 `CallMediaType`、`CallParams`；不是 Android 的 `TUICallEngine.init(...)`。`chat/demo/entry/src/main/ets/entryability/EntryAbility.ets` 在 `onCreate` 执行 `MMKV.initialize(...)` 与 `ContextProvider.init(this.context)`，在 `onWindowStageCreate` 成功 `loadContent` 后执行 `TUICallKit.createInstance(this.context).attach(windowStage)`，在 `onWindowStageDestroy` 执行 `TUICallKit.createInstance(this.context).detach()`，并在 `onConfigurationUpdate` 调用 `ContextProvider.onConfigurationUpdate(newConfig)` 同步深浅色/语言；先查宿主是否已有相同初始化与 attach/detach，避免重复。完整可编译写法见[模板](blank-project-template.md#3-entryability)。

`atomic_x/src/main/ets/messageinput/components/MessageInput.ets` 的通话入口经 `AtomicCallEventPublisher` 发布事件；直接使用 `chatsetting/pages/C2CChatSetting.ets` 且不传通话回调时也发布默认事件，**但 `C2CSettingDialog` 包装层总会传入回调，宿主未提供对应回调时它会空转而不发布事件**，须核对最终承载路径并显式接线。仅 attach 窗口不会自动消费点击。Demo `HomePage.ets` 在 `aboutToAppear` 中 `TUICallKit.createInstance(getContext())`，用 `TUIEventBus.getInstance().subscribe('call.startCall', null, observer)` 注册 `TUIObserver.onNotify(event, key, params)`，从 `params.data` 读 `participantIds`、`mediaType`、可选 `chatGroupId/timeout` 后将 AtomicX 通话类型映射到 CallKit 类型，调用 `TUICallKit.createInstance(getContext()).calls(participantIds, callKitMediaType, callParams)`；`aboutToDisappear` 以**同一 observer** `unsubscribe('call.startCall', null, observer)`。AtomicX（`@tencentcloud/atomicx/src/main/ets/call/common/CallStore`）与 CallKit 都导出 `CallMediaType`，引入 CallKit 的类型时需起别名（如 `CallMediaType as CallKitMediaType`）。群聊用 `new CallParams('', timeout, '', chatGroupId)`，具体构造签名以锁定的 `call` 模块为准；可编译的完整事件桥见[模板](blank-project-template.md#5-会话列表聊天页与通话事件桥)。只在有效 `participantIds` 下呼叫，不能重复订阅、在 UIAbility 已销毁后再发起或无声吞掉失败；Demo 未处理 `.calls(...)` 返回的 Promise，部分失败还被 CallKit 内部处理，宿主需要设计用户提示和内部诊断，不要认为等待 Promise 就能获得所有失败。此处仅覆盖 `call.startCall`，不能据此声称 `call.startJoin` 等事件已接线；保留通话权限/失败路径。Demo 的 `HomePage.ets` 是事件桥接位置，不能把 Android 登录后 init 的签名直接迁移。

## UIAbility、Window 与安全区

逐一核对会话、联系人、搜索、聊天、设置及 Call overlay 的**窗口/页面责任**。`chat/uikit/src/main/ets/pages/ChatPage.ets` 已在根 Column 使用 `.expandSafeArea([SafeAreaType.SYSTEM], [SafeAreaEdge.BOTTOM])`；`atomic_x/src/main/ets/chatsetting/pages/C2CChatSetting.ets` 则扩展顶部和底部。`HomePage.ets` 的聊天 Dialog 使用 `LevelMode.EMBEDDED`、`ImmersiveMode.EXTEND`、`KeyboardAvoidMode.NONE`。嵌入宿主之前先检查 WindowStage 和宿主页面的安全区/键盘避让策略：只让一个层级负责顶部/底部/左右系统安全区、刘海与键盘；不要把系统栏高度写成常量，不要在父容器与 Chat 的 `expandSafeArea` 重复添加底部 padding，更不能机械复制 Android `WindowInsetsCompat`。按目标 API 版本和宿主当前窗口设置核验系统栏明暗、横竖屏、手势导航和软键盘。宿主若使用完整页面而非 Dialog，应重新确认 `onBack` 和 Window 安全区行为。

## 明确不需要 Call 时

仅在集成完成后客户明确要求移除时，先列出并另行审批：撤掉 `build-profile.json5` 的 `tuicallkit` 模块引用、entry `oh-package.json5` 的 CallKit 依赖、`EntryAbility` attach/detach、`HomePage` 的 observer 和 `.calls(...)`、仅供 Call 使用的权限；共用权限先查其他功能。`MessageInput` 公开 `ChatMessageInputConfig({ isShowAudioCall: false, isShowVideoCall: false })`，但 `ChatPage.ets` 当前**内部自己创建配置，没有公开 inputConfig 参数**；仅宿主层隐藏按钮不能声称 Chat 中全部通话入口已去除。`C2CChatSetting.ets` 的通话按钮是内部直接渲染，**没有 Android 那组 `C2CChatSettingConfig.isShowVoiceCall/isShowVideoCall` 公共开关**；要彻底移除需对实际引用的 AtomicX / UIKit 源码单独列文件、回退及升级成本并再次授权，或由宿主以受控替代页承载设置，逐个验证无残留入口。不准只移除依赖却留下可点的通话入口。

## Demo 改造、文件级方案和验收

先确认 Demo 当前能编译的 entry / AtomicX / UIKit / call 以及 ohpm 解析出的 atomicxcore 版本，再替换登录参数来源、宿主品牌/导航；保留真实会话和消息链路，不用本地假数据代替远端。按[入口审批规则](../SKILL.md#结构化提问与等待所有业务文件共用)在同一回合给出**逐文件**动作、源码版本选择及来源证据、依赖与签名材料边界、登录参数与会话来源、UIAbility/Window/Call/权限及回退、实际 ohpm/hvigor/DevEco 验证命令，然后请求明确授权。授权后只改必要文件，构建或静态检查目标模块，不主动启动 App/模拟器。请客户在设备上验证登录成功/失败、真实会话点击、双方文字收发、Call 发起/返回、键盘弹收、系统栏/刘海、横竖屏、浅色/深色；如登录已成功或链路完成按[入口主动邀请](../SKILL.md#主动推进与交付)只问一次是否准备体验账号与消息。
