# TRTC 屏幕分享诊断链路（Windows 为主）

> 将屏幕分享模块的日志关键字映射到模块、触发条件和因果链，分析屏幕分享黑屏/中断问题。

---

## 目录

- [1. 模块架构总览](#1-模块架构总览)
- [2. 关键日志关键字速查](#2-关键日志关键字速查)
- [3. 状态机定义](#3-状态机定义)
- [4. 生命周期与状态转换](#4-生命周期与状态转换)
- [5. 窗口事件检测机制（WinEventHook）](#5-窗口事件检测机制wineventhook)
- [6. 已知 Bug 模式与陷阱](#6-已知-bug-模式与陷阱)
- [7. 黑屏问题完整因果链](#7-黑屏问题完整因果链)
- [8. 标准分析路径](#8-标准分析路径)
- [9. 采集方案选择逻辑](#9-采集方案选择逻辑)

---

## 1. 模块架构总览

```
TRTC API 层
├── TRTCCloud::startScreenCapture()
│   └── TRTCPipelineVideo → SetCaptureParams(source_id) → StartScreenCapture()
TRTC Pipeline 层
├── TRTCScreenCapturer（trtc_screen_capturer.cc）
│   ├── Start() / Stop() / Pause() / Resume() / UpdateScreenParams()
│   └── IScreenSharing::Client 回调接收
Video 模块层（核心）
├── IScreenSharing → ScreenSharingImpl
│   └── ScreenSafeWrapper ⭐（screen_safe_wrapper.cc）
│       ├── status_: {kStopped, kStarted, kPaused}
│       ├── screen_capturer_: ScreenPlatformInterface (ScreenCaptureSessionWin)
│       ├── 异步队列: screen_capture_dispatch_queue_
│       └── 生命周期管理: Start/Stop/Pause/Resume/UpdateParams
Windows 平台层
├── ScreenCaptureSessionWin ⭐（screen_capture_session_win.cc）
│   ├── is_started_: bool（底层启动标志）
│   ├── capturer_: WindowCapturerController 或 ScreenCapturerController
│   ├── fps_trigger_: 定时触发采集
│   └── window_message_timer_: 窗口消息轮询
采集器层
├── WindowCapturerController（WinEventHook 窗口事件监听、全屏窗口检测）
├── ScreenCapturerController（全屏幕/显示器采集）
└── 底层采集方案：WGC / DXGI / GDI / Magnifier
```

**数据流链路（正常采集）**：
```
目标窗口/屏幕 → 底层采集方案抓帧 → Controller 分发 → ScreenCaptureSessionWin::Capture()
→ ScreenSafeWrapper::OnPixelFrameAvailable() → IPixelFrameTrackWriter::WriteFrame()
→ TRTCScreenCapturer 读轨道 → 视频编码器 → 上行通道 → 远端
```

**回调链路**：
```
Windows 系统事件 (WinEventHook) → WindowCapturerController::NotifyWindowEvent()
→ ScreenCaptureSessionWin 回调 → ScreenSafeWrapper 回调 → TRTCScreenCapturer 回调 → 业务层
```

---

## 2. 关键日志关键字速查

### ScreenSafeWrapper 层

| 日志关键字 | 级别 | 诊断意义 |
|-----------|------|---------|
| `Capture has already started` | WARNING | 重复 Start 被 status_==kStarted 拦截（正常防重入） |
| `Start new screen capture: config = ...` | INFO | ⭐ 采集真正开始的标志，config 含 type/id/framerate |
| `Update existed screen capture: config = ...` | INFO | 参数更新（不重建采集器） |
| `DoStop` | INFO | 采集停止，screen_capturer_ 将被销毁 |
| `Capture has not started` | WARNING | UpdateParams 在 Start 之前调用（异常） |
| `OnScreenSharingError: window_id = X, code = Y` | ERROR | ⭐ 采集错误，查 code |
| `OnScreenSharingStarted: window_id = X` | ERROR | ⭐ 采集器实际启动成功（status_ → kStarted） |
| `OnScreenSharingStopped: window_id = X, reason = Y` | ERROR | ⭐ 采集器停止（查 reason） |
| `OnScreenSharingPaused: window_id = X, reason = Y = Z` | ERROR | ⭐⭐ 采集暂停，注意后续是否有 Stop/Resume |
| `OnScreenSharingResumed: window_id = X, reason = Y = Z` | ERROR | 从暂停恢复 |
| `Screen capture first frame: window_id = X, first_frame_cost_time_ms = Y` | INFO | ⭐ 产出第一帧（cost_time = 启动到首帧耗时） |
| `OnWindowCovered: window_id = X` | ERROR | 窗口被遮挡 |
| `StatusInfo:...` | INFO | 周期性状态快照（帧率、尺寸） |

### ScreenCaptureSessionWin 层

| 日志关键字 | 级别 | 诊断意义 |
|-----------|------|---------|
| `Update config : config = ...` | INFO | 采集配置更新 |
| `Start failed, capture has already started` | WARNING | ⭐⭐ 重复 Start 被 is_started_ 拦截！意外出现说明状态残留（Bug 1 铁证） |
| `Start screen capture with type: config = ...` | INFO | ⭐ 底层采集真正启动 |
| `Stop failed, cause by capture is not started` | WARNING | 重复 Stop |
| `Stop screen capture success.` | INFO | 底层停止成功 |
| `Capture frame switch capture mode from [X] to [Y]` | INFO | 采集方案动态切换（如 WGC→GDI） |
| `Capture error : error_msg = ...` | ERROR | ⭐ 采集错误详情 |
| `Capturing one frame cost Xms.` | INFO | 平均单帧采集耗时（30s 周期） |
| `Fps health is X` | INFO | 实际帧率/目标帧率 × 100 |

### WindowCapturerController 层

| 日志关键字 | 级别 | 诊断意义 |
|-----------|------|---------|
| `Failed to focus window X to top.` | WARNING | 目标窗口无法置顶 |
| `Failed to capture frame because the window is invalid` | WARNING | 窗口已关闭或句柄失效 |
| `Captured window changed. hwnd=X` | INFO | 全屏检测导致采集目标切换 |
| `Failed to set window event hook` | WARNING | WinEventHook 注册失败 |
| `Failed to set params because the window id is invalid:X` | ERROR | ⭐ 窗口句柄无效 |
| `Failed to start capture because the window id is invisible:X` | ERROR | ⭐ 目标窗口不可见，采集将失败 |

### TRTCScreenCapturer 层（trtc-api 标签）

| 日志关键字 | 诊断意义 |
|-----------|---------|
| `OnScreenSharingStarted [type:X\|window_id:Y]` | ⭐ 确认屏幕分享成功启动 |
| `OnScreenSharingStopped [...reason:Z]` | ⭐ 停止（查 reason） |
| `OnScreenSharingPaused [...reason:Z]` | ⭐⭐ 暂停（之后应有 Resume 或 Stop） |
| `OnScreenSharingResumed [...]` | 从暂停恢复 |
| `OnVideoCaptureFirstFrame [type:X\|window_id:Y]` | ⭐⭐ 产出第一帧（关键成功标志） |
| `OnScreenSharingError [...code:Z]` | ⭐ 严重错误 |

### 异步队列机制（关键理解）

ScreenSafeWrapper 的所有采集操作通过串行队列派发执行：`Start()` → `DoStartDesktopScreenCapture`、`Stop()` → `DoStop`、`UpdateParams()` → `DoUpdateDesktopScreenParams` 等。
同一线程连续调用 `UpdateParams` 和 `Start`，按派发顺序串行执行（先 Update 后 Start）。

⚠️ `StartNewScreenCapture` 复用已存在的 `screen_capturer_` 时**不会先 Stop**，底层 `is_started_` 可能仍为 true（Bug 1 根源）。

---

## 3. 状态机定义

### ScreenSafeWrapper::Status / screen::CaptureState

```
{kStopped, kStarted, kPaused}
kStopped → kStarted  (OnScreenSharingStarted_WT)
kStarted → kPaused   (OnScreenSharingPaused_WT)
kPaused  → kStarted  (OnScreenSharingResumed_WT)
kStarted/kPaused → kStopped  (DoStop)
```

### VideoScreenSharingError

| 值 | 枚举 | 含义 |
|---|------|------|
| 0 | kScreenSharingSuccess | 成功 |
| 1 | kScreenSharingUnknownError | 未知错误 |
| 2 | kScreenSharingUnauthorized | 未授权 |
| 3 | kScreenSharingStartFailed | 启动失败 |
| 4 | kScreenSharingStopped | 被系统终止 |
| 5 | kScreenSharingModuleLoss | 未集成采集模块 |

### PausedReason / ResumedReason / StoppedReason

| 值 | Paused | Resumed | 平台 |
|---|--------|---------|------|
| 0 | kUserBehavior 用户主动 | kUserBehavior | 全平台 |
| 1 | kWindowInvisible 不可见 | kWindowRecoverFromInvisible | Mac |
| 2 | kWindowMinimized 最小化 | kWindowRecoverFromMinimized | Win |
| 3 | kWindowHidden 被隐藏 | kWindowRecoverFromHidden | Win |
| 4 | kSystemBehavior 系统行为 | kSystemBehavior | iOS |

Stopped：0=kUserBehavior / 1=kWindowClosed / 2=kMonitorStatusChanged

### ScreenCapturerMode（Windows 采集方案）

| 值 | 枚举 | 含义 |
|---|------|------|
| 1 | kDxgi | DXGI Desktop Duplication |
| 2 | kMagnifier | 放大镜 API |
| 3 | kGdi | GDI BitBlt |
| 4 | kWgc | Windows Graphics Capture |

---

## 4. 生命周期与状态转换

### 正常启动流程

```
业务层 startScreenCapture(source_id)
→ SetCaptureParams 日志: SetCaptureParams [stream_type:BigStream|source=kScreenShare|source_id=XXXX]
→ StartScreenCapture 日志: StartScreenCapture [stream_type:BigStream]
→ ScreenSafeWrapper: "Start new screen capture: config = ..."
→ ScreenCaptureSessionWin::Start() → is_started_==false → StartCapture()
   日志: "Start screen capture with type: config = ..."
→ 创建 Controller → SetCaptureParams + StartCapture → is_started_ = true
→ 回调: "OnScreenSharingStarted: window_id = XXXX"（status_ = kStarted）
→ 首帧: "Screen capture first frame: window_id = XXXX, first_frame_cost_time_ms = YY"
→ API 层: "OnVideoCaptureFirstFrame [type:BigStream|window_id:XXXX]"
```

### 正常暂停→恢复流程（窗口隐藏为例）

```
EVENT_OBJECT_HIDE → NotifyWindowEvent（CaptureState==kStarted）
→ OnWindowHidedOrShowed(true) → ScreenCaptureSessionWin::Pause()
→ "OnScreenSharingPaused: ... reason = kWindowHidden = 3"（status_ = kPaused）
...窗口重新显示...
EVENT_OBJECT_SHOW → （CaptureState==kPaused 且 pause_reason_==kWindowHidden）
→ Resume() → "OnScreenSharingResumed: ... reason = kWindowRecoverFromHidden = 3"
```

### 正常停止流程

```
stopScreenCapture() → DoStop → status_ = kStopped
→ StopCapture() → is_started_ = false → capturer_.reset()
→ "Stop screen capture success." → "DoStop"
```

---

## 5. 窗口事件检测机制（WinEventHook）

`WindowCapturerController` 用 Windows `SetWinEventHook` API 监听目标窗口系统事件（绑定 `GetAncestor(window, GA_ROOT)` 顶层窗口）：

| Windows 事件 | 动作 | 条件 |
|-------------|------|------|
| `EVENT_OBJECT_DESTROY` | OnWindowClosed → 停止采集 | 无 |
| `EVENT_SYSTEM_MINIMIZESTART` | 暂停 | kStarted 且非全屏跟随 |
| `EVENT_SYSTEM_MINIMIZEEND` | 恢复 | kPaused 且因最小化暂停 |
| `EVENT_OBJECT_HIDE` | 暂停 | kStarted 且非全屏跟随 |
| `EVENT_OBJECT_SHOW` | 恢复 | kPaused 且因隐藏暂停 |
| `EVENT_SYSTEM_MOVESIZESTART/END` | 隐藏/显示描边 | 无 |

**全屏窗口检测**：检测到最小化/隐藏时先查 `IsHidedWhenShowFullScreenWindow()`——因全屏应用导致的隐藏**不触发暂停**（会跟随到全屏窗口）。

---

## 6. 已知 Bug 模式与陷阱

### Bug 1: Pause 后 Start 被 `is_started_` 拦截 ⭐⭐⭐

**状态不一致**：

| 层级 | 状态字段 | 值 | 语义 |
|------|----------|-----|------|
| ScreenSafeWrapper | `status_` | `kPaused` | 上层认为"已暂停，可以重新 Start" |
| ScreenCaptureSessionWin | `is_started_` | `true` | 底层认为"已经 started，拒绝重复 Start"（Pause 不修改 is_started_！） |

**触发条件**（三条件同时满足）：
1. 屏幕分享被 Pause（窗口隐藏/最小化事件触发）
2. 之后没有调用 StopScreenCapture
3. 同一 TRTCCloud 实例再次调用 StartScreenCapture

**因果链**：
```
窗口隐藏/最小化 → Pause() → status_=kPaused，is_started_ 仍为 true
（无 Stop）→ 退房 + 再进房（screen_capturer_ 被复用）
→ 再次 StartScreenCapture → DoStartDesktopScreenCapture（status_==kPaused ≠ kStarted，不拦截）
→ StartNewScreenCapture（复用旧 capturer）→ ScreenCaptureSessionWin::Start()
→ is_started_==true → "Start failed, capture has already started" → return!
→ 采集器实际未启动 → 无帧输出 → 编码器空转 → 远端黑屏
```

**日志特征**：
- ✅ 有 `OnScreenSharingPaused: ... reason = kWindowHidden = 3`
- ❌ 之后到下一次 Start 之间无 `StopScreenCapture` / `OnScreenSharingStopped` / `DoStop`
- ❌ 再次 Start 后无 `Start new screen capture: config` 日志
- ❌ 无 `OnVideoCaptureFirstFrame`
- ⚠️ 可能有 `Start failed, capture has already started`（铁证，取决于日志级别）

### 陷阱 2: 窗口不可见时 SetCaptureParams 返回 false

目标窗口不可见 → `IsWindowValidAndVisible` 返回 false → `OnCaptureError("...invisible...")` 报错，但**不阻止后续 Start**（用旧配置执行）→ 可能 Start 成功但采不到内容。

### 陷阱 3: ScreenCaptureSessionWin 跨 Session 复用

同一 TRTCCloud 实例退房再进房：`TRTCScreenCapturer` 不销毁（懒创建单例），所有状态（status_/is_started_/screen_capturer_）保持上次的值。上次未正确 Stop 会影响下次 Start。

---

## 7. 黑屏问题完整因果链

| 场景 | 因果链 |
|------|--------|
| A. is_started_ 残留 | 窗口A被隐藏 → Pause（is_started_ 仍 true）→ 无 Stop → 退房再进房 → Start(窗口B) 被拦截 → 无帧 → 黑屏 |
| B. 目标窗口不可见 | Start(最小化窗口C) → SetCaptureParams → invisible → OnCaptureError → 帧全黑或采集失败 |
| C. WGC/DXGI 初始化失败 | StartCapture → capturer 初始化失败（显卡不支持/权限）→ `Capture error : error_msg = ...` |
| D. 窗口关闭 | EVENT_OBJECT_DESTROY → OnWindowClosed → StopCapture → `OnScreenSharingStopped: ... reason = kWindowClosed = 1` |

---

## 8. 标准分析路径

### 第一步：确认屏幕分享是否真正启动

```
搜索: "OnVideoCaptureFirstFrame [type:BigStream" 或 "Screen capture first frame: window_id"
```
- 有首帧 → 采集曾成功，问题在后续暂停/停止/编码环节
- 无首帧 → 采集器从未产出帧，问题在启动阶段

### 第二步：检查采集器启动日志

```
搜索: "Start new screen capture: config" / "Start screen capture with type: config"
```
- 两者都有 → 底层 StartCapture 执行了
- 只有前者 → 底层 Start() 可能被 is_started_ 拦截
- 都没有 → DoStart 可能被 status_==kStarted 拦截

### 第三步：检查 Pause 残留（Bug 1 快速定位）

```
搜索: "OnScreenSharingPaused"
```
1. 确认最后一次 Paused 之后到问题 Start 之间是否有 `StopScreenCapture`/`OnScreenSharingStopped`/`DoStop`
2. 没有 → 高度怀疑 Bug 1
```
搜索: "Start failed, capture has already started"  → 找到即铁证
```

### 第四步：检查采集错误

```
搜索: "Capture error : error_msg" / "OnScreenSharingError"
      "Failed to start capture because the window id is invisible"
      "Failed to set params because the window id is invalid"
```

### 第五步：检查采集方案和状态

```
搜索: "Update config : config =" / "Capture frame switch capture mode" / "StatusInfo:"
```
确认 type（kWindow/kScreen）、id、framerate、实际帧率。

### 第六步：检查上行通道和编码器

```
搜索: "UpStream - start" / "Start encoder" / "Received first input frame for preprocessor" / "content type changed"
```
- 上行/编码器启动但无帧输入 → 采集器问题
- 有帧输入但远端黑屏 → 编码/传输问题

### 快速鉴别表

| 特征 | is_started_ 残留 | 窗口不可见 | 采集初始化失败 | 窗口关闭 |
|------|-----------------|-----------|--------------|---------|
| 有 OnScreenSharingPaused 前置 | ✅ 必然 | ❌ | ❌ | ❌ |
| "Start new screen capture" 日志 | ⚠️ 有但底层被拦截 | ✅ | ✅ | — |
| "Start screen capture with type" 日志 | ❌ 缺失 | ✅ 或 ❌ | ✅ | — |
| 首帧日志 | ❌ 永不出现 | ❌ | ❌ | ✅ 之前有 |
| "Capture error" 日志 | ❌ | ✅ "invisible" | ✅ | ❌ |
| "Start failed, already started" | ✅ 铁证 | ❌ | ❌ | ❌ |
| OnScreenSharingStopped | ❌ 缺失 | ❌ | ❌ | ✅ kWindowClosed |
| Stop 后再 Start 恢复 | ✅ | — | — | — |

### 结论模板

```
## 根因
[is_started_残留 / 窗口不可见 / 采集初始化失败 / 窗口关闭] 导致屏幕分享 [采集器未启动 / 采集失败 / 采集中断]

## 证据链
1. [时间] 上一次屏幕分享状态: [正常启动 / Pause / Stop]
2. [时间] 关键事件: [Pause reason / 窗口变化]
3. [时间] 再次 Start: [成功 / 被 is_started_ 拦截 / 配置错误]
4. [时间] 最终状态: [产出帧 / 无帧 / 错误回调]

## 归责与建议
- SDK Bug (is_started_ 残留) → 规避方案：Pause 后先 Stop 再 Start；或升级 SDK
- 客户端使用问题 (窗口最小化/不可见) → 使用建议
- 环境问题 (显卡/驱动) → 升级建议
```

---

## 9. 采集方案选择逻辑

| 方案 | 适用场景 | 优势 | 劣势 |
|------|---------|------|------|
| WGC | Win10 1803+ 窗口/屏幕 | 高性能、低 CPU、支持 HDR | 需 Win10 1803+、有黄色边框 |
| DXGI | Win8+ 全屏幕 | 高性能 | 不支持窗口级采集 |
| GDI | 所有 Windows 版本 | 兼容性最好 | CPU 高、不支持硬件加速内容 |
| Magnifier | Win7+ 窗口 | 可排除窗口 | 性能一般、部分场景兼容性差 |

由 `ScreenCapturerDecider` 按系统版本、采集类型、用户指定策略决定，运行时失败会降级（如 WGC → GDI），日志 `"Capture frame switch capture mode from [X] to [Y]"` 表示运行时方案切换。

### Mac 平台补充

- macOS 12.3+ 默认使用 **ScreenCaptureKit (SCK)** 桌面采集（12.x 起）
- 日志关键字：`SCK` / `ScreenCaptureKit`
- Mac 特有暂停原因：`kWindowInvisible = 1`（窗口不可见）、13.1 起支持窗口最小化自动暂停采集（`pauseScreenCapture`/`resumeScreenCapture`）

### iOS 平台补充

- iOS 屏幕分享走系统 ReplayKit 广播扩展，日志关键字：`CapturerStarted` / `CapturerStopped` / `CapturerPaused` / `CapturerResumed`（12.9 起）
- 特有原因：`kSystemBehavior = 4`（系统行为，如用户从控制中心停止广播）
