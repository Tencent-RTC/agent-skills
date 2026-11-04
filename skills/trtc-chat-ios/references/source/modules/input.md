# 输入、发送与录音转文字

## 何时读取

输入工具栏/更多面板、发送按钮、@/引用、输入高度和草稿、媒体发送、录音转文字取消/收尾时读。只改菜单不先深入整个ASR会话层。

## 首读（相对 U）

| 文件 | 符号/职责 |
| --- | --- |
| `components/messageinput/view/MessageInputViewImpl.swift` | requestSendText、layoutActionButtons、handleKeyboardWillShow/Hide、syncBottomAreaHeight |
| `components/messageinput/view/MessageInputMorePanel.swift` | setupActions、didSelectItemAt；过滤/customizer与点击真实消费 |
| `components/messageinput/viewmodel/MessageInputViewModel.swift` | sendTextMessage、createSendMessageOption、handleSendResult、load/saveDraft |
| `components/messageinput/config/MessageInputConfig+Defaults.swift` | 公开init、getter与内置功能默认 |

录音任务首读换成MediaCoordinator、`components/messageinput/asr/RealtimeAsrRecognizer.swift`、`components/ai/impl/asr/RealtimeASRImpl.swift`。业务发送从门面到实际view/coordinator接线取证，不把MessageInputActions里定义动作就当成发送已实现。

## 调用链

ChatPageImpl传入ChatMessageInputConfig → 输入门面/内部UI创建按钮和面板 → 点击/输入/手势事件 → coordinator/输入Store生成payload并发送 → completion与状态更新回到UI。录音是独立采集生命周期，并非每次松手都发送同一种消息。

实时识别链：录音交互 → RealtimeAsrRecognizer的prime/beginRecognize/finish/cancel → RealtimeASR封装/Impl → 会话与音频引擎 → 文本/停止/错误回调。创建会话前缓冲、段落文本更新、停止尾包和取消不是同一动作；先查已有实现再增补状态。

## 修改配方

### 按钮/更多动作

工具栏录音、emoji、更多按钮由各自config开关控制；更多项由action list构建和customizer修改。区分 `ChatPage.isShowMoreButton`（标题栏）与 `ChatMessageInputConfig.isShowMore`（输入面板）。

先读 `view/MessageInputMorePanel.swift.setupActions` 的内置过滤与customizer顺序、`collectionView(_:didSelectItemAt:)` 的执行；内置点击经 `MessageInputViewImpl.morePanelDidSelectFile/Album/Camera/...` 转媒体coordinator。工具栏显隐/布局查 `layoutActionButtons`，文本点击入口为 `requestSendText`。需要改ID/协议才读 `components/messageinput/MessageInputActions.swift`。CustomEditor里ID非空唯一，replace保留ID，anchor不存在不会插入；iOS是editor参数闭包，不是Android receiver DSL。新增按钮同时接业务handler并回归禁用条件。

关闭Call只改输入按钮不影响历史通话消息重拨和群通话横幅；完全移除需额外检查，不在输入层造空handler。

### 新输入配置/发送策略

先改MessageInputConfig存储、public init/getter，再检查同目录internal protocol/conformance及真正消费者；新增JSON缺省才另读AppBuilderHelper。用户显式配置优先级和旧缺省不得被意外覆盖。

普通发送链查payload、conversationID、SendMessageOption和completion；自定义发送的needReadReceipt需要沿用配置，不能忘记复制选项。@对象、引用目标、文本草稿、发送按钮使能是一组状态，不能只改最后调用sendMessage的一行。

相册是明确的独立旁路：`components/messageinput/albumpickercoordinator/AlbumPickerMediaSendCoordinator.swift` 及 `+Media.swift` 中的AlbumPickerSendSession自行持有Core inputStore，走 `sendOnce/sendMedia/makeSendOption`，不经过普通MessageInputViewModel。改回执/发送选项需同时核对此路径；相册确认后处理/占位/发送会跨页面自持，不能套用录音离页立即取消的清理策略。

当前文本发送时立即清输入、引用和草稿，失败不自动恢复；如需求要求失败恢复，须新增可信的发送上下文和恢复策略，不能把它写成当前已有能力。

### 多行输入/键盘/更多面板高度

在 `MessageInputViewImpl` 按 `intrinsicContentSize` → `syncBottomAreaHeight` → `showMorePanel/hideMorePanel` → `handleKeyboardWillShow/Hide` 读取对应区间，再联动ChatPageImpl与消息列表可见区域。引用条查 `setQuoteMessage/clearQuote`；草稿查 `saveDraftWithDebounce/loadDraft`，发送选项与结果在ViewModel的 `createSendMessageOption/handleSendResult`。区分键盘高度、安全区和自定义面板高度；切换时唯一负责人调整约束，不在宿主与组件重复加inset。历史阅读与发送后跟随策略不同，必要时读navigation。

当前主输入面板的 `animateLayout` 使用固定0.2秒，并不读取键盘通知duration；转写overlay才读取系统动画参数。不要照旧记忆断言主输入条已与系统键盘时长自动同步。

### 录音取消、收尾和迟到回调

1. 先记录实际模式：发原录音、实时转文字、非实时转换；同时查看enableRealtimeVoiceToText、enableSendRecordedVoice、enableLongPressToTalk。
2. 在 `MessageInputMediaCoordinator` 读 `beginVoiceRecording/updateVoiceRecording/endVoiceRecording/cancelVoiceRecording`；完成结果进入 `handleVoiceRecordingComplete`，再按模式分到 `openVoiceTranscriptionDraft/runWholeFileTranscription/transcribeAndSendText`。实时识别创建/取消分别看 `primeRealtimeRecognizer/cancelRealtimeRecognizer`，随后才追Recognizer的prime/begin/finish/cancel。
3. 检查结束和取消是否共享了不该共享的发送分支；取消后启动成功/最终文本迟到时，需以当前轮次/会话状态拒绝旧结果。
4. 先核对coordinator的 `recordingID/voiceGeneration/finishingRecognizer`；已有generation/restart/drain逻辑时不并排创建第二套状态机。手势命中再读 `view/MessageInputAudioRecorderView.swift` 的AudioRecorderGesturePolicy，转写后编辑/发送读 `view/VoiceTranscriptionOverlayView.swift`。只有识别会话问题才下钻ASR Impl及Session/AudioEngine。
5. 退出页面、后台、权限拒绝、采集失败和网络启动失败都清理对应资源，失败不静默发送空内容。

修改识别逻辑时分清句子覆盖与最终化，不把增量文本每次append。服务端时限/语言支持以匹配SDK/服务文档为准，UI默认配置和本地timeout不构成服务保证。

## 不变量

正确conversationID与登录态；每次交互至多一次业务发送；取消不发送；旧轮次回调不污染新录音；发送失败保留错误，是否新增草稿恢复按需求决定，不误称现有自动恢复；采集/订阅/计时器不泄漏。隐藏入口与禁用能力/授权不同，麦克风权限和服务开通单独核对。

## 最小回归

空文本/长文本/多行、输入法组合、@取消/选择、引用发送与取消、菜单编辑/内置项、单群聊/特殊机器人配置。录音短按/长按/上滑取消、实时与非实时、原录音开关、连续两次、启动未完成就取消、finish期间再开始、切页/后台/权限拒绝/断网。检查取消后的零发送、无重复发送、文本和音频属于当前轮次。

列表可见区与键盘联动看 [导航模块](navigation.md)；消息显示/引用摘要看 [消息模块](messages.md)；新增API链看 [变更配方](../workflow.md)。
