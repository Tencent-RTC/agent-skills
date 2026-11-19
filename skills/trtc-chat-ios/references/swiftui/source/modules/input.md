# 声明式输入、发送与录音

## 何时读取

输入工具栏、更多/表情面板、发送按钮、@/引用/草稿、输入高度与键盘、媒体发送、通话入口、录音与转写取消/收尾时读。只改菜单不先读录音与转写。

## 首读（相对 U）

| 文件 | 符号/职责 |
| --- | --- |
| `components/messageinput/impl/core/MessageInputContentView.swift` | 工具栏、`morePanelActions`、面板高度 `visiblePanelHeight` / `morePanelHeight`、键盘订阅、子页 sheet |
| `components/messageinput/impl/core/MessageInputContentView+Interactions.swift` | `sendTextMessage`、`toggleMorePanel`、`showEmojiPicker`、`showKeyboard`、`postInputInteract`、录音手势 |
| `components/messageinput/impl/core/MessageInputManager.swift` | `sendTextMessage` 等发送、`createSendMessageOption`、离线推送信息、`handleSendResult` |
| `components/messageinput/config/ChatMessageInputConfig+Defaults.swift` | 公开 init、各开关缺省 |

录音任务首读换成 `impl/core/MessageInputImpl.swift`（录音与转写控制器、窗口浮层）、`impl/voice/VoiceInputRecordController.swift`、`impl/voice/VoiceTranscriptionView.swift`（`VoiceTranscriptionController`）、`components/audiorecorder/impl/AudioRecorderImpl.swift`。

## 调用链

`ChatPageImpl` 传入 `ChatMessageInputConfig` → `MessageInputView` → `MessageInputImpl`（创建 `MessageInputStore`、`MessageInputManager`、录音控制器，环境值 `messageInputConfig`）→ `MessageInputContentView`（`@State` 管理面板/焦点/引用/@，`TextEditorState` 桥接 `MessageInputTextEditor` 中的 `UITextView`）→ 点击/输入事件 → `MessageInputManager.send*` → `MessageInputStore.sendMessage` → 结果与失败通知回到 UI。

面板互斥：显示表情、更多、语音模式或弹出键盘时互相关闭，并调用 `postInputInteract()` 发出 `MessageInputView.didInteractNotification`；消息列表据此滚动到底部（发布版 9.1.7821 不会同时关闭长按菜单，开发源码已补）。键盘高度来自 `KeyboardHandler`（`basecomponent/impl/KeyboardHandlerImpl.swift`），`didShowPublisher` 触发时收起面板。

## 修改配方

### 按钮与更多面板

工具栏按钮由 `isShowAudioRecorder`、`isShowEmoji`、`isShowMore`、发送按钮开关控制。更多项在 `morePanelActions` 中按顺序构建：相册 → 拍照/录像（`isShowPhotoTaker`）→ 文件 → 视频/语音通话（两个通话开关）→ `actionCustomizer` 编辑 → `build()`。面板绘制与外观在 `impl/views/MessageInputMorePanelView.swift`，红点关闭状态在 `dismissedMorePanelRedDotIDs`。新增内置项要给公开 ID（`MessageInputActionIDs`）、标题/图标资源和真实处理，并回归 customizer 的 remove/replace。

通话入口在 `startCall`：单聊直接 `ChatCallEventPublisher.publishStartCall`，群聊先弹 `impl/calls/GroupCallMemberPickerView.swift` 选人。关闭通话按钮不影响历史通话消息与群通话横幅。

### 发送、引用、@ 与草稿

文本发送在 `+Interactions.swift` 的 `sendTextMessage`：取 `getSendText()`、`mentionList`、`quotedMessage`，调 `MessageInputManager.sendTextMessage`，随后清空输入、引用与草稿。`createSendMessageOption` 决定 `needReadReceipt`（读 `enableReadReceipt`）与离线推送；自定义发送需自行复制这些选项。引用设置在 `setQuoteMessage` / `clearQuote`（由 `quoteMessageNotification` 触发），预览条在 `impl/views/MessageInputQuotePreviewBar.swift`。@ 在 `+MentionsAndDraft.swift` 的 `insertMentions`、`findMentionToDelete`、`getSendText`，选人页 `impl/mentions/MentionMemberPicker.swift`。草稿在 `saveDraftWithDebounce` / `saveDraftImmediately` / `loadDraft`。正在输入在 `impl/mentions/TypingIndicatorController*.swift`。

媒体：相册走 `impl/attachments/MessageInputAlbumPicker.swift`，拍照/录像走 `VideoRecorderView`，文件走 `FilePicker`，均经 `saveAndSendImage` / `createThumbnailAndSendVideo` / `handleFileSelection` 进入 `MessageInputManager`。当前发送失败不自动恢复输入内容；需要恢复时新增可信的发送上下文，不要声称已有。

### 输入高度、键盘与面板

输入框高度来自 `TextEditorState.height` → `textHeight`；整体高度看 `totalInputAreaHeight`、`visiblePanelHeight`、`keyboardFillHeight`。`ChatPageImpl` 对整页 `.ignoresSafeArea(.keyboard)` 并自行补安全区，键盘占位由输入组件负责，宿主不要再叠加键盘 inset。面板与键盘切换动画用 `keyboardHandler.keyboardAnimation`；改高度要联动消息列表底部可见区与“滚到底部”策略。

### 录音、转写与取消

1. 先确认模式：长按说话（`enableLongPressToTalk`）、语音模式切换（`toggleVoiceInputMode`）、录完转写编辑。
2. 手势在 `+Interactions.swift` 的 `beginVoiceRecordingFromGesture` / `voicePressBegan` / `voicePressChanged` / `voicePressEnded`；开始有 0.1 秒延迟的 `voiceBeginWorkItem`，快速松手要能取消尚未开始的录音。
3. 状态机在 `VoiceInputRecordController`：`beginRecording` → `updateZone`（上滑取消/转文字区域）→ `endRecording` / `forceCancel` → `handleRecordComplete` 产出 `VoiceRecordOutcome`，再由 `handleVoiceRecordOutcome` 决定发送语音或进入转写。最长时长来自 `audioMaxRecordDurationMs`。
4. 录音与转写浮层由 `MessageInputImpl` 通过 `WindowOverlayPresenter` 显示在窗口上，需注入 `ThemeState`，结束时 `dismiss()`。转写、翻译、朗读在 `VoiceTranscriptionController`，取消要停止播放并丢弃迟到结果。
5. 离页、后台、权限拒绝（`checkMicrophonePermission`）、采集失败都要清理，失败不发送空内容。

## 不变量

正确 `conversationID` 与登录态；每次交互至多一次业务发送；取消不发送；旧轮次回调不污染新录音；面板/键盘/语音模式互斥且只有一个高度负责人；交互通知仍会发出，保证列表滚动（及开发源码中的菜单关闭）。隐藏入口不等于禁用能力。

## 最小回归

空/长/多行文本、输入法组合、表情插入与删除、@选择与删除、引用发送与取消、草稿离开再进入；更多面板内置项与自定义项、红点；单聊/群聊通话入口；长按录音短按/上滑取消/转文字、连续两次、权限拒绝；键盘↔表情↔更多切换、页面返回再进入；打开长按菜单后点输入栏各按钮的菜单表现（发布版不关闭为已知问题）。

键盘与列表可见区转 [导航](navigation.md)；消息显示与引用摘要转 [消息](messages.md)；新增配置链转 [变更配方](../workflow.md)。
