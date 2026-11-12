# 鸿蒙 Chat UI 自定义

先执行[入口 Root/方案授权](../SKILL.md)，核对[集成的本地源码版本](integration.md#本地-tuikit-harmony-源码版本核对)并遵循[公共约束](constraints.md)；现象异常先读[排障](troubleshooting.md)，需要远端消息读[体验数据](demo-data.md)，不支持的公开能力按[边界](boundaries.md)如实告知。路径均相对于实际引用的 TUIKit Harmony 源码根。

## 选择最小影响面

1. 内置开关/布局、主题状态 → 先核对 `atomic_x` 已导出的 ArkTS 配置和**实际消费位置**。
2. 消息或会话长按新业务动作 → 用底层 `MessageList.customActions` / `ConversationList.customActions`；若宿主只调用 `chatuikit` 顶层 `ChatPage` / `ConversationsPage`，确认它们**没有透传相应参数**，先提出单独授权的 UIKit 改动或由宿主组合底层组件。
3. 自定义业务消息内容/整行 → 核实实际 `businessID` 解析及消息分发；当前**没有公开任意 businessID content/cell renderer 注册表**。不可声称 Android 的 `setCustomMessageRenderer` / summary registry 可用于 OHOS。
4. 输入栏更多菜单、联系人/设置页面新 item → 若无参数透传或公开扩展，考虑宿主外置入口；必须进入内部组件时单列影响文件、升级和回退成本，重新审批，不为一个图标重写整个聊天页。

`atomic_x/src/main/ets/messagelist/config/MessageListConfig.ets` 定义 `MessageListStyleProtocol` / `ChatMessageListConfig` 的对齐、头像、时间、间距、已读、`messageActionStyle` 与内置动作 `isSupportCopy/Delete/Recall/Forward/...`；`messagelist/components/MessageList.ets` 实际消费 `config` / `customActions`。`conversationlist/config/ConversationListConfig.ets` 的 `ChatConversationActionConfig` 提供删除、免打扰、置顶、未读、清空历史的显隐；`conversationlist/pages/ConversationList.ets` 消费 `config` / `customActions`。配置仅存在于定义不代表顶层页面消费：`chat/uikit/src/main/ets/pages/ChatPage.ets` 的 `MessageList({ conversationID, locateMessage, ... })` 没传自定义 `config/customActions`；`ConversationsPage.ets` 的 `ConversationList({ onConversationClick })` 也没传 `config/customActions`。另外当前 `ChatMessageListConfig.isShowRightAvatar` getter 固定返回 `true`，设置该属性不能隐藏右侧头像；如需修正要单独列内部源码变更。必须在宿主最终**实际渲染**的组件实例上查到消费，才可承诺生效。

## 主题、搜索、气泡与功能开关

- `atomic_x/src/main/ets/basecomponent/theme/ThemeState.ets` 的 `ThemeState.getInstance().setThemeMode(ThemeMode.light | ThemeMode.dark | ThemeMode.system)`、`setPrimaryColor('#RRGGBB')` 为当前真实入口；`@StorageLink('ThemeState')` 在 UIKit 的 `ChatPage`、`ConversationsPage` 和 `ContactsPage` 被使用。`basecomponent/utils/AppBuilderHelper.ets` 的 `AppBuilderConfig.getInstance()` 从 `appConfig.json` 读取 `hideSearch` / `enableCreateConversation` / `hideSendButton` 等；`ConversationsPage.ets` 和 `ContactsPage.ets` 实际检查 `hideSearch`，`ConversationsPage.ets` 的建群菜单检查 `enableCreateConversation`，`ChatMessageInputConfig.isShowSendButton` 会读 `hideSendButton`。`AppBuilderHelper.ets` 对 `hideSearch/hideSendButton` 等布尔值使用真值判断：配置文件写 `true` 可启用，重载时写 `false` 不一定能将已有内存值重置，须检查初始化与重载时机。核对每个配置的具体消费，不把 Android 中“未消费”的结论照搬到 OHOS。
- `atomic_x/src/main/ets/messagelist/ui/MessageItem.ets` 的默认自身/对方气泡使用 `ThemeState.colors.bgColorBubbleOwn/bgColorBubbleReciprocal`，部分样式由 `messagelist/adapter/MessageBubbleBackgroundFactory.ets` 分派；优先改当前主题的颜色 token 并同时测试深浅色、引用/合并消息；`setPrimaryColor` 会影响自己的 `bgColorBubbleOwn`，**不会同时改变对方的 `bgColorBubbleReciprocal`**，对方气泡应核对实际 token 更新路径。当前 `ChatMessageListConfig` **没有** Android 的 `MessageBubbleAppearance` / `MessageBubbleBackground.Color` 页面级接口。需要只改某个会话/消息时应提出内部组件方案而非假设 theme 是局部配置。
- `atomic_x/src/main/ets/messageinput/config/MessageInputConfig.ets` 的 `ChatMessageInputConfig({ inputStyle: 'classic' | 'minimalist', isShowAudioRecorder, isShowPhotoTaker, isShowAudioCall, isShowVideoCall, isShowMore, isShowSendButton, enableMention, enableReadReceipt, enableTyping })` 是真实可传给底层 `MessageInput({ conversationID, config })` 的配置；`isShowPhotoTaker` 同时影响拍照/录像，不能当成独立开关；`MessageInput` 会在 `aboutToAppear` 采用配置。`ChatPage.ets` 当前内部 new config 只设置 typing 和红点，顶层 `ChatPage` 无公开 `messageInputConfig` 参数。`MessageInputActionIDs` 是内置菜单/红点标识，`moreActionRedDotIDs` 和 `onMoreActionRedDotTap` 仅处理红点，**不是新增菜单 action API**。
- 仅当客户集成后明确不要 Call，才能按[集成的完整移除流程](integration.md#明确不需要-call-时)连同设置页入口、CallKit 依赖和事件桥一起处理；单独设置 `isShowAudioCall/isShowVideoCall` 不足以移除全部通话入口。

底层组件中可核对的 ArkTS 形式（示意需在宿主真实组件中传入，不把此段误当 `ChatPage` 参数）：

```ts
MessageList({
  conversationID: conversationID,
  config: new ChatMessageListConfig({ messageActionStyle: 'popup', isSupportCopy: false }),
  customActions: [{ title: '查看消息 ID', action: (message: MessageInfo): void => { console.info(message.msgID); } }]
})
```

示例只演示当前消息长按的真实回调，业务逻辑应替换为宿主已有且可编译的操作，不在生产日志记录私密消息内容。`customActions` 用于消息长按；`ConversationList({ customActions: [{ title, action: (conversation: ConversationInfo) => ... }] })` 用于会话长按。严格 ArkTS 模式下从当前模块导出引入准确 `MessageInfo/ConversationInfo` 类型，避免随意 `any`、无类型动态对象或 Android 的 receiver DSL。长按动作要检查对象状态、权限、页面销毁和失败回滚；仅对本次触及的调用做异常检查。

## 自定义消息与摘要的真实边界

`atomic_x/src/main/ets/messagelist/cells/CustomMessageView.ets` 导出 `CustomMessageView`、`CustomMessageViewContent`、`parseCustomMessage`、`CUSTOM_BUSINESS_ID_TEXT_LINK`；读取 `CustomMessagePayload.customData`（或 `rawMessage.customElem.data`），解析 JSON `businessID/text/link`，**仅 `text_link` 显示文字和链接**，其他 `businessID` 显示“不支持的自定义消息”。`messagelist/ui/MessageItem.ets` 直接选 `CustomMessageView(context)`，没有注入任意 renderer 的参数；Android `MessageContentRenderer` / `MessageCellRenderer`、`setCustomMessageRenderer`、`MessageListMessageSummaryRegistry` 在此基线不存在。

- 若数据符合已支持的 `text_link`，可利用既有 UI，但接入方仍须校验 JSON、缺失字段及链接目标的安全性；现有解析可能把缺失字段呈现为空内容，点击时将原始链接直接作为 `Want.uri`，**没有内建协议/目标白名单**。来自不可信用户的链接须先在业务入口增加可信协议/目标校验或经单独授权补齐内部点击保护，不把既有 UI 宣传为已安全验证或通用 businessID 注册器。
- 新 `businessID` 的特殊 UI、整行替换或会话摘要需要**分别**检查接收消息视图、摘要路径、引用/转发和搜索；若公开入口不满足，给出 `CustomMessageView.ets`、`MessageItem.ets` 和关联摘要/输入位置的**独立源码修改方案**、升级差异、回退与校验，按[入口审批](../SKILL.md#结构化提问与等待所有业务文件共用)再授权。对未知 JSON 显式降级；切会话/滚动复用时完整刷新 UI，离开后取消异步任务，主线程不做重 IO。
- 底层 `MessageInput` 当前更多菜单内置 `MessageInputActionIDs.CUSTOM_MESSAGE`，但 `sendTextLinkCustomMessage()` 写死了示例文字和链接，不能当成可配置的业务 `text_link` 发送入口；**没有** Android 的 `ChatMessageInputConfig.customizeActions`。业务新菜单可先在宿主外层提供入口并使用已核对的数据层发送能力；若必须放进“更多”，单独修改 `messageinput/components/MessageInput.ets` 及相关菜单组件并重新授权。不要把红点回调伪造成点击自定义业务 action。

## 方案与验收

文件级方案说明：宿主最终使用的页面层级、公开参数与消费证据、业务消息格式、UI 桥接/内部修改的界限、会话摘要、生命周期、权限、主题和窗口安全区、受影响文件及源码升级成本、构建与客户复验。授权后只改必要文件，使用当前工程 ohpm/hvigor/DevEco 构建或静态检查，不主动启动 App/模拟器。请客户验证目标消息与默认消息、发送中/失败、滚动复用、会话摘要、明暗主题、输入栏键盘、action 出现条件；未实现的 Android 同等扩展点须明确标为“需改内部源码”，不能报告为已接入。
