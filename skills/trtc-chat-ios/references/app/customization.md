# 命令式 UIKit 自定义

## 配置优先，先找消费者

本页用于 App 侧公开扩展；用户已要求改组件实现时，先进入 [源码任务索引](../source/index.md)，无需通读本页。读取 [API 地图](../shared/api-map.md) 中定义、Defaults 和 impl 消费路径。先使用公开配置，不能把 Android 的 renderer、DSL、`ThemeStore` 或 `setup(...)` 套到 iOS。页面创建后修改原配置不保证已有 UI 重绘。

| 目标 | 实际入口 | 注意 |
| --- | --- | --- |
| 头像、时间、气泡、消息过滤、长按能力 | `ChatMessageListConfig` | 传入 `ChatPage.messageListConfig` 构造参数 |
| 录音、拍照、更多、表情、通话、typing/ASR | `ChatMessageInputConfig` | 传入 `ChatPage.messageInputConfig` 构造参数 |
| 会话动作 | `ConversationActionConfig` | 传入 `ConversationsPage(config:)`，不是会话 cell builder |
| 联系人顶部入口/搜索 | `ContactListConfig` | 传入 `ContactsPage(config:)`，不是好友 cell builder |
| 单群聊设置行 | `C2CChatSettingConfig` / `GroupChatSettingConfig` | 传给对应设置控制器；true 仍受权限规则约束 |
| 自定义消息 | `MessageListView.registerCustomMessageCell` | 静态注册公开，但实例业务构造器不公开 |
| 全局主题/语言 | `ThemeState` / `LanguageHelper` | 先读副作用与刷新边界 |

## 功能开关

```swift
let input = ChatMessageInputConfig(
    isShowAudioRecorder: false,
    isShowVideoCall: false,
    isShowAudioCall: false,
    actionCustomizer: { editor in
        editor.remove(MessageInputActionIDs.file)
    }
)
let messages = ChatMessageListConfig(
    isShowRightAvatar: true,
    isSupportForward: false,
    isSupportTranslate: false
)
let page = ChatPage(
    conversation: conversation,
    messageListConfig: messages,
    messageInputConfig: input,
    isShowMoreButton: false
)
```

此片段在已有 `ConversationInfo` 的宿主方法中使用，并完成 VC 承载。`isShowRightAvatar: true` 特意保留 ChatPage 默认外观；显式空 list config 的右头像默认是 false。

- `isShowMoreButton` 是聊天标题栏更多按钮，`input.isShowMore` 是输入栏更多面板，两者不同。
- `actionCustomizer` 只改更多面板项，录音/表情/更多工具按钮用各自开关。
- 去掉 Call 需同时设置 C2C 设置页 `isShowVoiceCall` / `isShowVideoCall`，检查宿主其他入口。
- 开关是否公开先看当前版本定义：开发基线有 `enableRealtimeVoiceToText`，发布Pod较旧时可能没有，不能凭同模块名直接传。关闭录音工具不必然关闭其他业务自行启动的录音。
- `isSupportForward: false` 是隐藏该入口，不等于服务端禁止转发；不要声称它提供安全访问控制。

## 气泡

```swift
let messages = ChatMessageListConfig(
    isShowRightAvatar: true,
    ownBubbleAppearance: MessageBubbleAppearance(
        background: .color(.systemBlue),
        cornerRadius: MessageBubbleCornerRadius(
            topLeft: 12, topRight: 12, bottomLeft: 12, bottomRight: 4
        )
    )
)
```

用 UIKit `UIColor`、`UIEdgeInsets` 等公开类型，不引用 internal 设计 token。当前解析为：`.twoSided` 选择 own/incoming；固定 left 或 right 对齐选择对应 left/right appearance；选中项的字段再覆盖 default。不是永远按“default → left/right → own/incoming”连续覆盖。

浅色/深色、自己/对方、对齐模式、语音/图片/自定义消息都要验证；图层 CGColor、固定图片或自定义内容可能需要额外刷新。

## 自定义消息完整链路

采用 [CustomMessage.swift](../examples/CustomMessage.swift) 中的真实接口：

1. 定义稳定命名空间 `businessID` 与 payload 版本，JSON 编码而不是拼接。
2. 创建页面前一次注册 `MessageListView.registerCustomMessageCell(businessID:summaryProvider:makeContentView:)`。
3. 内容 View 遵循 `MessageContentView`，实现 `bind(message:context:)`。每次绑定重置状态、文本和交互；解析失败展示降级内容。
4. 通过 `MessageInputStore.create(conversationID:)` 和 `.sendMessage(payload: .custom(...), option:completion:)` 发送，处理失败；store 放在持有者上。
5. 发送用 `CustomSendMessagePayload`，接收/摘要用 `CustomMessagePayload`；两者不要混用。`customData` 是 String，不是 Data。
6. 附带摘要，验证会话预览、引用与转发；仅需补摘要时使用 `registerCustomMessageSummary(matcher:)`。

内容视图只接管消息内容区，复用组件布局。不要声称存在公开任意整行 cell builder；若必须改头像、状态、多选整行逻辑，另做 UI 源码方案。

**文字色必须匹配实际背景，不按isSelf盲选token。** `textColorAntiPrimary` 不是保证为白色或自动反色的API，客户发布版本的深浅两套值均可为深色。模板保留默认气泡背景并使用主文字色；如果业务内容自己设置了深色/品牌色卡片背景，对该背景显式选择可读文字（例如深色底用白色，次级文字可用半透明白），并回归对比度。浅色背景不能一律白字，也不能仅凭自己发送就判断背景深浅。

公开 `MessageContentContext` 可用 `isLeft`、`isSelf`、`isGroupChat`、`isMultiSelectMode`；不能访问 internal `config`、`messageListStore` 或 `onMediaTap`。协议没有 `onViewRecycled` 等 Android 生命周期回调，异步操作在重新 bind、离开窗口或销毁时自行取消并防止旧结果污染。

内置通话、机器人和系统消息可能优先匹配；不占用保留 businessID。业务链接先校验 URL；订单/卡片内容不能替代服务端鉴权。

## 菜单与自定义行

### 输入栏更多

```swift
let input = ChatMessageInputConfig(actionCustomizer: { editor in
    editor.add(MessageInputMenuAction(
        ID: "app.input.order",
        title: NSLocalizedString("SendOrder", comment: ""),
        iconName: "",
        icon: UIImage(systemName: "shippingbox"),
        onClick: openOrderPicker
    ))
})
```

`openOrderPicker` 是宿主提供的 `() -> Void`，不是 kit 方法。持有者避免循环引用。

- iOS customizer 为 `{ editor in ... }`，不是 Android receiver DSL。
- `CustomEditor` 支持 add/remove/replace/insertBefore/insertAfter/moveBefore/moveAfter/clear；调用端负责 build。
- ID 必须非空且唯一，replace 保持旧 ID；锚点不存在时不会插入。
- 公开 `MessageInputActionIDs` 包含 album/takePhoto/recordVideo/file/videoCall/audioCall。
- 消息长按的 `MessageActionIDs`、会话的 `ConversationActionIDs` 是 internal；禁止从 App 引用。禁用内置动作优先 Config 开关。

### 消息与会话动作

消息长按用 `ChatMessageListConfig.actionCustomizer` 加 `MessageActionMenuAction(ID:iconName:systemIconFallback:label:handler:)`，handler 收到 `MessageInfo` 和 `MessageActionStore`；显式设非空 ID，不依赖默认空字符串。

会话用 `ConversationActionConfig.actionCustomizer` 加 `ConversationCustomAction(ID:title:dangerous:action:)`；当前入口是侧滑/更多，不能按 Android 文档承诺长按。

联系人顶部用 `ContactListConfig.itemCustomizer` 加 `ContactCustomItem`；只改顶部入口，不能借它替换 AZ 列表中的每个联系人。

### 设置页行

设置页使用另一类 `ChatSettingItemEditor<Section>`，公开能力为 `addCustomRow(_:after:)`，没有 remove/replace。通过 Config 隐藏内置项，自定义 UIView 自己提供高度和布局。

```swift
let config = GroupChatSettingConfig(
    isShowDoNotDisturb: true,
    itemCustomizer: { editor in
        let label = UILabel()
        label.text = NSLocalizedString("GroupHelp", comment: "")
        label.numberOfLines = 0
        label.heightAnchor.constraint(greaterThanOrEqualToConstant: 44).isActive = true
        editor.addCustomRow(label, after: .settings)
    }
)
```

配置传给 `GroupChatSettingViewController(groupID:config:)`。C2C sections 有 header/remark/switches/background/blacklist/actions/end；Group 有 header/memberPreview/settings/alias/switches/background/actions/end。不使用 Android 的 `ChatSettingCustomItem`。

## 主题与语言

调用公开 setter 而非直接改内部缓存：

```swift
ThemeState.shared.setThemeMode(.dark)
ThemeState.shared.setPrimaryColor("#1C66E5")
LanguageHelper.saveLanguage("ar")
LanguageHelper.applyLayoutDirection(to: hostView)
```

`hostView` 是宿主视图。恢复系统主题用 `.system`，恢复品牌色用 `clearPrimaryColor()`。颜色读取 `TUIChatKitTheme.colors`；不引用 internal `FontScheme`、`RadiusScheme`、`SpacingScheme` 或 Android `ThemeStore`。

语言资源在 `TUIChatKitBundle`；当前资源包括 en/zh-Hans/zh-Hant/ar。切换后重建对应页面或按消费路径刷新 label 和布局，不能承诺 `Bundle.main` 同名 key 自动覆盖 kit。`AppLanguageChangedNotification` 是 internal 常量。

自定义UISegmentedControl在深色或品牌底色上要分别验证.normal/.selected文字和selectedSegmentTintColor，以及局部appearance、父容器override样式。客户有“选中态黑字”复现，但这不证明所有系统/布局都无法配置。先做最小复现和显式样式；只有无法满足设计时才选自绘pill，并补齐选中语义、VoiceOver、键盘/焦点、Dynamic Type和RTL，不把替换控件当默认修复。

## appConfig.json

默认从 `Bundle.main` 自动加载；公开 `AppBuilderHelper.setJsonPath(path:)` 可指向宿主提供的文件。先核对读取时机，再创建页面。当前字段组为 theme、messageList、conversationList、messageInput、search、avatar。本轮客户发布Pod和开发源码读取 `theme.mode`、`theme.primaryColor`，不读取theme.themeMode；旧安装可能被持久化主题覆盖，验证步骤见 [主题源码指南](../source/modules/theme.md)。

已确认的例子：`conversationList.enableCreateConversation` 被会话页加号消费；`messageInput.hideSendButton` 被输入配置默认值读取。`search.hideSearch` 虽被解析，但基线中没找到对应 UI 消费，不能承诺有效。联系人搜索使用 `ContactListConfig(showSearchBar: false)`；`ConversationsPage(showSearchBar:)`、`ContactsPage(showAddButton:)` 不存在。
