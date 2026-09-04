# TRTC SDK 历史问题线索（Known Issues）

> 本文是静态历史经验，只用于形成待验证假设。命中日志关键字不能单独确认根因；版本状态需结合当前官方资料核验。隐藏、私有和实验接口不得直接作为用户解决方案，除非当前官方文档或腾讯云技术支持已确认适用于用户的具体平台与版本。

## 问题索引速查表

| 现象 / 关键词 | 章节 | 日志关键字 | 平台 | 状态 |
|---|---|---|---|---|
| 私有化进房失败（13.0 / 13.1 修复前构建）⭐ | §1.1 | `-3307`, `No more available server candidate`, `kApiCallEnterRoomTimeout`, `net::ERR_CONNECTION_RESET`, `PrimaryAnycast` | 全平台 | 13.0 全部+13.1 修复点前构建受影响，按构建时间判定 |
| 直播无声 / 仪表盘有音量 | §1.2 | `setAudioCaptureVolume`, `getAudioCaptureVolume` | 全平台 | 配置问题 |
| 独立声卡音质差 | §1.3 | `enableAudioAEC`, `enableAudioANS`, `enableAudioAGC` | Windows | 配置指南 |
| 自研3A 不支持高采样率 / 回声 | §1.4 | `192000`, `96000`, `TapAudioEnhance_ResetAecAnsState`, `Enable Tap dsp: true` | 全平台 | 需降至 48000Hz |
| iOS 退房后第三方播放器无声 | §1.5 | `exitRoom`, `AVAudioSession` | iOS | 隐藏接口规避 |
| Word 编辑后分享暂停 | §2.1 | `onScreenCapturePaused`, `ScreenCapturePaused` | Windows | 窗口ID变化 |
| WGC 虚拟桌面边框残留 | §2.2 | `WGC` | Windows | 系统 bug |
| 屏幕分享采集方案切换 | §2.3 | `setWindowCaptureStrategy` | Windows | 配置指南 |
| 屏幕分享黑屏 / is_started_ 残留 | §2.4 | `Start failed, capture has already started`, 无 `OnScreenCaptureFirstFrame` | Windows | SDK Bug |
| MAG 降级 DXGI / addExcludedShareWindow 无效 | §2.5 | `Failed to capture frame by MAG`, `Failed to select perfect matched capturer` | Windows | 驱动兼容性 |
| 竖屏编码预览差异 | §3.1 | `setVideoEncoderParam` | Windows | 版本差异 |
| D3D11 创建失败 / 推流失败 | §3.2 | `Create d3d11 device failed`, `0x887A0006` | Windows | 驱动问题 |
| Win11 DShow 句柄泄露 | §3.3 | `DirectShow` | Windows 11 | 系统级问题 |
| NVENC 硬编失败 / -1303 | §3.4 | `NV_ENC_ERR_INVALID_PARAM`, `Lock bitstream failed` | Windows | 驱动问题 |
| DShow Stop 阻塞 / 采集线程 ANR | §3.5 | `Camera worker thread stuck`, `RunTask took(ms):`, `Stop physical device` | Windows | DirectShow 驱动问题 |
| 2K/4K 分辨率被判非法 | §3.6 | `ResolutionValid:False`, `SetVideoEncodeParams` | 全平台 | 套餐上限 |
| DShow 摄像头启动失败 0x80040217 | §3.7 | `Failed to set camera capability`, `hr = 0x80040217`, `IDispatch error #23`, `code:1117` | Windows | 格式/带宽/占用 |
| 外部美颜卡顿 / 采集 fps 下降 / 前处理熔断 | §4.1 | `kExternalBeautyFilter`, `custom_beauty_cost_ms`, `Change to low performance mode`, `Load rate overload.*liteav_video_preprocess`, `Abnormal uplink cost.*capture cost`, `VideoStatsInfo capture fps` | 全平台 | 业务性能问题 + 不可逆熔断 |
| Unity 画面方向异常 | §5.1 | （Unity层处理） | 全平台 | 配置指南 |
| 自定义采集纹理拷贝机制 | §5.2 | `sendCustomFrame`, `custom_video_frame` | 全平台 | SDK 内部拷贝客户纹理 |
| Vite + Electron require 报错 | §6.1 | `ReferenceError: require is not defined`, `virtual:trtc-electron-sdk` | Electron | Vite 插件配置问题 |
| 观众延迟级别设置 | §7.1 | `setAudienceLatencyLevel` | 全平台 | 隐藏接口 |
| 音视频不同步 | §7.2 | `setAudioSendPtsOffset` | 全平台 | 隐藏接口 |
| 虚拟背景 | §7.3 | `enableVirtualBackground` | 全平台 | 隐藏接口 |
| CDN 推流迁移 | §7.4 | `startPublishMediaStream` | 全平台 | 11.8+ 必迁移 |
| 音频质量扩展设置 | §7.5 | `setAudioQualityEx` | 全平台 | 隐藏接口 |
| 音频水印 | §7.6 | `enableAudioWatermark` | 全平台 | 隐藏接口（13.2+） |
| 视频编码参数配置 | §7.7 | `setVideoEncodeParamEx` | 全平台 | 隐藏接口 |
| Windows 摄像头采集接口类型 | §7.8 | `setPrivateConfig`, `windows.camera.api.type` | Windows | 隐藏接口 |
| 云控 UUID 下发 | §8.1 | `UserSpecific`, `cloud-config` | 全平台 | 排查参考 |
| 进房成功日志 | §8.2 | `EnterRoomFinished`, `EnterRoomSuccess` | iOS 已确认 | 排查参考 |
| 3A 引擎类型识别 | §8.3 | `Enable Tap dsp: true/false` | 全平台 | true=自研3A，false=天籁3A |
| SVC 支持能力 | §9.1 | — | 除 Linux 外全平台 | 旗舰版套餐 + 软编码 |
| Linux 重采样 / 采样率限制 | §9.2 | `createLocalAudioChannel` | Linux | 仅支持 16000/48000 |
| Electron TUIRoomKit 移交房主 | §10.1 | `changeUserRole` | Electron | 功能说明 |
| Electron 升级 trtc-electron-sdk 依赖 | §10.2 | `overrides`, `pnpm.overrides` | Electron | 依赖管理 |

---

## 1. 音频问题

### §1.1 13.0 / 13.1 版本私有化环境进房失败（⭐ 进房失败必查）

**问题描述**: TRTC SDK 13.0 / 13.1 版本在私有化部署环境中调用 enterRoom 进房失败。该问题表现为接入服务器握手/协议不兼容，**最终现象与"网络不通/服务端端口未监听"高度相似，极易被误判为网络或服务端部署问题**。

**错误码/现象**:
- 进房失败错误码 **`-3307`**（进房请求超时）
- 接入服务器候选耗尽：`QueryAccessServerInfo End. No more available server candidate`
- 进房超时：`kApiCallEnterRoomTimeout`
- 底层 TCP 连接被重置/超时：`net::ERR_CONNECTION_RESET`、`TIMEOUT`、TCP RST
- 私有化环境特征：`PrimaryAnycast candidates`、`SecondaryTcp candidates`、`DNS: 0`、`Local IP Stack Info`（IP 直连、无公网 DNS）

**原因分析**: 13.0 全部构建及 13.1 修复点之前的构建，其接入协议与部分私有化服务端版本不兼容，SDK 发起的握手请求被服务端拒绝（表现为 TCP RST / 超时），SDK 不断尝试其余接入服务器候选直至全部耗尽，最终回调 `-3307` 进房超时。**RST/TIMEOUT 是协议不兼容的"果"，而不一定是防火墙拦截或端口未监听。**

**解决方案**: 升级到修复点之后的构建进行对比验证；同时并行排查服务端部署，两条线索同时给出。

**影响范围**:
- **受影响版本**: **13.0 全部构建**，以及 **13.1 修复点之前的构建**
- **⚠️ 判定依据是"构建时间"，不是版本号字符串**：该 bug 已在 13.1 的某个构建点修复，修复点之后的 13.1 构建已正常，但修复点之前的 13.1 构建仍会复现。**不能仅凭"版本号是 13.1"就判定已修复**，必须确认 SDK 构建时间
- **影响场景**: 私有化部署环境，公有云环境不受影响

**⚠️ 易踩坑点（误判防范）**: 看到 `net::ERR_CONNECTION_RESET` / `TIMEOUT` / TCP RST **不要直接归因为"服务器防火墙/端口未监听/网络不通"**。在写结论前，**必须**先提取 SDK 版本，并强制比对本条已知问题。

| 判别维度 | 倾向"服务端纯问题" | 倾向"SDK 版本 Bug" |
|---|---|---|
| SDK 版本/构建 | 非 13.0/13.1，或 13.1 修复点之后的构建 | **13.0**，或 **13.1 修复点之前的构建** |
| 其他版本客户端 | 同环境其他版本客户端也连不上 | 同环境其他版本客户端可正常进房 |
| 服务端日志 | 端口确实未监听 / 进程未启动 | 服务端正常运行、其他版本可握手 |
| 复现规律 | 全量客户端均失败 | 仅旧构建失败，换修复后构建即恢复 |

**实际案例**: Android 平台，SDK 13.1.0.19861（恰为 13.1 修复点之前的构建），私有化部署，进房失败错误码 `-3307`，日志出现 `QueryAccessServerInfo End. No more available server candidate`、接入服务器连接被重置。初次分析误判为"网络/服务端部署问题"，实际为本条 Bug。

---

### §1.2 直播过程中无声但仪表盘显示有音量

**问题描述**: 直播过程中观众听不到声音，但仪表盘显示采集音量和3A后音量都有数值
**原因分析**: 用户设置了 `setAudioCaptureVolume(0)`，该接口操作的是 SDK 3A 处理后的数据，设置为 0 会导致最终输出静音，但不影响仪表盘显示的采集和 3A 处理阶段的音量值
**解决方案**: 检查 `getAudioCaptureVolume()` 返回值是否为 0
**注意事项**:
- 该接口作用于 3A 处理后的数据，设置为 0 会导致最终输出静音
- 仪表盘显示的是采集和 3A 处理阶段的音量，不受此接口影响
- 当仪表盘显示有音量但直播无声时，应首先检查 `getAudioCaptureVolume()` 返回值

---

### §1.3 Windows 独立声卡环境下音质优化

**问题描述**: 独立声卡输出音质不佳，可能只有人声没有背景声音，或音质比普通麦克风还差
**原因分析**: 专业声卡通常已经过专业调音，SDK 默认的 3A 处理会影响声卡的输出效果；SDK 默认 3A 处理是单声道，而专业声卡需要双声道输出

**解决方案**:
```cpp
// 独立声卡环境配置
// 关闭3A处理（专业声卡一般已调音）
callExperimentalAPI("{\"api\":\"enableAudioAEC\",\"params\":{\"enable\":0,\"level\":0}}");
callExperimentalAPI("{\"api\":\"enableAudioANS\",\"params\":{\"enable\":0,\"level\":0}}");
callExperimentalAPI("{\"api\":\"enableAudioAGC\",\"params\":{\"enable\":0,\"level\":0}}");

// 禁用立体声3A处理，确保双声道输出
callExperimentalAPI("{\"api\":\"setPrivateConfig\",\"params\":{\"configs\":[{\"key\":\"Liteav.Audio.common.disable.stereo.3a.processing\",\"value\":\"0\",\"default\":\"0\"}]}}");

// 关闭Windows硬件3A处理
callExperimentalAPI("{\"api\":\"setPrivateConfig\",\"params\":{\"configs\":[{\"key\":\"Liteav.Audio.windows.hardware.3a.enabled\",\"value\":\"0\",\"default\":\"0\"}]}}");
```

**SDK 版本差异**:
- 11.8~12.9：硬件3A设置为 0 需要调用两次（SDK bug）
- 13.0+：修复了 bug，只需调用一次
- 13.1+：不建议主动调用硬件3A接口，新版本播放也有硬件处理开关

**注意事项**:
- 专业声卡环境下必须关闭 3A 处理，否则会影响声卡调音效果
- 建议在 UI 中提供开关让用户选择设备类型（独立声卡/普通麦克风）
- 独立声卡不调用硬件3A接口可能导致只有人声没有背景声音

---

### §1.4 自研3A（TapDSP）不支持高于 48000 采样率的音频设备导致回声

**问题描述**: 当使用自研3A引擎（TapDSP）时，若音频采集或播放设备的采样率高于 48000Hz（如 96000Hz、192000Hz），3A 处理模块无法正常工作，导致回声、啸叫等音频问题。天籁3A 不受此限制。

**错误码/现象**:
- 通话中出现明显回声，对端能听到自己的声音被回传
- AEC 频繁重置（日志中出现大量 `TapAudioEnhance_ResetAecAnsState`）
- 可能伴随 `aec data feed playout lack` 或 `ringbuffer overrun`

**原因分析**: **自研3A引擎（TapDSP）不支持高于 48000Hz 的采样率**，而天籁3A 支持。当使用自研3A（`Enable Tap dsp: true`）且设备采样率超过 48000Hz 时：AEC 参考信号的重采样/对齐处理异常 → 回声消除滤波器无法正确建模回声路径 → AEC 频繁重置或完全失效 → 回声/啸叫。

**注意区分 3A 引擎类型**:
- `Enable Tap dsp: true` → 自研3A（TapDSP）→ **不支持**高于 48000Hz 采样率
- `Enable Tap dsp: false` → 天籁3A → 支持高采样率，无此问题

**解决方案**: 在系统层面将设备采样率降低到 48000Hz（Windows：右键扬声器/麦克风 → 属性 → 高级 → 默认格式 → 选择 48000Hz）

**注意事项**:
- **排查第一步**：先确认日志中 3A 引擎类型（`Enable Tap dsp: true/false`），仅自研3A 有此问题
- 部分高端 USB 声卡默认采样率为 96000Hz 或 192000Hz
- 此问题与"独立声卡音质差"问题可能同时出现，排查时需同时关注
- 相关深度模式：`trtc-deep-log-patterns.md` §10.10（192kHz 导致 AEC ringbuffer overrun）

---

### §1.5 iOS 退房后第三方播放器无声

**问题描述**: iOS 端 TRTC SDK 退房（exitRoom）后，App 内的第三方播放器（或系统播放器）出现无声现象，需重启 App 或等待较长时间才能恢复。

**原因分析**: SDK 在退房释放音频资源时，会执行 `AudioUnitUninitialize` / 释放 AudioUnit 的流程，期间会调用系统层 `AVAudioSession` 的 **deactivate** 操作。`AVAudioSession.deactivate` 会中断整个 App 进程的音频会话，导致所有依赖该 session 的第三方播放器全部失去音频焦点。某些时序下还原未生效或与第三方播放器的 session 管理冲突。

**解决方案**: 在**进房前**调用隐藏接口 `setPrivateConfig`，禁用 SDK 释放音频时的两类副作用行为：

```objc
NSDictionary *param = @{
    @"api" : @"setPrivateConfig",
    @"params" : @{
        @"configs" : @[
            // 禁用释放 AudioUnit 时释放音频焦点（避免 deactivate AVAudioSession）
            @{@"key" : @"Liteav.Audio.iOS.disable.releasing.audio.focus.on.release.audio.unit",
              @"default" : @"0", @"value" : @"1"},
            // 禁用 stop 时还原 AVAudioSession category（避免抢占第三方播放器 session）
            @{@"key" : @"Liteav.Audio.iOS.disable.restore.audio.session.category.on.stop",
              @"default" : @"0", @"value" : @"1"},
        ]
    }
};
[self.trtcCloud callExperimentalAPI:[param jsonStr]];
```

**注意事项**:
- **必须在进房前调用**，退房时已无法补救
- 两个配置项需同时下发，单独设置其中一个可能仍会复现
- 配置为进程级生效，一次下发后整个 App 生命周期内均生效
- 配置后 SDK 不再主动 deactivate/还原 AVAudioSession，App 退出时音频会话的清理需由业务自行管理
- 如 App 仅使用 TRTC、不涉及第三方播放器，**不建议**设置此项

---

## 2. 屏幕分享问题

### §2.1 Word 启用编辑模式后 SDK 屏幕分享自动暂停

**原因分析**: Word 启用编辑前和启用编辑后不是同一个窗口 ID，之前的窗口确实已经隐藏，原窗口 ID 只有等新窗口关闭时才会跟着销毁
**日志关键字**: `onScreenCapturePaused`, `onScreenCaptureStoped`, `ScreenCapturePaused`
**解决方案**: 通过 `onScreenCapturePaused(int reason)` 等窗口监听回调处理窗口变化，必要时重新开始分享
**注意事项**:
- Office 应用在切换编辑模式时会创建新的窗口 ID
- 建议通过进程 ID 而非窗口标题来识别目标窗口
- 可以通过 `IsWindowVisible()` 检查窗口是否可见来确定正确的目标窗口

---

### §2.2 WGC 采集窗口拖到虚拟桌面后边框残留

**问题描述**: 使用 WGC 采集某个窗口后，通过 Win+Tab 创建新的虚拟桌面，将被采集的窗口拖到新桌面后，原来桌面上的采集边框仍然残留
**原因分析**: 这是 Windows 多桌面的 bug，边框是 WGC 自己绘制的，SDK 无法控制
**注意事项**: 非 SDK 问题，SDK 无法控制 WGC 的边框绘制行为

---

### §2.3 屏幕分享采集方案切换（放大镜/GDI/WGC）

**问题描述**: 屏幕分享默认走放大镜采集时，会采集到输入法候选框等系统弹窗，需要强制切换到 WGC 或 GDI 采集模式

**解决方案**: 通过 `callExperimentalAPI` 调用隐藏接口 `setWindowCaptureStrategy`：

```javascript
trtcCloud.callExperimentalAPI(JSON.stringify({
    api: "setWindowCaptureStrategy",
    params: { strategy: 2 }  // 强制 WGC 采集
}));
```

| strategy 值 | 采集模式 | 说明 |
|-------------|---------|------|
| `0` | 放大镜（Magnifier，kPreferMagnifier） | 默认模式，全屏截图方式，会采集到输入法窗口等弹窗 |
| `1` | GDI（kPreferGdi） | 兼容性好但性能较低 |
| `2` | WGC（kPreferWgc） | 需 Win10 1903+，不会采集到输入框弹窗 |

**注意事项**:
- 需在 `startScreenCapture()` 之前调用才有效
- 如果只是想排除个别窗口而不切换采集模式，也可以使用 `addExcludedShareWindow()` 接口（但注意 §2.5 的失效场景）

---

### §2.4 屏幕分享黑屏（is_started_ 状态残留导致采集器未启动）

**问题描述**: Windows 平台上，如果上一次屏幕分享是通过 `Pause()`（如窗口被隐藏触发）进入暂停状态，之后**没有**调用 `StopScreenCapture` 就退出了会话，再次进入新会话后调用 `StartScreenCapture`，屏幕分享采集器实际未启动，导致远端看到黑屏。

**错误码/现象**:
- 远端看到屏幕分享画面完全黑屏
- SDK 无 `OnScreenCaptureFirstFrame` 回调
- 编码器和上行通道已启动但无帧输入
- 切换不同窗口仍然黑屏（问题与窗口无关）
- 停止屏幕分享恢复摄像头后，摄像头推流正常

**日志特征**（⚠️ 快速鉴别）:
```
# 正常情况：StartScreenCapture 后 ~100ms 内应出现首帧
StartScreenCapture [stream_type:BigStream]     ← 有
OnScreenCaptureFirstFrame [type:...]           ← ❌ 始终缺失！

# 底层拒绝原因（需在 WARN 级别日志中搜索）
Start failed, capture has already started      ← 如能搜到此日志则直接确认
```

**原因分析**: SDK Bug——屏幕分享上层管理模块（ScreenSafeWrapper）的 `status_` 为 `kPaused`，但底层采集器（ScreenCaptureSessionWin）的 `is_started_` 仍为 `true`（Pause 不重置该标志），导致再次 Start 时被底层拦截。

**触发条件**（三个条件必须**同时满足**）:
1. 屏幕分享被 `Pause()`（如窗口被隐藏/最小化）
2. 之后**没有**调用 `StopScreenCapture()` 就退出了当前会话
3. 同一 `TRTCCloud` 实例重新进入新会话后调用 `StartScreenCapture()`（采集器跟随 TRTCCloud 实例生命周期，进退房不会销毁底层对象）

**解决方案**:
- ⚠️ **这是 SDK Bug，客户无法通过 API 层有效规避**——实际案例证明 `StopScreenCapture` → `StartScreenCapture` 无效（Stop 在采集器未真正运行时可能 early-return，未重置 `is_started_`）
- ❌ 不要建议客户"先 Stop 再 Start"——已证明无效
- 唯一可能有效的规避方式是销毁并重建 `TRTCCloud` 实例（代价极大）
- **结论：此问题只能通过 SDK 修复解决**

**影响范围**: 12.8 已确认；后续版本代码逻辑未变，预计仍存在。Windows 平台。需特定条件组合才触发，非 100% 复现。

**排查方法（快速定位 < 2 分钟）**:
1. 搜索 `StartScreenCapture` → 确认有调用
2. 搜索 `OnScreenCaptureFirstFrame` → 如果缺失 → 高度怀疑此问题
3. 搜索 `Start failed, capture has already started` → 如找到 → **确认此问题**
4. 确认停止分享后摄像头是否正常（排除硬件问题）
5. 检查同一日志文件前方是否有 `OnScreenSharingPaused`（确认之前有过 Pause）

**注意事项**:
- 与"窗口关闭导致分享停止"是不同场景，这里窗口仍然存在且可见
- 不要误判为"显卡太旧不支持"——日志中虽有 `Video card is too old` 但那是 D3D11 转码告警，与采集无关
- 客户反馈"第一次分享正常，后续分享全黑"时优先排查此问题
- 详细诊断链路：`trtc-screen-share-diagnostics.md` §6 Bug 1

---

### §2.5 MAG 采集器失败导致 DXGI 降级 → addExcludedShareWindow 接口无效

**问题描述**: 在特定显卡（尤其是 Intel Graphics 集成显卡）的电脑上，屏幕分享（全屏模式）时 `addExcludedShareWindow()` 接口调用无效，被排除的窗口仍然出现在分享画面中。该问题在特定电脑上 100% 复现。

**错误码/现象**:
- `addExcludedShareWindow()` 调用成功返回（无 API 错误）
- 但被排除的窗口仍出现在屏幕分享画面中
- 日志中可看到 MAG 采集器持续产出空白帧后降级到 DXGI

**原因分析**:
- MAG (Magnification API) 是 SDK 唯一支持窗口排除功能的采集方案
- DXGI (Desktop Duplication API) 是全屏级采集方案，获取整个桌面位图副本，无法排除单个窗口
- 当 MAG 因显卡/驱动兼容性问题无法正常采集（仅产出空白帧）时，SDK 自动降级到 DXGI
- 此时所有 `addExcludedShareWindow` 调用在 SDK 内部被接收但实际无法生效

**解决方案**:
1. **首选**：更新显卡驱动到最新版本（尤其是 Intel Graphics 驱动），看 MAG 是否能恢复正常
2. **次选**：改用窗口级 WGC 采集 + 业务层手动判断要排除的区域
3. **临时规避**：要求用户手动最小化不需要出现在分享中的窗口（最小化窗口系统不渲染其像素内容，DXGI 自然采集不到）
4. **不推荐**：不建议强制使用 GDI 模式（性能最差，且 GDI 同样不支持窗口排除）

**注意事项**:
- 这是**环境兼容性问题**，不是 SDK Bug，无法通过升级 SDK 版本解决
- MAG 采集器是否正常取决于显卡驱动对 Magnification API 的支持度
- 窗口级 WGC 采集在该类设备上通常可正常工作（WGC 使用不同的底层 API）
- 深度模式：`trtc-deep-log-patterns.md` §10.14

---

## 3. 设备管理问题

### §3.1 Windows 平台摄像头竖屏编码本地预览行为差异

**问题描述**: Windows 平台摄像头采集设置竖屏编码方式时，不同 SDK 版本的本地预览渲染行为不一致

| SDK版本 | 采集 | 本地渲染 | 编码 |
|---------|------|----------|------|
| < 12.5 | 1280x720 | 居中裁剪后宽高 | 720x1280 |
| 12.5 ~ 13.0 | 1280x720 | 1280x720（原始宽高） | 720x1280 |
| >= 13.1 | 1280x720 | 居中裁剪后宽高 | 720x1280 |

**注意事项**: 12.5~13.0 版本本地预览与远端看到的画面可能不一致；如果客户反馈本地预览和远端不一致，需要确认 SDK 版本

---

### §3.2 驱动环境异常导致 D3D11 设备创建失败，12.8 版本摄像头推流失败

**问题描述**: SDK 12.8 版本在显卡驱动异常的设备上，D3D11 设备创建失败，导致摄像头推流完全失败

**错误码/现象**:
- 错误码：`0x887A0006`（DXGI_ERROR_DEVICE_HUNG / DXGI_ERROR_DEVICE_REMOVED）
- 日志错误：`Create d3d11 device failed: hr = 0x887A0006`
- 现象：摄像头推流完全失败，无法正常采集

**原因分析**:
- 显卡驱动损坏、显卡硬件故障、TDR（Timeout Detection and Recovery）超时等导致 D3D11 设备无法创建
- SDK 12.8 版本在 D3D11 创建失败时缺少降级处理，直接导致推流失败
- SDK 11.8 版本在相同错误下仍能正常推流（有降级方案）

**常见 DXGI 错误码**:
- `0x887A0005`: DXGI_ERROR_DEVICE_REMOVED (设备被移除)
- `0x887A0006`: DXGI_ERROR_DEVICE_HUNG (设备挂起)
- `0x887A0007`: DXGI_ERROR_DEVICE_RESET (设备重置)

**解决方案**: 建议客户更新显卡驱动；或短期使用有降级方案的版本；新版 SDK 需增加 D3D11 创建失败时的容错处理（回退软件渲染/DirectShow）

**注意事项**: 此问题仅在驱动环境异常的设备上出现；常见于 AMD Radeon 系列显卡，但不限于此

---

### §3.3 DirectShow 在部分 Win11 设备上采集句柄和内存泄露

**问题描述**: DirectShow (dshow) 在部分 Windows 11 设备上进行音视频采集时会出现句柄泄露和内存泄露问题

**错误码/现象**:
- 长时间运行后句柄数持续增长、内存占用不断上升、可能导致系统资源耗尽
- 问题仅在特定 Windows 11 版本上出现

**受影响版本**:

| Windows 版本 | Build 号 | 是否受影响 |
|-------------|---------|-----------|
| Windows 11 | 10.0.26100 | ❌ 正常 |
| Windows 11 | 10.0.26200 | ⚠️ 异常 |
| Windows 11 | >= 10.0.26200 | ⚠️ 可能异常 |

**原因分析**: DirectShow 在 Windows 11 Build 10.0.26200 及以上版本存在资源释放不完全的问题，可能与系统更新中引入的底层驱动或 DirectShow 组件变更有关。已尝试各种释放和清理方法均无法彻底解决。

**解决方案**:
- 目前**无有效解决方案**（显式释放过滤器/强制 COM 释放/调整采集参数/更新驱动均已验证无效）
- **切换采集方式**：在受影响的设备上切换到 **Media Foundation** 采集方式（见 §7.8 `setPrivateConfig` 的 `windows.camera.api.type`）
- **环境检测**：应用启动时检测系统版本，对 Build >= 26200 的设备优先使用 Media Foundation

**注意事项**:
- 泄露速度和严重程度因设备而异；长时间运行的应用（监控、直播）受影响最明显
- 如客户反馈 Windows 11 设备上的句柄/内存泄露问题，首先确认系统 Build 号（`winver` 命令）

---

### §3.4 NVIDIA NVENC 硬件编码器 NV_ENC_ERR_INVALID_PARAM 导致编码失败

**问题描述**: NVIDIA NVENC 硬件编码器在创建成功后，实际编码时 Lock bitstream 返回 `NV_ENC_ERR_INVALID_PARAM`，导致视频编码失败（errorCode:-1303），SDK 自动降级到 O264 软件编码

**错误码/现象**:
```
Lock bitstream failed: nv status = NV_ENC_ERR_INVALID_PARAM
Read frame failed: error = EncodeFailed
OnEncoderError [Error:...|originEncoderType:kHardware|targetEncoderType:kSoftware]
videocard264-internal.*unhealthy
```
- 回调错误码：`-1303`（Video: Video encode failed）
- BigStream（摄像头）和 SubStream（屏幕分享）均可能受影响
- 硬编创建成功但编码时立即失败；多次 reset 后编码器标记为 unhealthy，最终降级到 `o264-internal` 软编
- 降级后推流正常恢复

**原因分析**: NVIDIA 显卡驱动与 NVENC 编码器存在兼容性问题（与特定驱动版本相关，非 SDK bug）。SDK 的降级机制（硬编→软编）工作正常，属于预期的容错行为。

**解决方案**:
1. **更新 NVIDIA 显卡驱动**（官网最新版）
2. **彻底重装驱动**：如更新后无效，使用 DDU（Display Driver Uninstaller）彻底卸载后重装
3. **升级 SDK**：新版 SDK 可能优化了 NVENC 兼容性和降级策略

**注意事项**:
- SDK 降级到软编后推流可正常恢复，`-1303` 错误码是通知性质
- 如果业务侧收到 `-1303` 后有断连/退房等处理逻辑，需评估是否调整
- 遇到相同问题可记录 GPU 型号/驱动版本，积累数据判断是否为特定驱动版本的共性问题

---

### §3.5 Windows DirectShow 摄像头 Stop 操作偶发阻塞导致采集线程卡死

**问题描述**: Windows 平台使用 DirectShow 采集框架时，调用摄像头 Stop 操作偶发性阻塞 60 秒甚至 300+ 秒，导致 SDK 内部摄像头工作线程（`kCameraPlatformApi`）ANR，视频采集帧输出中断，仪表盘显示采集帧率降为 0。

**错误码/现象**:
- 仪表盘视频采集帧率突降为 0，持续数分钟；远端看到主播画面冻屏
- 日志中出现 `Camera worker thread stuck` ANR 告警
- 最终可能出现错误码 `1117`（Start camera failed）

**日志关键字**: `Camera worker thread stuck`, `RunTask took(ms):`, `Stop physical device`, `Anr exception.*camera_capture`, `Start camera failed`, `Camera stopped`

**原因分析**:
1. **DirectShow 驱动层阻塞**（根因）：`IMediaControl::Stop()` 在某些摄像头驱动/硬件组合下偶发性长时间阻塞，SDK 无法控制
2. **Switch camera 同设备触发 Stop→Start**：业务层重复调用 `startLocalPreview` 且设备 ID 未变时，SDK 内部走 Switch camera 路径（先 Stop 再 Start 同一设备）
3. **IM 信令触发批量操作**：IM 信令（如布局切换）可能导致业务层批量 StopRemoteView 后重新 StartLocalPreview，间接触发 Switch camera
4. **ANR 检测无恢复机制**：ANR 检测回调仅记录日志，暂无自动恢复方案

**典型因果链**:
```
IM 信令 → 业务层切换布局 → 批量 StopRemoteView → 重新 StartLocalPreview
→ SDK Switch camera (同设备) → DirectShow Stop 阻塞 60s → 工作线程 ANR → 无帧输出
→ 后续 Start 任务排队 → Stop 返回后 Start 又阻塞 300+s → Start camera failed (1117)
→ 仪表盘采集帧率 0 → 远端冻屏
```

**解决方案**:
1. **业务层优化**（推荐）：避免在布局切换时对同一摄像头重复调用 `startLocalPreview`，先判断摄像头是否已在采集中
2. **升级 SDK**：关注新版本是否增加 Stop/Start 操作的超时保护或 ANR 自动恢复机制
3. **更新摄像头驱动**
4. **切换采集框架**：如设备支持，尝试切换到 MediaFoundation（MF）采集框架（见 §7.8）

**注意事项**:
- 与 §3.3（Win11 DShow 句柄泄露）是不同问题：§3.3 是内存泄露，本问题是操作阻塞
- `camera_safe_wrapper.cc` 将所有硬件操作异步投递到专用工作线程，主线程不会阻塞，但工作线程本身会被 DirectShow 卡住
- `RunTask took(ms):` 日志可以精确看到每次 Stop/Start 的实际耗时
- 深度模式：`trtc-deep-log-patterns.md` §10.8

---

### §3.6 setVideoEncodeParamEx 设置 2K/4K 分辨率被判非法（ResolutionValid:False）

**问题描述**: 通过隐藏接口 `setVideoEncodeParamEx` 设置高于 1920x1080 的编码分辨率（如 2114x980、2K、4K），SDK 校验后丢弃该设置，实际编码分辨率回退到默认/预设值，导致"设置了 A 分辨率却编出了 B 分辨率"。

**错误码/现象**:
- 客户设置编码分辨率后，仪表盘/实际编码分辨率却是另一个值
- 自定义采集送入的原始帧尺寸正常，但编码输出被缩放到默认分辨率

**原因分析**:
1. **默认套餐编码分辨率上限为 1920x1080**（根因）：超过该上限合法性校验失败，日志打印 `ResolutionValid:False`，该组分辨率不被采纳
2. **被拒绝后回退默认值**：编码器使用之前已生效的默认/预设分辨率，并把自定义采集的输入帧缩放/变换到该尺寸编码
3. **2K/4K 需要旗舰版 Plus 套餐包**

**解决方案**:
1. 默认套餐下，编码目标分辨率不要超过 1920x1080（单边不超过 1920）
2. 如确需 2K/4K 编码，开通**旗舰版 Plus 套餐包**
3. 调用 `setVideoEncodeParamEx` 后检查日志中的 `ResolutionValid` 字段，为 `False` 即表示该分辨率被拒绝、未生效

**注意事项**:
- 区分两类日志：`sendCustomVideoData ... 2114x980` / `Input size changed Size{2114x980}` 指**自定义采集输入帧尺寸**（合法、被接受）；`SetVideoEncodeParams ... ResolutionValid:False` 指**编码目标分辨率设置被拒绝**。两者是不同环节，不要混淆

---

### §3.7 Windows DirectShow 摄像头启动失败 hr=0x80040217（VFW_E_CANNOT_CONNECT / IDispatch error #23）

**问题描述**: Windows 平台通过 DirectShow 采集摄像头时，启动采集失败，日志报 `hr = 0x80040217: IDispatch error #23`，本地预览黑屏、无采集帧。

**错误码/现象**:
- SDK 回调 `OnCameraError code:1117`，`onWarning errorCode:1117, errorMessage:Video: Start camera failed.`
- 本地预览黑屏 / 无采集数据
- `0x80040217` 即 DirectShow 的 **`VFW_E_CANNOT_CONNECT`**（"无法在过滤器之间建立连接"），部分框架显示为 `IDispatch error #23`

**原因分析**: `0x80040217` 的**本质是摄像头输出 pin 与下游 filter 的 media type 协商失败 / 图无法启动**。不同根因对应不同 HRESULT，**不能一概而论**：

| 根因 | 典型 HRESULT | 是否报 0x80040217 |
|---|---|---|
| **请求的分辨率/帧率/格式设备不支持** | `0x80040217` | ✅ 最直接、最常见，**换个采集分辨率通常即解** |
| **USB 带宽/供电不足** | `0x80040217` 居多 | ✅ 本质是"该格式在当前总线上交付不了"，**降分辨率同样能解** |
| **被其他进程独占** | 常见 `0x800705AA`、`0x80070020`，部分 UVC 驱动退化成 `0x80040217` | ⚠️ 有时会，取决于驱动实现 |
| **系统相机隐私/权限被关** | `0x80070005` E_ACCESSDENIED | ❌ 一般**不是**这个码 |
| **驱动崩溃/设备错误状态/掉线** | `E_FAIL`、`0x8007001F` 等 | ❌ 一般是别的码 |

**⭐ 关键鉴别点**:
- 如果**同一格式"时好时坏"**（如早上能正常采集、晚些时候用同一分辨率却失败），则静态"格式不支持"解释不了——此时更可能是**运行时被其他进程抢占**或 **USB 带宽争抢**
- "降低采集分辨率能好"对格式/带宽两类都有效，但当属于"时好时坏"时，真正诱因往往是那一刻的占用/带宽争抢

**解决方案**:
1. **首选**：降低采集分辨率/帧率（如从 1280x720 降到 640x480）
2. **排查占用**：复现时用任务管理器确认是否有其他会议软件/浏览器/系统生物识别服务/本程序另一实例正在占用摄像头
3. **排查权限**（若同时看到 `0x80070005`）：检查 Windows 设置 → 隐私 → 相机
4. **排查驱动/硬件**：更新/重装驱动，避开 USB hub/扩展坞直插主板 USB 口
5. **系统级验证**：用 Windows 自带"相机"App 或 AMCap 直接打开，若系统级也失败则与 SDK 无关

**注意事项**:
- **不要把 `0x80040217` 一律当成"设备被占用"或"权限问题"**
- 真实 case：内置摄像头请求 1280x720@15，设备能力列表明确支持该格式且当天早些时候采集正常，晚些时候启动失败 → 判定为运行时占用/带宽争抢
- 深度模式：`trtc-deep-log-patterns.md` §10.15

---

## 4. 性能与卡顿

### §4.1 外部美颜插件（kExternalBeautyFilter）耗时过高导致直播画面卡顿

**问题描述**: 使用外部美颜插件（通过 SDK 自定义视频预处理接口接入）时，美颜单帧处理耗时突增导致视频帧率骤降、画面卡顿、前处理触发不可逆低性能熔断

**错误码/现象**:
- 直播画面卡顿，帧率从 24~40fps 降至 4~19fps
- ⚠️ **本次推流期间帧率/码率不会自动恢复**（熔断不可逆）
- 仪表盘"采集帧率"也下降（**不是硬件慢，是反压所致**）
- 严重时前端界面卡顿、本地预览渲染 freeze、音频偶发抖动

**原因分析**:
- **直接原因**：外部美颜插件单帧处理耗时从正常的 8~25ms 突增至 50~200ms
- **直接后果**：视频预处理线程（`liteav_video_preprocess`，bizid=303）被打满（load_rate 90~100%）
- **关键副作用 1 - 不可逆熔断**：filter chain 10 秒滑窗平均耗时超阈值（约 50ms）→ 触发 `Change to low performance mode`，本次推流 **QoS 持续压制 fps 8~12、码率 100~250kbps，不会自动复位**
- **关键副作用 2 - 反压传播**：采集回调线程在 `WriteFrame` 同步调用中被反压阻塞（`capture cost` 飙到 200~400ms）；`VideoStatsInfo capture fps` 包含回调线程内部同步耗时，所以它跌一半 ≠ 摄像头硬件慢了一半；前处理线程吃满 CPU 核 → OS 调度抢占 → 渲染/音频回调同步抖动
- **可能的美颜内部触发原因**：GPU 资源竞争、美颜算法负载波动、AI 模型加载/切换、贴纸/特效启动、人脸检测进入复杂场景

**排查方法**（按顺序执行，< 10 分钟可定位）:
1. 搜索 `Change to low performance mode` → **一搜即中**确认熔断已触发
2. 搜索 `custom_beauty_cost_ms` 或 `kExternalBeautyFilter` 查看美颜耗时趋势，**重点看是否"断崖式突变"**（如 8ms→100ms 在 10s 内完成）
3. 搜索 `Load rate overload.*liteav_video_preprocess` 确认前处理线程过载
4. 搜索 `Abnormal uplink cost` 查看 `capture cost` / `preprocess cost` 拆解：
   - `preprocess cost > 100ms` → 美颜确为瓶颈
   - `capture cost > 100ms` → 反压已传播到采集线程
5. 对比"美颜耗时变化形状"与"音频 `bad wait duration` 变化"：
   - 美颜**突变** + 命中熔断 + 音频轻微/正常 → **本问题（美颜反压级联）**
   - 美颜**渐变** + 无熔断 + 音频显著异常（bad wait > 100ms 持续）→ **真·系统级资源紧张**（`trtc-deep-log-patterns.md` §10.11）
6. 查看摄像头采集帧率和编码器耗时：若 encode cost 正常（< 20ms）可排除编码器问题

**解决方案**:
- 临时缓解：重启推流复位熔断状态；故障复现时立即关闭美颜验证
- 长期方案：让美颜厂商将单帧耗时控制在 25ms 以内；启用硬件编码、降低编码分辨率减轻 CPU 压力

**注意事项**:
- **必须区分三种模式再下结论**：本问题（美颜反压级联）/ 真·系统级资源紧张 / 单纯美颜耗时高 —— 三模式鉴别表见 `trtc-deep-log-patterns.md` §10.12
- 看到 `VideoStatsInfo capture fps` 下降**不要直接说"摄像头硬件慢"**
- 多链路同步异常**不要直接落锤"系统级资源紧张"**，先排除美颜反压

---

## 5. 视频渲染问题

### §5.1 Unity 平台画面方向异常处理

**原因分析**: Unity 需要对画面方向进行适配处理
**解决方案**:
```csharp
// 本地摄像头渲染
UnityEngine.Vector3 scale = mView.rawImage.transform.localScale;
mView.rawImage.transform.localScale = new Vector3(scale.x, -scale.y, scale.z);

// 远端视频渲染
UnityEngine.Vector3 scale = remoteView.rawImage.transform.localScale;
remoteView.rawImage.transform.localScale = new Vector3(-scale.x, scale.y, scale.z);

// 远端横屏处理
remoteView.rawImage.transform.localRotation = Quaternion.Euler(0, 0, 90f);
mView.rectTransform.sizeDelta = new Vector2(600, 400);

// 远端竖屏处理
remoteView.rawImage.transform.localRotation = Quaternion.Euler(0, 0, 0f);
mView.rectTransform.sizeDelta = new Vector2(400, 600);
```

---

### §5.2 自定义采集纹理拷贝机制（SDK 内部行为说明）

**问题描述**: 客户使用自定义视频采集（`sendCustomVideoData`）时，担心业务侧释放纹理后 SDK 内部使用导致野指针/崩溃。

**原因分析（SDK 内部机制，非 bug）**:
- SDK 在 `sendCustomVideoData` 内部会**立即拷贝**客户纹理数据
- 拷贝完成后，客户可以**安全释放**自己的纹理
- SDK 后续渲染/编码使用的是内部拷贝的纹理，与客户纹理生命周期无关
- **不存在野指针风险**

**结论**: 这是 SDK 的标准行为，客户无需担心纹理生命周期管理问题

**注意事项**:
- 此机制适用于所有平台的自定义视频采集
- 纹理拷贝会带来一定的性能开销（内存带宽），但对大多数场景影响可忽略
- 如果客户对性能有极致要求，可以考虑使用纹理池复用减少分配/释放开销

---

## 6. Electron 平台问题

### §6.1 Vite 项目集成 trtc-electron-sdk 报 require is not defined

**问题描述**: 在 Vite + Electron 项目中集成 trtc-electron-sdk 后，运行时报 `ReferenceError: require is not defined`，指向 `virtual:trtc-electron-sdk` 虚拟模块。

**原因分析**: `vite-plugin-trtc-electron-sdk` 插件（v1.0.4 及以下版本）生成的虚拟模块中包含 CommonJS 的 `require` 调用，在 Vite 的 ESM 环境中无法解析。

**解决方案**: 升级 `vite-plugin-trtc-electron-sdk` 到 **v1.0.5+**，同时配置 `resolve.browserField: false` 确保 Vite 正确解析 Electron 模块。

---

## 7. 隐藏接口与高级配置

### §7.1 观众延迟级别设置（隐藏接口）

**问题描述**: 观众端需要调整播放延迟以平衡流畅度和实时性
**解决方案**:
```javascript
// 设置观众延迟级别
trtcCloud.callExperimentalAPI(JSON.stringify({
    api: "setAudienceLatencyLevel",
    params: { level: 1 }
}));
```

| 级别 | 说明 | NetEQ 参数 |
|------|------|------------|
| 1 | 低延时模式（优质线路） | target_delay: 440ms, min_delay: 700ms |
| 2 | 普通延迟（边缘节点） | target_delay: 1000ms, min_delay: 1000ms |

**注意事项**: 级别 1 适合网络条件好的场景，延迟约 440~700ms；级别 2 适合网络条件差的场景，延迟约 1000ms

---

### §7.2 音视频不同步问题（隐藏接口）

**解决方案**:
```javascript
// 调整音频发送时间戳偏移（单位：毫秒，可为负值）
trtcCloud.callExperimentalAPI(JSON.stringify({
    api: "setAudioSendPtsOffset",
    params: { offset: -50 }  // 音频提前50ms发送
}));
```

**注意事项**: 正值延迟音频，负值提前音频；建议在进房前设置

---

### §7.3 虚拟背景功能（隐藏接口）

**两种调用形式**:

```javascript
// 形式一：纯 TRTC 接口（不带 cameraId，enable 为布尔值）
trtcCloud.callExperimentalAPI(JSON.stringify({
    api: "enableVirtualBackground",
    params: {
        enable: true,
        type: 1,                      // 0: 纯色, 1: 图片, 2: 模糊
        src: "path/to/background.jpg" // type=1 时必填
    }
}));

// 形式二：合图接口（带 cameraId，enable 为整型 1/0）
trtcCloud.callExperimentalAPI(JSON.stringify({
    api: "enableVirtualBackground",
    params: {
        cameraId: "camera-device-id", // 合图形式必填
        enable: 1,
        type: 2,
        blurLevel: 2,                 // 1=Low / 2=Medium / 3=High
        color: "0x112233FF"           // type=0 纯色时使用（RGBA）
    }
}));
```

**注意事项**:
- 需要 11.0+ 版本；图片背景需要本地文件路径
- 需要对应 License 授权，License 校验失败会返回错误码 **8002**（日志中搜 `8002` 可确认是否为授权问题）

---

### §7.4 CDN 推流迁移指南（11.8+ 必迁移）

**问题描述**: `startPublishCDNStream` 在 11.8 版本后废弃，需迁移到新接口
**解决方案**: 使用 `startPublishMediaStream` 替代旧接口

```javascript
// 新接口（推荐）
const publishTarget = {
    mode: 0,  // 0: 转推到 CDN
    cdnUrlList: [{ rtmpUrl: "rtmp://xxx.livepush.myqcloud.com/live/stream" }]
};
trtcCloud.startPublishMediaStream(publishTarget, encoderParam, mixingParam);
```

**注意事项**: 11.8+ 版本必须使用新接口，旧接口 `startPublishCDNStream` 不再维护

---

### §7.5 音频质量扩展设置（隐藏接口）

**功能描述**: 精细控制音频编码参数（采样率/声道/码率）

**解决方案**:
```javascript
// 高保真单声道：48000Hz、单声道、128kbps
trtcCloud.callExperimentalAPI(JSON.stringify({
    api: "setAudioQualityEx",
    params: { sampleRate: 48000, channel: 1, bitrate: 128 }
}));

// 高品质立体声：48000Hz、双声道、320kbps
trtcCloud.callExperimentalAPI(JSON.stringify({
    api: "setAudioQualityEx",
    params: { sampleRate: 48000, channel: 2, bitrate: 320 }
}));
```

**注意事项**:
- `sampleRate` 最高支持 48000Hz，超出范围可能导致不可预期行为
- `channel` 最高支持 2（立体声），不支持更多声道
- `bitrate` 最高支持 512kbps，设置过高不会有额外收益反而增加带宽消耗
- 建议在 `enterRoom` 之前调用；适合音乐直播、高保真语音等场景

---

### §7.6 音频水印（隐藏接口，13.2+）

**解决方案**:
```javascript
// 启用音频水印（用于音频内容溯源）
trtcCloud.callExperimentalAPI(JSON.stringify({
    api: "enableAudioWatermark",
    params: {
        enable: true,
        content: "user123"  // 水印内容，仅支持 ASCII 可见字符
    }
}));
```

**注意事项**: 需要 13.2+ 版本；水印内容会嵌入音频流中，人耳不可感知，可通过专用工具提取

---

### §7.7 视频编码参数配置（隐藏接口）

**参数说明**:

| 参数 | 必填 | 说明 |
|------|------|------|
| `codecType` | 是 | 0=软编 / 1=硬编 |
| `videoWidth` / `videoHeight` | 是 | 目标分辨率（按横竖方向编码） |
| `videoFps` | 是 | 目标帧率 |
| `videoBitrate` | 是 | 目标码率 kb/s |
| `minVideoBitrate` | 否 | 最低码率下限（防弱网码率过低） |
| `streamType` | 是 | 视频流类型（TRTCVideoStreamType） |

**解决方案**:
```javascript
// 软编横屏：640x360, 15fps, 1000kbps
trtcCloud.callExperimentalAPI(JSON.stringify({
    api: "setVideoEncodeParamEx",
    params: { codecType: 0, videoWidth: 640, videoHeight: 360,
              videoFps: 15, videoBitrate: 1000, minVideoBitrate: 300, streamType: 0 }
}));
```

**横竖屏切换**：直接交换 `videoWidth` 和 `videoHeight` 即可（如 `640x360` → `360x640` 即竖屏编码），无需额外参数。

**注意事项**:
- 建议在 `startLocalPreview` 之前调用
- 自定义分辨率受套餐上限限制（默认 1920x1080，超过会报 `ResolutionValid:False`，见 §3.6）
- 设置后检查日志中的 `ResolutionValid` 字段确认是否生效

---

### §7.8 Windows 摄像头采集接口类型切换（隐藏接口）

**问题描述**: Windows 平台默认使用 DirectShow 采集摄像头，在部分 Win11 设备上有句柄泄露问题（§3.3），需要切换到 MediaFoundation

**解决方案**:
```javascript
trtcCloud.callExperimentalAPI(JSON.stringify({
    api: "setPrivateConfig",
    params: {
        configs: [{
            key: "Liteav.Video.Capture.windows.camera.api.type",
            value: 1,    // 0: DirectShow(默认), 1: MediaFoundation
            default: 0
        }]
    }
}));
```

**setPrivateConfig 已知配置项速查**:

| key | 默认值 | 取值 | 说明 | 平台 |
|-----|--------|------|------|------|
| `Liteav.Video.Capture.windows.camera.api.type` | 0 | 0=DShow / 1=MediaFoundation | 摄像头底层采集接口 | Windows |
| `Liteav.Audio.common.disable.stereo.3a.processing` | "1" | "0"=启用 / "1"=禁用 | 立体声3A（专业声卡设 "0"） | 全平台 |
| `Liteav.Audio.windows.hardware.3a.enabled` | "1" | "0"=关 / "1"=开 | Windows 硬件3A | Windows |
| `Liteav.Audio.iOS.disable.releasing.audio.focus.on.release.audio.unit` | "0" | "1"=禁用 | 退房时 deactivate AVAudioSession（§1.5） | iOS |
| `Liteav.Audio.iOS.disable.restore.audio.session.category.on.stop` | "0" | "1"=禁用 | 停止时还原 AVAudioSession category（§1.5） | iOS |

**注意事项**:
- 需在摄像头启动/进房前设置；MediaFoundation 在 Win10+ 上兼容性良好
- 音频配置项的 value/default 用字符串（"0"/"1"），摄像头配置项用数值（0/1）

---

## 8. 排查参考（日志关键字）

### §8.1 云控（Cloud Config）UUID 下发日志

**日志来源**: `cloud_config_extension_impl.cc`
**功能说明**: 云控系统根据 UUID 向特定用户下发配置项，可用于针对指定用户开启/关闭特定功能

**日志格式示例**:
```
[I][cloud_config_extension_impl.cc:946][cloud-config]UserSpecific Liteav.Video.common.disable.video.hardware.encoder : 1
[I][cloud_config_extension_impl.cc:138][cloud-config]Import Run: 2.472 ms.
```

**日志字段解读**:
- `[cloud-config]` — 模块标识
- `UserSpecific` — 针对特定 UUID 用户的下发配置
- 配置项和值（此例为禁用视频硬件编码器）
- `Import Run: X ms` — 配置导入执行耗时

**排查用途**:
- 确认云控配置是否已下发到指定用户
- 排查特定用户因云控配置导致的行为差异（如硬件编解码被禁用、特定功能被开关）
- 通过 `UserSpecific` 关键字快速定位 UUID 级别的云控配置

**如何获取 UUID**: 通过监控后台查看上报原始数据中的 `dev_id` 字段即为 UUID

---

### §8.2 进房成功日志关键字（EnterRoomSuccess / EnterRoomFinished）

**日志来源**: `network_event_dispatcher.cc`、`extension_center.cc`、`room_signal_module.cc`
**确认平台**: iOS（新版本已确认），其他平台待确认

**进房成功关键日志序列**（按时间顺序）:
```
# 1. 进房请求
[trtc-api] EnterRoom [sdkAppId:xxx|user_id:xxx|room_id:xxx|role:Anchor|...]

# 2. 信令状态变化：Idle → Scheduling → Entering → Communicating
[signal] State changed [kIdle -> kScheduling] by kApiCallEnterRoom
[signal] State changed [kScheduling -> kEntering] by kRequestAccessInfoSuccess
[signal] State changed [kEntering -> kCommunicating] by kRequestEnterRoomSuccess

# 3. 进房成功确认（关键日志）
[trtc-network] Enter room successful, access server: x.x.x.x:8009 [UDP] RoomId: xxx LocationId: xxx ClientIP: x.x.x.x:xxx EnterReason: 1

# 4. 进房完成 + 耗时（关键日志）
[trtc-api] EnterRoomFinished[CostTime:1427]

# 5. 各扩展模块收到 kEnterRoomSuccess 事件通知
Notify to extension: TRTCDataReporterExt. pipeline event: kEnterRoomSuccess
```

**快速搜索关键字**:
```
EnterRoomSuccess
EnterRoomFinished
Enter room successful
kRequestEnterRoomSuccess
EnterRoomFinished\[CostTime
```

**注意事项**:
- `EnterRoomFinished[CostTime:xxx]` 中的 CostTime 单位为毫秒，表示从调用 `enterRoom` 到进房成功的总耗时
- 信令状态变化 `kEntering -> kCommunicating` 也是进房成功的标志
- **平台差异**：目前仅确认 iOS 新版本的进房成功日志为 `EnterRoomSuccess` / `EnterRoomFinished`，其他平台待确认

---

### §8.3 3A 引擎类型识别（Enable Tap dsp）

**日志来源**: 音频初始化阶段
**日志格式示例**:
```
Enable Tap dsp: true     ← 自研 3A（TapDSP）
Enable Tap dsp: false    ← 天籁 3A
```

**分析要点**:
- `true` = **自研 3A（TapDSP）**：SDK 内部自研的回声消除/噪声抑制/自动增益模块
- `false` = **天籁 3A**：腾讯天籁实验室的 3A 算法
- **分析报告中必须标注此信息**，不同 3A 引擎的行为特征和问题排查方向不同（如 §1.4 高采样率限制仅自研 3A 存在）
- 此日志通常在音频模块初始化时打印，搜索时关注进房后的首次出现

**适用平台**: 全平台

---

## 9. 平台能力

### §9.1 SVC（Scalable Video Coding）支持能力

**功能描述**: SVC（可伸缩视频编码）是分层编码技术。TRTC SDK 支持**时域可伸缩（Temporal SVC）**——在时间维度上对视频帧分层编码：基础层（Base Layer）+ 增强层（Enhancement Layer）。接收端网络好时可解码所有层级获得完整帧率，网络差时丢弃增强层仅解码基础层以降低码率，同时保持画面流畅不花屏。

**支持条件**:
- **套餐要求**: 需购买**旗舰版套餐**
- **编码方式**: 仅支持**软编码**（硬编码不支持 SVC）

**平台支持情况**:

| 平台 | 是否支持 SVC |
|------|-------------|
| iOS / Android / Windows / Mac / Electron / Web | ✅ 支持（旗舰版套餐 + 软编码） |
| Linux（含 UOS SDK 和 TransportSDK） | ❌ 不支持 |

**注意事项**: SVC 适用于多人会议等场景，可有效降低服务端转发带宽消耗

---

### §9.2 Linux SDK 音频重采样与采样率限制

**知识点**: Linux SDK 已支持重采样，但 `createLocalAudioChannel` 的采样率**仅支持 16000 和 48000** 两档。

**排查提示**: Linux 平台客户反馈音频异常时，先确认其使用的采样率是否为 16000/48000

---

## 10. Electron TUIRoomKit

### §10.1 TUIRoomKit 移交房主功能

**功能说明**: Electron TUIRoomKit 中"移交房主"通过 `changeUserRole` 接口实现——将目标用户角色改为房主，同时自己降为普通成员。分析 TUIRoomKit 日志时，搜索 `changeUserRole` 可定位角色变更操作。

---

### §10.2 tuiroom-engine-electron 升级 trtc-electron-sdk 依赖（npm overrides）

**问题描述**: `tuiroom-engine-electron` 依赖的 `trtc-electron-sdk` 版本需要升级，但直接修改依赖树不方便

**解决方案**: 使用 npm `overrides` 或 pnpm `pnpm.overrides` 强制指定版本：

```json
// package.json（npm）
{
  "overrides": {
    "trtc-electron-sdk": "^12.x.x"
  }
}

// package.json（pnpm）
{
  "pnpm": {
    "overrides": {
      "trtc-electron-sdk": "^12.x.x"
    }
  }
}
```

---

## 关联文档

- 深度日志模式与真实案例（13 个经验模式） → `trtc-deep-log-patterns.md` §10
- 分析决策树（症状 → 搜索 → 根因） → `trtc-analysis-playbook.md`
- 音频模块诊断链路 → `trtc-audio-diagnostics.md`
- 屏幕分享诊断链路 → `trtc-screen-share-diagnostics.md`
- SDK 版本发布历史 → `trtc-sdk-versions.md`
