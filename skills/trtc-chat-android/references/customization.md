# Chat UI 自定义

## 平台与 UI 版本分流

- Android 客户明确选择 View 或 Compose 版 Chat UI 时按其选择处理；未指定时默认 View 版。
- Chat UI 与宿主技术栈相匹配通常更易维护，但不是强制条件。宿主与 Chat UI 不一致时，先确认互操作容器，再使用所选 Chat UI 版本的自定义 API。
- 选择 View 版时直接使用本文 Android View 参考，并以客户当前源码校准；选择 Compose 版时按 Compose 官方文档和客户源码处理。
- iOS、Flutter、uni-app 等：先说明没有该平台的内置 API 基线，并按主 `SKILL.md` 的“结构化提问与等待”询问是否继续；客户确认后，从[全功能接入](https://cloud.tencent.com/document/product/269/79075)找到匹配的自定义或组件文档，再继续方案与授权流程。

## 先判断类型

按最小影响面选择：

1. 内置功能项或视觉参数 → 配置
2. 只替换自定义消息内容 → content renderer
3. 必须接管整行布局 → cell renderer
4. 增加业务入口 → 对应 action 或 item customizer
5. 官方扩展点仍不能满足 → 单独提出内部源码修改方案并重新授权

不要为颜色、间距、开关或一个菜单项重写列表和输入栏。

## 源码核对

修改前在客户工程确认：

- 实际引用本地 TUIKit Chat 源码时，只在当前工程和构建配置实际引用路径内按 [集成](integration.md#本地-tuikit-chat-源码版本核对) 完成 GitHub 最新版本核对，并在源码不完全一致或无法确认时取得客户的版本选择
- 配置类和协议的真实名称、构造方式、默认值
- 页面 `setup(...)` 是否接收并消费该配置
- 全局配置、页面配置和主题状态的覆盖关系
- renderer/action 类型、回调参数、内置 ID 和生命周期方法
- 当前版本是否已有相同业务扩展

只有字段存在不代表 UI 已消费。必须顺着页面、ViewModel、factory 或 binder 找到消费位置。

## 选择 Android Compose 版 UI

1. 从 [Android Compose 全功能接入](https://cloud.tencent.com/document/product/269/125127)进入目标组件文档，确认当前版本公开的参数、配置协议、`Modifier`、回调和扩展点。
2. 在客户引入的 Compose 源码中沿组件、状态和数据层找到配置消费位置；只看到参数或接口声明不能证明 UI 已消费。
3. 优先使用现有配置、`Modifier`、组件参数和公开回调；公开扩展点不能满足时，再单独提出源码修改方案和升级成本。
4. 自定义消息、菜单或异步内容必须处理重组、状态保存、页面离开后的回调和资源释放。
5. 宿主是 View 时可通过 Compose 互操作容器承载，但不能因此套用 View 版 Chat UI 的配置类或 renderer。

## 选择 Android View 版 UI

以下 API 由所选 Chat UI 版本决定；宿主可以是 View，也可以是通过 Android 互操作容器承载这些组件的 Compose 页面。

### 常见配置入口

当前 Android View 源码常见入口如下，使用前仍须核对客户版本：

- `ChatMessageListConfig`：布局、背景、头像、昵称、时间、气泡、消息过滤、已读展示、typing、自定义消息和消息长按操作
- `ChatMessageInputConfig`：语音、拍照/录像、音视频、更多、表情、@、长按说话、录音时长及“更多”面板 action
- `ChatConversationActionConfig`：删除、免打扰、置顶、标记未读、清空历史及会话 action
- `ChatContactListConfig`：新联系人、群申请、我的群组、黑名单、搜索及联系人自定义项
- `C2CChatSettingConfig` / `GroupChatSettingConfig`：单聊、群聊设置页的功能显隐和自定义条目
- `AppBuilderConfig` / `ThemeStore`：实际版本支持的全局配置和主题状态

优先把页面级配置传入对应页面或 View 的 `setup(...)`，不要假设 assets 配置能覆盖气泡等页面参数。

`customizeActions` 和 `customizeItems` 都是 receiver DSL，应在代码块内直接调用 `add`、`remove`、`replace`、`insertBefore`、`insertAfter`、`moveBefore`、`moveAfter` 或 `clear`，并通过 `editorContext` 读取当前上下文；不要写成旧式 `{ editor -> ... }`。

当前 View 源码中 `AppBuilderConfig.hideSendButton`、`hideSearch`、`enableCreateConversation` 只有定义和 assets 解析，没有对应 UI 消费，不能当作有效开关。搜索入口应使用 `ConversationsPageView.setup(showSearchBar = ...)` 或 `ChatContactListConfig.showSearchBar`。

### 气泡颜色与外观

先在源码确认 `MessageBubbleAppearance` 和 `MessageBubbleBackground`。常见覆盖顺序为：

默认气泡 → 左/右位置 → 自己/对方

后者只覆盖已设置的同名属性。自己/对方通常高于左/右；自定义 renderer 选择非默认 bubble style 时可能不使用这些外观。

```kotlin
val messageListConfig = ChatMessageListConfig().apply {
    setOwnBubbleAppearance(
        MessageBubbleAppearance(
            background = MessageBubbleBackground.Color(0xFFFF6600.toInt())
        )
    )
}
```

需要分别确认自己、对方、左侧和右侧场景。`MessageBubbleBackground.Color` 是固定色，不会自动适配浅色/深色；需要跟随主题时，从 `ThemeStore` 当前 token 生成页面配置并在主题变化后更新。

### 功能项

隐藏入口前同时判断：

- 它是页面配置、全局默认还是动态 action 列表
- 隐藏 UI 是否仍保留底层能力和权限
- 音视频入口是否来自 Chat UI、宿主 App 或 Call 能力
- 禁用内置 action 后是否需要替代业务入口

`ChatMessageInputConfig.customizeActions` 只修改“更多”面板，不修改工具栏的语音、表情和更多按钮；这些按钮分别由 `isShowAudioRecorder`、`isShowEmoji`、`isShowMore` 控制。`isShowPhotoTaker = false` 会同时移除拍照和录像入口。

Android Chat 默认集成 CallKit 并保留语音/视频通话入口。只有客户完成集成后明确不需要 Call 时，才把 `ChatMessageInputConfig.isShowAudioCall`、`isShowVideoCall` 和 `C2CChatSettingConfig.isShowVoiceCall`、`isShowVideoCall` 全部设为 `false`，并同时按 [集成](integration.md) 删除 CallKit 依赖与初始化。

`ChatContactListConfig.customizeItems` 只修改联系人页顶部的新联系人、群申请、我的群组和黑名单入口，不修改 AZ 联系人列表中的联系人行。

### 自定义消息

优先 content renderer，以复用默认头像、昵称、时间、气泡、长按、多选和回收逻辑：

```kotlin
ChatMessageListConfig().setCustomMessageRenderer(
    businessID = "order",
    renderer = orderRenderer,
    priority = 0,
    summaryProvider = orderSummaryProvider,
)

MessageListMessageSummaryRegistry.setCustomMessageSummary(
    businessID = "order",
    summaryProvider = orderSummaryProvider,
)
```

`orderRenderer` 必须实现当前 `MessageContentRenderer`：`createView(context, parent)`、`bindView(view, MessageRenderContext)` 和可选的 `onViewRecycled(view)`。整行接管则实现 `MessageCellRenderer`，它还提供 `onViewDetachedFromWindow(view)`。

实现前核对当前签名和以下规则：

- 自定义消息 data 中有稳定的 `businessID` 或 matcher
- `setCustomMessageRenderer` 按自定义消息 JSON 顶层 `businessID` 匹配；复杂规则使用 `addCustomMessageRenderer(matcher, ...)`
- 同类规则按 `priority` 从高到低匹配，先匹配先使用；cell renderer 优先于 content renderer
- 解析失败有明确降级，不假设 JSON 永远合法
- `bindView` 每次完整重绑文本、图片、状态和监听
- 回收时取消图片、动画、播放器、协程和监听
- matcher 不做网络请求或重 IO
- 页面配置中的 `summaryProvider` 用于引用、转发等当前聊天页摘要；会话列表不读取页面配置，必须另行注册全局 `MessageListMessageSummaryRegistry`

只有内容 renderer 无法满足整行布局时才使用 cell renderer。整行接管后，头像、时间、状态、多选、长按、无障碍和复用通常都要自行负责。

### Action 与菜单

根据目标使用当前源码中的真实扩展点：

- 消息长按：`ChatMessageListConfig.customizeActions`
- 会话长按：`ChatConversationActionConfig.customizeActions`
- 输入栏更多：`ChatMessageInputConfig.customizeActions`
- 联系人入口：`ChatContactListConfig.customizeItems`
- 单聊设置页：`C2CChatSettingConfig.customizeItems`
- 群聊设置页：`GroupChatSettingConfig.customizeItems`

聊天设置页通过 `ChatSettingCustomItem` 增加条目，通过 `ChatSettingItemIDs` 操作内置项，通过 `ChatSettingSectionIDs` 把条目放入现有分区。配置必须传给 `C2CChatSettingView.setup(..., config = ...)` 或 `GroupChatSettingView.setup(..., config = ...)`。

```kotlin
val config = C2CChatSettingConfig().customizeItems {
    add(
        ChatSettingCustomItem(
            ID = "biz.report",
            sectionID = ChatSettingSectionIDs.C2C_ACTIONS,
        ) { itemContext ->
            SettingRowButton(itemContext.androidContext).apply {
                setTitle("举报")
                setOnClickListener { openReportPage(itemContext.androidContext) }
            }
        }
    )
}

c2cChatSettingView.setup(userID = userID, config = config)
```

群聊使用 `GroupChatSettingConfig` 和 `ChatSettingSectionIDs.GROUP_ACTIONS`。内置条目还可直接通过 `isShow...` 字段隐藏；自定义项 ID 必须非空且唯一，`replace` 必须保留原 ID。同一 `sectionID` 的相邻条目会渲染在同一分区。

机器人会话由 `ChatPageView` 应用专用配置：消息长按 customizer 会被清空，输入栏“更多”面板会隐藏，因此不要承诺机器人会话中这些自定义 action 可见。

操作前检查消息状态、会话类型、登录态、权限和页面生命周期。危险操作要有确认与失败回滚。

## iOS、Flutter、uni-app 等平台

1. 客户确认继续后，先确定目标 UI 套件、框架版本和目标端，再选择对应官网文档。
2. 只使用文档和客户源码中真实存在的主题、组件参数、回调、renderer 或扩展机制；名称相似也不能从 Android 推断。
3. 官网未提供目标扩展点时，说明限制，并在“宿主层实现”“修改开源 UI 源码”“调整需求”之间给出最小影响方案。
4. 仍需输出文件级方案并取得写入授权；确认后可以直接协助修改，不因平台不同而拒绝。

## 方案、实施与验证

先输出文件级方案，并在同一回合按主 `SKILL.md` 的“结构化提问与等待”发起明确授权；不得默默停止。方案应列出配置消费证据、扩展点、业务数据、权限、生命周期和验证方式。

授权后只改必要文件，并执行当前平台可行的构建或静态检查，不启动 App 或模拟器。自动检查本次触及的 SDK 调用；客户重点验证：

- 配置只影响目标页面和目标消息
- 默认消息、会话和输入能力不回归
- 列表滚动复用、发送中/成功/失败、浅色/深色正常
- 自定义 action 在正确条件出现，失败不会留下错误 UI 状态
