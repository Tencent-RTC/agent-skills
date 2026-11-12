# 鸿蒙 Chat UI 排障

先按[入口](../SKILL.md)完成 Root 隐私门禁和结构化提问；遵守[公共约束](constraints.md)。默认**只读**取证，不启动 App/模拟器，不凭猜测修复；需要变更先给文件级方案并在同一回合审批。版本依据见[集成](integration.md#本地-tuikit-harmony-源码版本核对)，定制问题参见[自定义](customization.md)，测试账号故障参见[体验数据](demo-data.md)，职责争议参见[边界](boundaries.md)。所有源码路径以实际引用的 TUIKit Harmony 根为起点。

## 最少证据与定位

收集第一处有效 ArkTS/hvigor/ohpm 编译错误或完整登录/IM/Call 错误码与描述、目标 SDK/API/DevEco 版本、涉及页面和操作顺序、是否 Debug/Release/特定设备、是否稳定复现、实际引用的 `oh-package.json5` 与 `build-profile.json5`、锁文件解析结果、完整 `conversationID` 与来源、当前登录状态、窗口/键盘/权限、使用的是 `chatuikit` 顶层页面还是 AtomicX 底层组件。凭据、用户消息内容和项目源码**不进上报或对外诊断摘要**。缺失信息会改变判断时，按入口一次只问一个明确问题。

按“构建 → 登录 → 会话 → 聊天页/消息 → 配置/自定义 → Call → UIAbility/Window → 体验消息”分症状，只取最后一个正常点与第一个异常点；沿客户真实代码查导出、参数、状态和消费。证据不足时写出下一项最小取证动作，避免多个猜测性修复并行。

## 构建、依赖和 ArkTS

1. 先核对目标工程 Stage 模式/SDK 和 `chat/demo/build-profile.json5` 所示 `entry/atomic_x/chatuikit/tuicallkit` 四个模块关系；`@tencentcloud/atomicxcore` 是 ohpm 依赖而非本地模块。`chat/demo/entry/oh-package.json5` 的 `file:` 是**相对 Demo** 的示例，移入宿主后须重算并查每个 `oh-package.json5` 的 `name/main` 和锁文件；`chat/uikit` 以 `file:../../atomic_x/` 引用 AtomicX，复制时打乱相对层级会出现 `@tencentcloud/atomicx` 解析失败。确认 `@tencentcloud/atomicxcore`、IM SDK、CallKit 最终解析为相容的一套（`imsdk` 版本冲突被 ohpm 自动解析属于预期），不凭 `module not found` 建空 HAP/HAR 或复制同名类。
2. 依客户可用的 `ohpm install`、DevEco Build HAP、已有 wrapper 或[模板的 DevEco 自带 hvigor 命令](blank-project-template.md#6-构建)复现；不得默认工程存在 `hvigorw`。`atomic_x` 源码自身的 ArkTS `WARN`（如 `@Prop` 可选、`@ObjectLink` 赋值、deprecated API）是上游现状，只处理 `ERROR`。`hvigorfile.ts`、entry `module.json5`、资源/RawFile、`Index.ets` 导出和 `@kit.*`/`@ohos.*` import 逐层排查。引用 Core 的本地路径断裂时修依赖来源，不降低严格模式来压过诊断。
3. 严格 ArkTS 的字段声明、回调类型、联合类型、`@Component`/`@Builder` 构造和 `@State`/`@Prop`/`@ObjectLink` 约束按第一处编译错核对；不要把 Android `Activity`/Gradle、TS 的无约束动态对象或假 `any` 写进 `.ets`。构建产物/签名失败应区分代码错误与本地签名/设备证书，不复制 Demo 私有签名路径与口令；Release 独有问题再检查混淆和资源差异，不盲目禁用保护或打包重复 `.so`。
4. 本地源码版本不一致不等于必须升级：按[集成](integration.md#本地-tuikit-harmony-源码版本核对)确认上游默认分支、工作区和兼容性，再让客户选择保留或独立引入；不能在现有源码上原地 `pull/fetch/reset`。

## 登录、会话与消息

- `chat/demo/entry/src/main/ets/pages/LoginPage.ets` 的顺序是业务登录取得同应用 `sdkAppId/userId/userSig` → `LoginStore.shared().login(sdkAppId, userId, userSig, getContext())` → 成功跳 `pages/HomePage`；记录 Promise rejection 的实际错误信息，检查 UserSig 签发的 SDKAppID/userID、过期/踢下线、网络和重复登录。`DevLoginPage.ets` 的客户端 `genTestUserSig` 仅调试；`SplashScreenPage.ets` 自动登录从缓存取 ID/签名但 SDKAppID 用 `SDKAPPID` 常量，若业务与调试应用不同须查来源一致性。管理员 UserSig 不能拿来当客户端登录凭据。
- 会话列表空：确认已登录、远端存在该用户可见的会话/消息，再查 `ConversationListStore` 加载状态/筛选/分页及 `ConversationsPage.ets` 的 `ConversationList` 消费；不能用假列表证明接入。点击不跳：`HomePage.ets` 使用 `ConversationInfo.conversationID` 原值构造 `ChatDialog`；联系人/群新建才用与当前 Core 约定一致的 `c2c_` / `group_` 前缀，不传裸 userID/groupID 或重复拼接。
- 聊天页空/发送失败：检查 `ChatDialog` controller 是否 open 且未被早期 close、`ChatPage({ conversationID })` 是否有合法完整 ID，`MessageList/MessageInput` 是否从它建立对应 store、登录态和群成员资格、失败回调以及 `ConversationType`；`chat/uikit/src/main/ets/pages/ChatPage.ets` 在 `aboutToDisappear` 退订 profile observer 并清理未读计时器，检查页面离开/换会话后是否还把异步结果回写旧 UI。被踢/解散群成功后停止刷新原群、关闭旧会话。
- 自定义消息显示“不支持”：核对 `CustomMessagePayload.customData` 或 raw `customElem.data` 的编码及 JSON `businessID`；`CustomMessageView.ets` 仅 `text_link` 显示文字/链接，其他 ID 缺少任意 renderer 注册，不能按 Android matcher/priority 去排查不存在的注册 API。配置不生效：核对 `ChatMessageListConfig`、`ChatMessageInputConfig` 或 `ChatConversationActionConfig` 是否传到**当前实际渲染**的底层 `MessageList/MessageInput/ConversationList`；顶层 `ChatPage/ConversationsPage` 当前不透传多项参数。action 不出现时先确认配置作用层级、长按状态、机器人等特殊会话及当前列表 UI 消费路径，不虚构 `customizeActions`。

## CallKit 与权限

- 入口能点而不呼叫：查 `call/Index.ets` 的导出及宿主 entry 包依赖；`EntryAbility.ets` 是否在 `loadContent` 成功后 `attach(windowStage)` 并在 `onWindowStageDestroy` `detach()`；`HomePage.ets` 是否用同一个 `TUIObserver` 订阅 `TUIEventBus` 的 `call.startCall`，读取非空 `participantIds`、正确映射 `mediaType`/`chatGroupId` 到 `TUICallKit.createInstance(getContext()).calls(...)`，`aboutToDisappear` 退订。直接 `C2CChatSetting` 不传回调时发布默认事件，但 `C2CSettingDialog` 的空回调会拦截它；需核实实际点击路径。Demo 未处理 `.calls(...)` Promise，CallKit 自身也会截获部分失败，不能仅凭 Promise 无异常判定通话已成功。只 attach 不消费事件、不 attach 仅消费事件都无法组成完整默认链路；避免多个宿主同时消费一次点击。记录 CallKit 真实失败/套餐与服务可用性，不从 Android `TUICallEngine.init` 推理。
- 录音/相机/相册/文件问题核对 `entry/src/main/module.json5` 最终权限、`usedScene` 与系统运行时授权、当前媒体能力以及失败路径，按实际使用时申请，不为消除失败一次请求全部权限。Demo 的注释掉的 `CAMERA` 配置不等于宿主已具备相机权限。客户要求不需要 Call 时按[完整移除](integration.md#明确不需要-call-时)处理，不私自删除依赖留可见入口。

## UIAbility、Window、安全区与键盘

取得目标 OS/SDK 版本、手势/三键导航、横竖屏、刘海/挖孔、深浅色、软键盘展开前后页面截图和宿主 `onWindowStageCreate`/窗口配置。逐页找出安全区**唯一责任层**：`ChatPage.ets` 对底部执行 `expandSafeArea([SafeAreaType.SYSTEM], [SafeAreaEdge.BOTTOM])`；`C2CChatSetting.ets` 扩展顶部/底部；Demo `HomePage.ets` 的 `ChatDialog` 采用 `ImmersiveMode.EXTEND` 和 `KeyboardAvoidMode.NONE`。若宿主另给顶部/底部 padding 或自动避让键盘，先定位是哪层重复或缺失，再改最小一处，不能用 Android `WindowInsetsCompat`、固定状态栏高度、降低系统版本掩盖错误。分别验证会话、联系人、搜索、聊天、设置和 Call overlay，不能只修聊天页。

## 异常调用检查

只自动审查本次修改的 SDK 调用：ID 非空且 user/group/conversation 类型不混，只有当前有效登录态才操作；UIAbility/组件销毁、Dialog 关闭、换会话、退出群后停止旧订阅/计时器/异步回调；高频事件不重复拉全量会话/消息/成员，分页具备加载门闩，搜索/刷新按需去重和节流；渲染、菜单回调不在 UI 线程做网络/重 IO。客户要求才扩大到全工程。

## 体验消息故障与输出

[体验数据](demo-data.md)的 REST 步骤失败应保留 HTTP 状态、REST `ErrorCode/ErrorInfo`、失败步骤和哪一项已经成功；固定群仅在归属与成员匹配时可复用，重跑消息会重复，不可把失败当成功。排障答复只需：症状类别、已确认事实、最可能根因及证据、下一项最小动作或逐文件修复方案、目标构建和客户手动复验。授权后修复并执行可行的构建/静态检查；交付明确区分已验证、工具链限制及待客户设备运行验证。
