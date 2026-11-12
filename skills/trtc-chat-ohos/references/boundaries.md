# 鸿蒙 Chat UI 能力边界

先经过[本技能入口的隐私门禁与范围说明](../SKILL.md)及共享 Root 的现有分流规则，实施需遵守[公共约束](constraints.md)及各业务 reference：[集成](integration.md)、[自定义](customization.md)、[排障](troubleshooting.md)、[体验数据](demo-data.md)。本文件只描述**已核对的 TUIKit Harmony 源码快照**，客户锁定版本可能不同，必须回到实际引用的 `oh-package.json5`、导出和消费源码确认。所有示例路径相对于客户实际引用的 TUIKit Harmony 根，非机器个人 home。

## 支持分级

| 目标 | 当前 OHOS 真实入口与实施范围 | 结论 |
|---|---|---|
| 已有 Stage App / Chat Demo 接入 | `atomic_x/src/main/Index.ets` 导出底层组件；`chat/uikit/src/main/ets/index.ets` 导出 `ContactsPage/ConversationsPage/ChatPage/ChatDialog`；Demo 的 `EntryAbility/LoginPage/HomePage` 串联登录、会话、聊天 | 公开组件可接入，仍须实际依赖、窗口与工具链验证 |
| 登录/会话/文本收发 | `LoginStore.shared().login(...)`、`ConversationsPage({ onConversationClick })`、`ChatDialog({ conversationID, ... })` / `ChatPage`、内部 `MessageList/MessageInput` | 直接支持最小链路；点击已有会话传完整 `conversationID` |
| 联系人/搜索、主题与内置功能项 | `ContactsPage`、`ConversationsPage` 的搜索、`ThemeState`、`AppBuilderConfig`、底层 `ChatMessageListConfig/ChatMessageInputConfig/ChatConversationActionConfig` | 有能力但逐项查参数**由最终页面消费**；顶层页面不自动透传底层配置 |
| 消息/会话长按业务动作 | 底层 `MessageList.customActions?: MessageCustomAction[]`、`ConversationList.customActions?: ConversationCustomAction[]` | 底层公开可用；现有 `ChatPage/ConversationsPage` 未透传，顶层用法需宿主组合或单独修改 UIKit |
| 输入栏新增“更多”菜单/联系人或设置页任意新条目 | `MessageInputActionIDs` 只定义内置项及红点识别，`ChatMessageInputConfig` 无 `customActions`；当前联系人/设置页无 Android `customizeItems` 同名 API | 公开顶层接口不能直接满足；宿主外置入口或独立授权改内部源码 |
| 自定义消息 | `CustomMessageView.ets` 内建 `businessID === 'text_link'`，其他业务 ID 显示不支持；`MessageItem.ets` 直接分发 | 已内建 `text_link` 可用；**任意 businessID 的 content/cell renderer 注册与会话摘要 registry 不存在**，需单独设计和授权内部修改 |
| 气泡和主题 | `ThemeState.colors.bgColorBubbleOwn/bgColorBubbleReciprocal` 及 `MessageBubbleBackgroundFactory` | 全局主题 token 路径可核；没有 Android 的页面级 `MessageBubbleAppearance` 对等入口 |
| 默认 CallKit | `call/Index.ets` 的 `TUICallKit`，UIAbility `attach/detach`，宿主消费 `call.startCall` 后 `.calls(...)` | 默认纳入 Chat 集成；仅引用 Call 包或仅保留通话按钮都不完整 |
| 客户明确移除 Call | 输入栏 `isShowAudioCall/isShowVideoCall` 存在但 `ChatPage` 未透传；`C2CChatSetting` 直接渲染通话按钮且无公开对应显隐配置 | 不能仅宿主侧“一键关闭”；需单独授权修改实际内部源码/替代页面并完全去掉依赖与事件桥 |
| 测试账号、好友、群聊和消息 | 复用同级 Android 技能目录 `../trtc-chat-android/scripts/` 中平台无关的 Chat REST 脚本；本目录不内置脚本 | 仅当该同级目录存在时可用；确认目标应用、中心账号和预览内容后才能 `--apply`；不会自动生成目标用户的生产 UserSig |
| 编译、登录、会话、消息、配置、窗口和异常排障 | ohpm/hvigor/DevEco、ArkTS 严格编译及真实调用链 | 可只读诊断；修复须单独文件级审批；设备效果由客户验证 |

## 按最小影响面划职责

1. 当前 UI 公开参数或主题可完成 → `ChatPage/ConversationsPage` 或底层 AtomicX 的实际可用配置；以**消费证据**为准。
2. 宿主导航、业务鉴权、登录凭据来源、页面/Window 安全区 → 客户 Stage entry / UIAbility；不把宿主私有 `showChatDialog` 冒充 UIKit API。
3. UIKit/AtomicX 缺少透传、任意消息 renderer、输入栏菜单或设置页显隐 → 提供宿主外置/组合组件的最小方案，确需内部修改时列具体文件、升级成本与回退，**重新审批**；不能承诺 Android 扩展 API 在 OHOS 存在。
4. 账号体系、生产 UserSig 签发、管理员 REST 凭据、业务数据持久化 → 客户服务端责任；本技能仅梳理接口边界。IM SDK 内核问题先最小化取证，再交 SDK 维护方。

## 不在本技能内直接实施

离线 Push/TIMPush、Room、直播、Call UI/通话业务深度定制及套餐问题、生产 UserSig 服务、无关业务页面、未经授权的 UI 内部源码改造，均拆成独立任务。默认 CallKit 的最小接入/成套移除仍属于本技能，不得把默认集成说成“需客户先选择的可选项”。这些能力可以协作，但不把 Android 依赖、类或 Gradle 构建步骤翻译成鸿蒙“等价实现”。

## 其他平台与集合入口

本技能内置 API 基线**仅**为 OHOS ArkTS，且只接收 `platform=ohos`；Android View/Compose 走 Android skill，Web 走 Web Chat skill。iOS、Flutter、uni-app 等平台不由本技能接管，交还 Root 依其文档咨询或能力边界路由，不在 OHOS owner 下实施或归因。不要把 OHOS 或 Android API 用作其他平台的基线。

集合安装由 Root 按 `(chat, ohos)` 分流，代码任务使用共享 session，SDKAppID 沿用 Root 的收集结果；隐私与最终 owner 归因见[共享会话与上报](suite-integration.md)。独立安装若没有 Root，只处理本技能的业务范围，不建立替代上报通道。集成、源码实施和事实咨询分别路由，不能为归因而把纯咨询改成代码任务。

回答“能否做”只列五项：可直接支持什么、需要内部源码/宿主或服务端承担什么、平台支持等级与版本证据、推荐拆分、当前最小可行路径。资料不足明确未知并给出核对文件，而不是许诺 Android 功能已经在 OHOS 公开。
