# 鸿蒙 Chat 公共约束

本文件服务[入口](../SKILL.md)与[集成](integration.md)、[自定义](customization.md)、[排障](troubleshooting.md)、[体验数据](demo-data.md)、[能力边界](boundaries.md)。涉及写代码或真实远端操作时均需读取；路径示例以客户实际引用的 TUIKit Harmony 源码根为准。

## 真相与版本

1. **当前工程真实源码、依赖锁定和运行证据**优先于本技能、Android 文档和模型记忆；先核对 `oh-package.json5` 的名称/入口/`file:`，`build-profile.json5` 的模块 `srcPath`、`Index.ets` 导出、实际组件参数与消费，再决定 API 可用性。不能把一个定义存在视为顶层页面已传入该配置。
2. 本地 TUIKit Harmony 源码发现范围是当前工程、其构建/依赖配置实际引用路径和客户明确给出的路径，不扫描整个 home。按[集成的版本核对](integration.md#本地-tuikit-harmony-源码版本核对)区分独立上游/fork/复制源码；不得用宿主 Git `HEAD`、Android 上游地址或目录时间声称“已是最新版”。不能联网/缺证据标未知，让客户选择版本；版本选择不授予写入权限。现有目录不原地 pull/fetch/覆盖；需要升级时新目录、批准后切换并保留回退。
3. 只用真实组件。禁止空 `@Component`、假会话列表/消息、同名 stub 和降低 ArkTS 严格模式来“通过”构建；不要为一个开关重写整个列表。无公开 API 时标注未知或需改内部源码，不伪造 Android 同名类和签名。

## 修改与授权边界

- 优先在宿主 entry 的登录、导航、窗口、安全区及公开 AtomicX 组件参数解决；需要改 `atomic_x` / `chat/uikit` / `call` 内部时，单独列具体文件、原因、版本升级差异、替代方案和回退路径，再按[入口结构化提问](../SKILL.md#结构化提问与等待所有业务文件共用)展示文件级方案、**同一回合**请求明确写入授权。用户初始“直接改”、普通计划批准和“保留/升级源码”都不代替看到文件清单后的 `按此方案执行`；方案变更重问。
- 默认 Chat 同案接入 CallKit，宿主 UIAbility `attach/detach`、组件发布 `call.startCall`、宿主消费并 `.calls(...)` 缺一不可；集成完毕后明确移除时须成套删除模块、依赖、observer/attach、仅供 Call 使用权限及所有可见通话入口。`ChatPage` 未透传输入栏 Call 显隐，`C2CChatSetting` 没有公开设置页同名开关，不能仅删除依赖却留下按钮，详见[集成](integration.md#明确不需要-call-时)。
- 体验消息先本地 `--self-test`、无 `--apply` 预览并展示将写入的账号/好友/群/消息，再单独确认才 `--apply`；这是**共享业务远端变更**，不得把“接入代码授权”当成体验消息授权。任何影响内容、账号、应用/区域变化须重新预览确认。
- 不超出需求加依赖、权限、签名、Push 或 Room；不提交/推送代码或运行设备，除非客户另外明确要求及授权。用户拒绝/停止就结束相应动作。

## 隐私与唯一共享上报路径

- 首个真实、脱敏 Prompt 仅留在客户工程的本地 consent slot 等待客户选择；明确同意前**不上传任何提示词、SDKAppID 或业务事件**，不为上报扫描 SDKAppID，不留存其他前同意回合待补发。复述隐私告知（包括本轮）、静默、继续交互或环境配置“on”**都不是明确同意**。本技能不收集 SecretKey、UserSig、管理员凭据或项目源码用于上报；业务代码读取客户工程与“上传源码”完全不同。
- 遵守相邻 Root `trtc/SKILL.md` §-1 的共享入口，按[共享会话与上报](suite-integration.md)携带 `route_hint=trtc-chat-ohos`、`product=chat`、`framework=ohos`；与 Host / Root 共用每轮唯一 Prompt、重试预算及最终 owner `invoke`。**不另建**脚本、MCP、REST 上报或队列；不把原始 Prompt 放进 argv。未拿到明确同意绝不通过其他路径发送；Root 区分“关闭体验数据”和“关闭全部上报”，安装/Hook 激活统计独立。
- 业务 REST 创建账号/消息属于客户另行确认的操作，绝不能作为对体验数据上报的同意。固定告知、同意持久化、最多一次提醒、去重及发送回执沿用共享契约，不在这里复制另一套提示词或自行解释模糊回答为 `allow`。`queued` 不代表已上传；只按对应事件的成功回执确认送达。

## 凭据与权限

- 生产签名由服务端为登录用户签发 UserSig；`LoginStore.shared().login(sdkAppID, userID, userSig, getContext())` 使用相同应用、正确用户的签名。业务 REST 的管理员 UserSig 不用于客户端。
- 客户**明确**选择 Demo 式客户端 SecretKey 调试时允许实施，但在文件级方案、写入审批前、交付时各提示一次：客户端密钥可被提取，生产推荐服务端签发 UserSig。仅用于调试，**不得上传密钥或把它写入文档、对话摘要、构建日志、版本库**；用户另外批准在特定客户端目标代码放置调试密钥时，也只改已授权目标文件，不能上传到第三方或误称生产安全。不要从 Demo 的 `build-profile.json5` 复制其本地签名材料路径或凭据。
- 仅加当前能力需要的 `module.json5` 请求权限，核对真实能力运行时授权与 `usedScene`；设备上授权被拒绝要有失败路径。网络、相机、麦克风、文件使用分别检查，不能只靠权限清单推断已可用。

## 鸿蒙宿主与验证

- 沿用宿主现有 ArkTS Stage/UIAbility、页面路由/导航、主题和状态管理；严格 ArkTS 类型/空值/`@State`/`@Prop`/`@ObjectLink` 和 `@Builder` 约束。区别 `chatuikit` 顶层页与 `@tencentcloud/atomicx` 底层组件可传入的参数，见[自定义](customization.md)。
- 所有会话、联系人、搜索、聊天、设置、Dialog 和 Call overlay 核对 WindowStage/安全区/刘海/键盘的负责人；`ChatPage.ets` 已扩展底部系统安全区，`C2CChatSetting.ets` 扩展顶部和底部。外层不再叠加同一安全区/IME；不写固定系统栏高度，不照搬 Android Edge-to-Edge/Insets API。逐页在明暗主题、横竖屏、系统手势、键盘弹收下验证。
- 会话点击传完整 `conversationID`，不以裸 userID/groupID 顶替；仅新发起会话按目标 Core 的 `c2c_`/`group_` 约定构造并校验。组件销毁/换会话/退群后清理 observer/计时器/异步回写，高频刷新防重复、分页加门闩；只检查本次触及代码，客户要求才扩大全工程。
- 按当前客户环境执行 ohpm、DevEco 或经 `--help` 核对的 hvigor 构建；若没有 wrapper/SDK/签名环境，做可行静态检查并列未验证项。**不主动启动 App/模拟器**，交付区分已编译、工具链限制、待客户设备验证及未覆盖能力，不用 stub 或忽略错误假装通过。
