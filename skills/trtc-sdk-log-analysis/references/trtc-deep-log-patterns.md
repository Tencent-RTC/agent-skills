# TRTC Native 深度日志模式库

> 本文档记录 TRTC Native SDK（LiteAV，Windows 为主）日志中的深度关键字模式与实战案例。
> 与 `native-log-patterns.md`（基础模式速查）互补：本文档聚焦**模块级深度诊断模式 + 真实案例因果链**。
> 随版本迭代和分析经验积累，持续扩充。

## 目录

- [1. 房间管理](#1-房间管理)
- [2. 音频模块](#2-音频模块)
- [3. 视频模块](#3-视频模块)
- [4. 网络模块](#4-网络模块)
- [5. 设备管理](#5-设备管理)
- [6. 屏幕分享](#6-屏幕分享)
- [7. 推拉流状态](#7-推拉流状态)
- [8. 错误码与异常](#8-错误码与异常)
- [9. SDK 初始化与版本](#9-sdk-初始化与版本)
- [10. 经验模式（真实案例库）](#10-经验模式真实案例库)

---

## 1. 房间管理

| 关键字/正则 | 含义 | 分析要点 |
|---|---|---|
| `enterRoom` | 进房调用 | 检查参数（roomId, userId, sdkAppId, userSig） |
| `OnJoinRoom` | 进房回调 | `code:0` 表示成功，`elapsed_time_ms` 表示进房耗时 |
| `onEnterRoom(result)` | 进房回调 | result > 0 表示进房耗时(ms)，< 0 表示错误码 |
| `exitRoom` | 退房调用 | 确认是主动退房还是异常退房 |
| `OnExitRoom` | 退房回调 | **code:0=主动退房, code:1=被踢, code:2=房间被解散** |
| `OnKickOut` | 被踢出房间回调 | **code:2="kick out room by business" → 业务后台踢人** |
| `onReceiveKickOutPush` | 收到踢人推送 | 包含 err 码和 msg，用于确认踢人来源 |
| `UnkownCommand: 0x210a` | 服务端踢人指令 | 这是服务端下发的踢人/解散房间指令 |
| `switchRoom` | 切换房间 | 检查前后 roomId |
| `switchRole` | 切换角色 | anchor(主播) ↔ audience(观众) |
| `connectOtherRoom` | 跨房连麦 | 检查目标 roomId 和 userId |
| `onRemoteUserEnterRoom` | 远端用户进房 | 记录用户 userId |
| `onRemoteUserLeaveRoom` | 远端用户退房 | reason: 0=主动退房, 1=超时掉线 |
| `HandleIncSyncRequest.*action:Exit.*exit_reason:2` | 远端用户因房间解散退出 | exit_reason:2 表示房间被解散 |
| `Connection state changed` | 连接状态变化 | INIT → CONNECTED 等，用于确认会话边界 |

**常见问题模式：**
- 进房耗时异常高(>3000ms)：可能网络问题或 userSig 校验慢
- 进房回调返回负值：查错误码含义（`data/api/error-code.json`）
- 频繁退房/进房：可能网络抖动导致断线重连
- **"kick out room by business"**：客户自己的业务后台通过 DismissRoom/RemoveUser API 踢人/解散房间，非 SDK 问题
- **多笔会话**：一个日志文件中出现多次 OnJoinRoom → OnExitRoom/OnKickOut，需要逐笔分析

**⚠️ 多会话识别要点**：
- 搜索所有 `OnJoinRoom` 和 `OnExitRoom`/`OnKickOut` 确认会话数量
- 每笔会话的时长 = 退房时间 - 进房时间
- 根据用户描述（如"大概30分钟"）定位是哪笔出的问题
- 注意被踢后可能立即重新进房（两笔会话间隔极短）

---

## 2. 音频模块

| 关键字/正则 | 含义 | 分析要点 |
|---|---|---|
| `startLocalAudio` | 开启本地音频采集 | 检查 quality 参数(Speech/Default/Music) |
| `stopLocalAudio` | 关闭本地音频采集 | 确认调用时机 |
| `muteLocalAudio` | 静音本地音频 | true=静音，false=取消静音 |
| `setAudioCaptureVolume` | 设置采集音量 | **0 会导致无声但仪表盘显示有音量**（已知问题） |
| `setAudioPlayoutVolume` | 设置播放音量 | 0 导致听不到远端声音 |
| `AGC/AEC/ANS` / `3A` | 音频 3A 处理 | 回声消除、噪声抑制、自动增益 |
| `AudioVolume` | 音量回调 | 用于确认是否有声音数据 |
| `StartSystemLoopback` | 开始采集系统音频（扬声器） | 检查 DeviceId 是否正确获取 |
| `AudioSystemLoopbackStarted` | 系统音频采集启动成功 | 检查是否带设备信息 |
| `use dsp to cancel echo` | 系统混音 AEC 回声消除已启用 | **★ 关键！仅 Windows/Linux 平台有此日志。** StartSystemLoopback 后必须出现，否则远端音频会被回采 |
| `SetAudioQuality` | 设置音频质量 | Speech/Default/Music |
| `Set aec level` | 麦克风 AEC 回声消除等级 | 这是麦克风采集路的 AEC，不是 SystemLoopback 那路的 |
| `enable include loopback` | 是否包含 loopback 数据 | 0=不包含，1=包含 |
| `capture device:.*with sampleRate` | **WASAPI 协商的采集设备格式** | ⭐ 关键诊断行！包含 `sampleRate / channels / bits / block align / average data transfer rate`，三者数学自洽（`avg rate = sampleRate × block align`）。若 watchdog 的 real/expect 比例 ≠ 1，需要怀疑此处声明的采样率与驱动实际产出不符 |
| `Reset audio track since sample rate or channels has changed: X:Y -> A:B` | SDK 采集轨道按驱动声明重置 | 记录 SDK 从哪个采样率切到哪个采样率。此值应与上面 WASAPI 协商值一致 |
| `recording format changed from [X, Y] to [A, B]` | 3A 内部重采样到目标采样率 | Audio 3A 内部处理采样率（一般 16kHz），用于判断重采样链路起点 |
| `audio encoder changed. format:.*sample rate:\d+` | 音频编码器采样率 | 一般 48kHz，是重采样链路的终点 |
| `Audio total data size is under threshold: 0.2 expect is X, real is Y` | **audio_io_watchdog 数据异常告警** | ⚠️ 典型误读点！`0.2` 是**阈值常量**（偏差 20% 即报警），**不是**实际/预期比例。真实比例看 **`real / expect`**：<br>• real ≈ expect → 偏差小，属偶发<br>• real ≈ 2× expect → **数据过载**（或驱动实际采样率是声明的 2 倍）<br>• real ≈ 0.5× expect → **数据饥饿**（驱动断供） |
| `timestamp by data length slow down count: N, max timestamp offset: M` | **时间戳按数据长度减速修正** | ⚠️ 只有当数据**来得比预期多/快**时才会触发（把时间戳往回拖）。count 很大（数百）+ offset 接近上限（100ms）说明修正器已触顶，会被 watchdog 判异常 |
| `timestamp by data length speed up count` | 时间戳按数据长度加速修正 | 反向情况，数据**比预期少/慢**时触发（把时间戳向前推） |
| `audio io abnormal, source type: (recorder\|player\|loopback recorder)` | 音频 IO 被 watchdog 判定异常 | 紧接着会出现 `is abnormal, restart count: N` 触发链路重启 |
| `(recorder\|player\|loopback recorder) .* is abnormal, restart count: N` | 采集/播放/回采链路被异常重启 | 每一路独立计数。三路同时高频重启 → 链路级问题（驱动/蓝牙/底层），而非 SDK 单路 bug |
| `AbnormalRecord: type [CaptureDataSilence], duration_ms [N]` | 采集持续静音达 N 毫秒 | Loopback 或麦克风采集到的数据全是 0，通常伴随设备/链路重启。常见 20s+ 即影响可感知 |
| `update echo delay:.*ms` / `Echo Delay (ms)` | **回声延迟（Echo Delay）** | 来源：`tealab_internal_dsp_filter.cc:296`，标签 `[audio_log][audio-dsp]`。表示扬声器播放到麦克风重新采集的延迟。**⚠️ 不影响音质！** 延迟大时可能导致**漏回声**（AEC 搜索窗口有限，超出范围的回声无法消除）。桌面设备通常 100~400ms，无需特别关注除非客户反馈有回声 |
| `ringbuffer.*overrun\|data overrun` | **AEC 参考信号缓冲区溢出** | ⚠️⚠️⚠️ **回声问题第一搜索项！** `state 0 -> 1` 表示从正常变为溢出状态。常见原因：播放设备采样率极高（192kHz），数据灌入速度远超 TapDSP 内部处理速率（32kHz），ringbuffer 来不及消费。**overrun = AEC 拿不到正确参考帧 = 回声消不掉** |
| `Reset aec` | **AEC 模块重置** | AEC 被 reset 后需要重新收敛，短暂时间内回声可能泄漏。频繁 reset = AEC 无法稳定工作。常见触发：设备切换、采样率变化、BGM 开始/停止 |
| `use_32k_process` | TapDSP 内部处理采样率 | `use_32k_process: 1` 表示 3A 内部以 32kHz 处理。当播放设备 192kHz 时，数据量是内部处理频率的 6 倍，易导致 ringbuffer overrun |
| `Enable Tap dsp: (true\|false)` | **3A 引擎类型标识** | ⭐ **必须标注到分析报告！** `true` = 使用**自研 3A**（TapDSP），`false` = 使用**天籁 3A**。此标识决定了后续所有 AEC/ANS/AGC 行为的底层引擎，分析音频质量问题时需首先确认此项 |
| `windows (recorder\|player\|loopback recorder) hardware 3a: [01]` | **硬件前处理开关** | ≥ 13.3 版本。`1`=开启硬件前处理（3A），`0`=关闭。旧版格式为 `windows hardware 3a enable: true/false` |

**常见问题模式：**
- **⭐ 3A 引擎类型识别（必须标注）**：搜索 `Enable Tap dsp`，`true` = 自研 3A（TapDSP），`false` = 天籁 3A
- 无声问题：检查 setAudioCaptureVolume 是否为 0，muteLocalAudio 是否为 true
- 仪表盘有音量但实际无声：通常是 setAudioCaptureVolume(0)（作用于 3A 处理之后）
- 回声问题：检查 3A 处理是否开启，特别是独立声卡场景可能需要关闭 3A
- **系统混音回声泄漏（Windows/Linux）**：`StartSystemLoopback` 后检查是否有 `use dsp to cancel echo`，没有则远端音频会被回采推流出去
- **⭐ 采集端音频被"慢放/降八度"（蓝牙耳机高发）**：`capture device ... sampleRate=8000` 但 watchdog 连续报 `real ≈ 2× expect`（如 `expect=2002, real=4010`）+ `timestamp by data length slow down count` 数百以上 → **驱动声明 8kHz 但实际按 16kHz 产数据**，SDK 按 8kHz 重采样后时长被拉长 2 倍 → 详见 §10「蓝牙 HFP 采样率不匹配」
- **⭐ Windows 麦克风突然无声（WASAPI RPC 故障）**：watchdog 连续报 `real is 0` + 重启失败（HRESULT `0x800706BE` / `0x80040154`）→ Windows Audio Service 通信中断，WASAPI COM 操作全部失败。常见诱因：Intel Smart Sound Technology 驱动冲突 → 详见 `trtc-audio-diagnostics.md`
- **⭐ watchdog 重启流程**：watchdog 告警后的完整链路为「数据量检测 → 滑动窗口评分累加 → 通知 IO 异常 → WASAPI 录音器执行 Stop()+Start() 重启」。Windows 平台滑动窗口=2，连续 2 个检测周期（每周期 2s）数据异常即触发重启 → 详见 `trtc-audio-diagnostics.md`

**watchdog 日志读取铁律**：看到 `under threshold: 0.2` 时**不要**解读为"实际仅为预期的 20%"，`0.2` 是阈值常量。必须看 `expect` 与 `real` 的绝对值并计算 real/expect 比例。

**Echo Delay 解读铁律**：Echo Delay **不影响音质**。延迟大时仅可能导致**漏回声**。不要将 Echo Delay 高与"音质下降""声音失真"关联。

---

## 3. 视频模块

| 关键字/正则 | 含义 | 分析要点 |
|---|---|---|
| `startLocalPreview` | 开启本地预览 | 检查是否在进房前调用 |
| `setVideoEncoderParam` | 设置编码参数 | 分辨率、帧率、码率 |
| `setVideoEncodeParamEx` | 隐藏接口设置编码参数 | 通过 callExperimentalAPI 调用，可设自定义分辨率 |
| `SetVideoEncodeParams \[width=.* height=.* .*ResolutionValid:False\]` | **编码分辨率被判非法** | ⚠️ 设置的分辨率超过默认套餐上限（最高 1920x1080），被丢弃并回退默认分辨率；2K/4K 需开通旗舰版 Plus 套餐包 |
| `Input size changed: Size\{\d+x\d+\}` | 输入帧尺寸（自定义采集原始帧） | 与编码目标分辨率不同时会被缩放变换 |
| `Set transform params.*size=\d+x\d+` | 变换/缩放后的编码目标尺寸 | 与 `Input size changed` 对比可确认是否发生缩放 |
| `[CameraMediaType] video format:` | 摄像头采集格式 | **关键！** JPG/YUYV/NV12/I420，决定了后续处理链路 |
| `OnCameraStarted` | 摄像头启动成功 | 包含设备 ID 和名称 |
| `OnVideoCaptureFirstFrame` | 视频采集首帧 | 确认采集已开始工作 |
| `convert camera image: JPEG to I420 failed` | **JPEG 解码失败** | ⚠️ 摄像头输出的 JPEG 数据解码失败，导致无帧可编码 |
| `convert camera image: YUYV to I420 failed` | **YUYV 转换失败** | ⚠️ 摄像头输出的 YUYV 数据转换失败 |
| `Failed to set camera capability.*0x80040217` / `run media control failed, hr = 0x80040217` (`camera_device_directshow.cc`) | **DirectShow 摄像头启动失败（VFW_E_CANNOT_CONNECT / IDispatch error #23）** | ⚠️ `0x80040217` 本质是 pin/media type 协商失败。**只有"请求分辨率/帧率/格式不支持"和"USB 带宽不足"稳定复现该码，降分辨率即解**；权限被关一般是 `0x80070005`、被占用多为 `0x800705AA`/`0x80070020`。同一格式"时好时坏"→运行时占用/带宽争抢。详见 §10「DirectShow 摄像头启动失败」 |
| `OnCameraError.*code:1117` / `Video: Start camera failed` | **摄像头启动失败回调** | ⚠️ code:1117 = Start camera failed，常伴随 `kCameraStartFailed = 3`；结合前面的 hr 值定位根因（如 0x80040217） |
| `No frame sent for \d+ seconds` | **连续 N 秒无帧上行** | ⚠️ 摄像头卡死的确认标志，通常在设备异常后出现 |
| `Will update media state` | SDK 自动更新媒体状态 | 当无帧持续时，SDK 会自动降级（如去掉 Video） |
| `SetEncoderStrategy` | 编码器策略设置 | PreferHardware/PreferSoftware |
| `RequestKeyFrame` | 请求关键帧 | 在无帧时可能频繁出现，但没有数据可编码 |
| `NVENC` / `NvEnc` | NVIDIA 硬编码 | 硬编码器状态，低端显卡可能崩溃 |
| `D3D11` | Direct3D 11 | 渲染/采集设备创建 |
| `kExternalBeautyFilter` | **外部美颜滤镜耗时** | ⚠️ 耗时 >30ms 时会导致帧率下降和卡顿 |
| `custom_beauty_cost_ms:\d+` | 美颜单帧处理耗时 | 正常 <25ms，异常 >40ms 时帧率会显著下降；>100ms 时几乎必然触发不可逆熔断 |
| `Filters total cost time=\d+ms` | 预处理滤镜总耗时 | 包含美颜在内的所有滤镜总耗时 |
| `Change to low performance mode\. time_cost=\d+` | **前处理熔断进入低性能模式** | ⚠️ **不可逆！** 一旦触发，本次推流过程中 QoS 持续把帧率压到 8~12 fps，码率压到 100~250kbps，不会自动恢复，必须重启推流。10s 滑窗内 filter chain 平均耗时超阈值（约 50ms）即触发 |
| `Encoder output is unstable` | **编码器输出不稳定** | ⚠️ 编码器帧间隔超出预期，通常由上游供帧不均匀导致 |
| `Encoder input frame pts is unstable` | 编码器输入帧时间戳不稳定 | 采集/预处理管线帧间隔波动 |
| `Abnormal uplink cost:\d+ms.*capture cost:\d+ms.*preprocess cost:\d+ms` | **上行链路耗时异常** | ⚠️ 三段耗时拆解：capture（采集线程在 WriteFrame 里被反压的时间）+ preprocess（前处理 filter chain）+ encode（编码）。`capture cost > 100ms` 是反压的强证据 |
| `Drop frame because low performance, total:\d+ continue drop:\d+` | **采集→前处理 Track 覆盖式丢帧** | ⚠️ **不是采集卡死**！是 Track（容量=1）满了把旧帧覆盖。`total` 累计丢弃数；`continue drop:N` 连续被覆盖次数，N≥5 表示消费者完全跟不上。**进房前丢帧是正常行为**（不推流），关注进房后的增长速率 |
| `RunTask took\(ms\): \d+.*video_preprocessor_v3` | **前处理单次任务超时** | ⚠️ 一次 DoProcessFrame 的执行时间。>500ms 说明前处理被严重卡住 |
| `Load rate overload exception (occurs\|has been recovered)\. bizid=liteav_video_preprocess` | 前处理线程过载告警/恢复 | bizid=303 = 视频前处理。`occurs` = 进入过载，`has been recovered` = 恢复正常 |
| `Max task cost exception occurs\. bizid=liteav_video_preprocess, queue=\d+, value=\d+` | 前处理单任务耗时异常 | value 即 max_task_cost_ms，常配合 `RunTask took(ms):` 使用 |
| `Avg task cost exception occurs\. bizid=liteav_video_preprocess` | 前处理平均耗时异常 | 通常表示熔断前的早期预警 |
| `\{303:, \d+%, \d+ms, \d+ms, \d+, \d+, \d+ms, \d+ms\}` | **前处理线程统计行（bizid=303）** | 字段顺序：`{bizids, load_rate, avg_task_cost, avg_task_delay, task_count, reuse_count, max_task_cost, max_task_delay}`。load_rate=99~100% + avg_task_delay >80ms = 队列饱和 |
| `PREPROCESS,input_fps:\d+,output_fps:\d+,custom_beauty_cost_ms:\d+` | 预处理管线帧率+美颜耗时 | input_fps/output_fps 相差大说明 drop_frame_calculator 在主动降帧；两者都 <10 表示前处理跑不过来 |
| `VideoStatsInfo capture fps:\d+` (`camera_safe_wrapper.cc:620`) | **⚠️ SDK 在驱动回调线程里"每秒能跑完 OnPixelFrameAvailable 的次数"** | **不是摄像头硬件给帧速率**！它把 WriteFrame 同步调用耗时也算进去了。下游反压时这个值也会下降，但硬件可能仍在 24fps。详见 `trtc-analysis-playbook.md` 反压章节 |
| `StatusInfo:\[CAMERA,.*output_fps:\d+\]` (`camera_capture_impl.cc:489`) | CameraCapture 模块 StatusCenter 平滑统计 | 统计窗口比 `VideoStatsInfo capture fps` 长，故障时下降幅度通常更小（平滑掩盖了瞬时阻塞），**不要只看这个值** |

**常见问题模式：**
- 黑屏：检查 startLocalPreview 是否调用、视频编码器是否正常
- 花屏/卡顿：检查编码参数和网络丢包
- **外部美颜导致卡顿（单链路）**：`custom_beauty_cost_ms` >40ms 但 < 80ms → `Encoder output is unstable` → `Drop frame` → 帧率骤降
- **外部美颜引发反压级联（伪多链路异常）**：美颜单帧 >100ms + `Change to low performance mode` 熔断 + `capture cost > 300ms` + `Load rate overload (303)` + WASAPI/渲染同步抖动 → 详见 §10 模式 12
- **采集 fps 下降但不一定是硬件问题**：`VideoStatsInfo capture fps` 是"SDK 回调处理速率"不是"硬件给帧速率"，下游反压时也会跌。判别看是否伴随 `Abnormal uplink cost ... capture cost` 飙升
- **熔断后帧率/码率不会自行恢复**：看到 `[E] Change to low performance mode. time_cost=N` 即代表本次推流后续 QoS 会持续压制（fps 8~12, 码率 100~250kbps），客户感知"卡过之后再也没恢复"，**需重启推流才能复位**
- **摄像头卡死**：JPEG 解码失败 → No frame sent → SDK 降级媒体状态 → 可能触发业务踢人
- D3D11 创建失败：驱动问题
- **NVENC 硬编失败**：`NV_ENC_ERR_INVALID_PARAM` / `Lock bitstream failed`

---

## 4. 网络模块

| 关键字/正则 | 含义 | 分析要点 |
|---|---|---|
| `onNetworkQuality` | 网络质量回调 | quality: 1=Excellent, 2=Good, 3=Poor, 4=Bad, 5=VBad, 6=Down |
| `onConnectionLost` | 连接断开 | 网络断连，SDK 会自动重连 |
| `onTryToReconnect` | 尝试重连 | 重连次数和间隔 |
| `onConnectionRecovery` | 连接恢复 | 网络恢复正常 |
| `PacketLoss` | 丢包率 | 上行/下行丢包率 |
| `RTT` | 往返延迟 | 毫秒，>200ms 体验差 |
| `Bandwidth` | 带宽 | 可用带宽估算 |
| `Jitter` | 抖动 | 网络抖动 |
| `congestion` | 拥塞 | 网络拥塞状态 |
| `retransmit` | 重传 | 数据包重传 |
| `ClientIP:` | 服务端识别的客户端 IP | **用于判断 VPN/代理情况**，若与用户实际位置不符，可能导致节点分配不合理 |
| `Self IP:` | 进房后本地出口 IP | 与 ClientIP 配合判断网络环境 |
| `EnterRoom successful.*Server:` | 进房成功分配的服务器 | 确认分配的节点是否与用户位置匹配 |

**常见问题模式：**
- 卡顿：高丢包率(>10%)、高 RTT(>300ms)
- 断流恢复失败：onConnectionRecovery 后推流未恢复（已知问题）
- **丢包高但 RTT 正常**：可能是 VPN 分流导致，检查 ClientIP 是否与用户实际位置匹配

---

## 5. 设备管理

| 关键字/正则 | 含义 | 分析要点 |
|---|---|---|
| `onDeviceChanged` | 设备变更通知 | 设备插拔事件 |
| `getDevicesList` | 获取设备列表 | 可用设备枚举 |
| `setCurrentDevice` | 设置当前设备 | 切换摄像头/麦克风/扬声器 |
| `startCameraDeviceTest` | 摄像头设备测试 | 测试摄像头是否正常 |
| `startMicDeviceTest` | 麦克风设备测试 | 测试麦克风是否正常 |
| `DirectShow` | DirectShow 采集框架 | Win11 可能有句柄泄露 |
| `MediaFoundation` | MF 采集框架 | 新的采集框架 |
| `KS` | Kernel Streaming | 多次开关可能句柄泄露 |
| `Camera worker thread stuck` | **摄像头工作线程 ANR** | ⚠️ DirectShow Stop/Start 阻塞，详见 §10 模式8 |
| `Stop physical device` | 摄像头停止操作 | 检查与 `Camera stopped` 的时间差 |
| `RunTask took\(ms\):` | 设备操作耗时 | Stop/Start 耗时超过 5000ms 为异常 |
| `hr = 0x80040217` / `Failed to set camera capability` | **DShow 摄像头启动失败（VFW_E_CANNOT_CONNECT）** | ⚠️ pin/media type 协商失败。优先怀疑格式/分辨率不支持或 USB 带宽不足（降分辨率即解）；权限问题应是 `0x80070005`、被占用多为 `0x800705AA`/`0x80070020`。详见 §10「DirectShow 摄像头启动失败」 |

**常见问题模式：**
- 设备不可用：检查 getDevicesList 是否有目标设备
- 句柄泄露：DirectShow 在部分 Win11 设备上已知问题
- **DirectShow Stop/Start 阻塞**：`Camera worker thread stuck` + `RunTask took(ms):` 超大值 → 详见 §10 模式8
- **DShow 启动失败 0x80040217**："同一格式时好时坏"→运行时占用/带宽争抢，详见 §10

---

## 6. 屏幕分享

| 关键字/正则 | 含义 | 分析要点 |
|---|---|---|
| `startScreenCapture` | 开始屏幕分享 | 采集源类型和参数 |
| `stopScreenCapture` | 停止屏幕分享 | |
| `pauseScreenCapture` | 暂停屏幕分享 | 窗口最小化时自动暂停 |
| `resumeScreenCapture` | 恢复屏幕分享 | |
| `getScreenCaptureSources` | 获取可分享窗口列表 | |
| `WGC` | Windows Graphics Capture | Win10+ 的采集方式 |
| `GDI` | GDI 采集 | 传统采集方式 |
| `DXGI` | DXGI 采集 | 桌面复制 API |

**常见问题模式：**
- 屏幕分享自动暂停：Word 启用编辑模式后窗口 ID 变化（已知问题）
- WGC 边框残留：窗口拖到虚拟桌面后（Windows 系统 bug）
- 断流恢复后屏幕分享未恢复：已知问题
- **⭐ Pause 后 Start 黑屏（is_started_ 残留）**：`OnScreenSharingPaused(kWindowHidden)` 后如果没有 Stop 就再次 Start → 底层 `is_started_=true` 拦截 Start → 无帧输出 → 黑屏 → 详见 §10 及 `trtc-screen-share-diagnostics.md`
- **MAG 采集器失败 → DXGI 降级 → addExcludedShareWindow 失效**：详见 §10

> 📚 屏幕分享完整诊断链路（模块架构/状态机/黑屏因果链）见 `trtc-screen-share-diagnostics.md`

---

## 7. 推拉流状态

| 关键字/正则 | 含义 | 分析要点 |
|---|---|---|
| `startPublish` / `pushStream` | 开始推流 | CDN 推流 |
| `stopPublish` | 停止推流 | |
| `onUserAudioAvailable` | 远端用户音频可用状态变化 | true=有音频流, false=无音频流 |
| `onUserVideoAvailable` | 远端用户视频可用状态变化 | |
| `onFirstAudioFrame` | 首帧音频到达 | 音频首帧延迟 |
| `onFirstVideoFrame` | 首帧视频到达 | 视频首帧延迟 |
| `muteRemoteAudio` | 静音远端音频 | |
| `muteRemoteVideo` | 关闭远端视频 | |
| `mixTranscoding` | 混流转码 | CDN 混流配置 |

---

## 8. 错误码与异常

| 关键字/正则 | 含义 | 分析要点 |
|---|---|---|
| `onError` | SDK 错误回调 | 检查 errCode 和 errMsg |
| `ERR_` | 错误码前缀 | TRTC 错误码 |
| `FATAL` / `fatal` | 致命错误 | 需要立即关注 |
| `crash` / `exception` | 崩溃/异常 | 需要堆栈分析（见 `sdk-crash-analysis.md`） |
| `onWarning` | 警告回调 | warningCode 和 warningMsg |

> 完整错误码数据：`data/api/error-code.json`（timeline 脚本的 `errorCode` 过滤器自动引用；人工查询可直接 grep 该 JSON）

---

## 9. SDK 初始化与版本

### 日志文件命名规则

TRTC SDK 日志文件名格式为 `LiteAV_X_YYYYMMDD-PID.clog`，其中 `X` 为单字母前缀：

| 文件名前缀 | 含义 | 是否需要解压 | 说明 |
|---|---|---|---|
| `LiteAV_C_*.clog` | Compressed，压缩格式日志 | ✅ 需要解压（zlib raw deflate） | 大多数日志文件都是这个格式 |
| `LiteAV_R_*.clog` | Raw/明文日志 | ❌ **不需要解压，直接就是明文文本** | 可直接当 .log 文件读取/复制 |

**⚠️ 处理要点**：
- 遇到 `LiteAV_R_*.clog` 文件时，**不要尝试 zlib 解压**，直接复制/重命名为 `.log` 即可使用
- `LiteAV_C_*.clog` 才需要走 decompress 流程
- 无论哪种前缀，文件名中的数字部分含义相同：`YYYYMMDD` 为日期，`PID` 为进程 ID
- **多进程场景必须收集全部进程的日志**（按 PID 区分）

### 版本与组件标识

| 关键字/正则 | 含义 | 分析要点 |
|---|---|---|
| `SDK Version` / `sdkVersion` | SDK 版本号 | 确认版本以匹配已知问题（对照 `trtc-sdk-versions.md`） |
| `LiteAV` | LiteAV SDK 标识 | TRTC 底层 SDK |
| `TUIRoom` / `TUILive` | TUI 组件 | 衍生 SDK 标识 |
| `destroy` / `destroyTRTCShareInstance` | 销毁实例 | SDK 销毁流程 |

---

## 10. 经验模式（真实案例库）

> 从真实客户排障中沉淀的"日志关键字 → 根因"模式。每个模式包含：可 grep 的关键字 / 完整日志特征 / 因果链 / 鉴别要点 / 处理建议 / 与近似模式的区分。

### 模式索引（按客户描述快速定位）

| 客户描述 | 模式 | 平台 |
|---|---|---|
| "麦克风没声音"但日志里 `capture first frame` 成功 | §10.1 麦克风采集能量极低 | Windows |
| "屏幕分享推流瞬间就停了" | §10.2 屏幕分享 Start/Stop 时序异常 | Electron/Windows |
| "低端电脑屏幕分享要等很久才出画面" | §10.3 WGC 采集器低端设备初始化慢 | Windows |
| "推流报 -1303 错误码 / NVENC 编码失败" | §10.4 NVENC 940MX 硬编不可用 | Windows |
| Linux 上"对端听到自己声音被回传" + `StartSystemLoopback` | §10.5 Linux UOS 系统混音回声泄漏 | Linux UOS |
| "美颜后画面变卡 / 帧率掉" | §10.6 美颜单帧耗时突增（单链路） | 全平台 |
| "推流突然中断 → 被业务踢出房间" | §10.7 USB 摄像头 JPEG 解码失败 | Windows |
| "采集帧率突然降为 0 / 远端冻屏" | §10.8 DirectShow Stop/Start 阻塞 ANR | Windows |
| "对方听我说话像慢放 / 降八度" + 蓝牙耳机 | §10.9 蓝牙 HFP 采样率不匹配 | Windows |
| "回声消不掉" + USB 声卡 / 高采样率播放设备 | §10.10 播放设备 192kHz 导致 AEC ringbuffer overrun | Windows |
| "长会几小时后帧率/码率突然腰斩再也回不去" | §10.11 多链路同步劣化 = 系统级资源紧张 | Windows（笔记本高发） |
| "美颜慢 + CEF 卡 + 渲染 freeze（看似多链路一起出问题）" | §10.12 美颜单点劣化引发的反压级联 | Windows |
| "屏幕分享 Pause 后再次 Start 黑屏" | §10.13 is_started_ 状态残留 | Windows |
| "addExcludedShareWindow 不生效，某台电脑必现" | §10.14 MAG 失败 → DXGI 降级 | Windows |
| "摄像头打开失败/本地预览黑屏，报 IDispatch error #23" | §10.15 DShow 启动失败 0x80040217 归因 | Windows |

---

### §10.1 麦克风采集无声但采集链路正常（采集能量极低）⭐

- **SDK 版本**: 12.5（Windows）
- **关键字**: `capture first frame`, `get capture device boost info failed`, `0x80070490`, `audio_system_api_wasapi`
- **日志特征**:
  - `capture first frame` 成功 → 采集链路正常
  - `capture device start succeed` → 设备启动成功
  - 出现 `get capture device boost info failed` (HRESULT:0x80070490) → **这是警告，不是根本原因！**
  - 出现 `Get hardware gain enable failed` → 硬件增益控制不支持
- **仪表盘特征**:
  - **音频采集能量极低**（如 27，正常应几千~几万）
  - 3A 处理后能量为 0
  - 本地播放能量正常
- **含义**: 麦克风采集链路正常，但采集到的音频能量极低；3A 降噪将弱信号当成噪声过滤掉。`0x80070490` 只是硬件增益控制接口不支持，不影响基本采集
- **处理建议**:
  - **第一步：查仪表盘确认采集能量**（最关键！）
  - 采集能量极低 → 指导用户检查系统录音设备设置（Windows 声音设置 → 输入设备音量）
  - 不要看到 `Error` 就认为是根本原因

---

### §10.2 App 层屏幕分享 Start/Stop 时序异常

- **SDK 版本**: 12.6+（Windows/Electron）
- **关键字**: `StartScreenCapture`, `StopScreenCapture`, `OnScreenSharingStarted`, `OnScreenSharingStopped`, `Capture has not started`
- **日志特征**:
  - `StartScreenCapture` 后短时间内（<5s）出现 `StopScreenCapture`
  - WGC 异步初始化可能还未完成就被停止
  - 可能伴随 `Capture has not started` 警告（采集未就绪就尝试操作）
  - `OnScreenSharingStopped [reason:kUserBehavior = 0]` 表示 App 主动停止
- **含义**: App 端没有等待 `onScreenCaptureStarted` 回调确认采集就绪就提前停止屏幕分享，导致推流无画面或有效推流时间极短
- **处理建议**: 检查 Electron/App 层的屏幕分享调用逻辑，Start 后必须等待 `onScreenCaptureStarted` 回调；检查是否有超时定时器导致自动 Stop

---

### §10.3 WGC 采集器在低端设备上初始化耗时较长

- **SDK 版本**: 12.6+（Windows）
- **关键字**: `[wgc] start capture success`, `kWgc`, `Capture has not started`
- **日志特征**:
  - `SelectScreenCaptureTarget` 之后到 `[wgc] start capture success` 的间隔远超预期
  - 高端设备（如 12th Gen i7 / RTX 3060）：约 2 秒
  - 低端设备（如 i5-7200U / 940MX）：约 7 秒
  - 初始化期间如果发送帧请求，会收到 `Capture has not started` 警告
- **含义**: WGC 采集器是异步初始化的，低端设备初始化耗时显著更长。App 端超时阈值如果太短，可能在 WGC 准备好之前就放弃
- **处理建议**: App 端超时阈值至少设置 10 秒以兼容低端设备；建议使用 `onScreenCaptureStarted` 回调而非固定超时

---

### §10.4 GeForce 940MX NVENC 硬件编码器不可用

- **平台**: Windows
- **关键字**: `Create video card encoder failed`, `NVIDIA GeForce 940MX`, `OnEncoderError`, `kHardware`, `kSoftware`
- **日志特征**:
  ```
  Create video card encoder failed, adapter: NVIDIA GeForce 940MX
  OnEncoderError [Error:InitFailed|originEncoderType:kHardware|targetEncoderType:kSoftware]
  ```
  - 硬件编码器创建尝试 3 次后失败，自动降级到 O264 软编
- **含义**: GeForce 940MX 是 Maxwell 架构低端型号，NVENC 功能受限或不可用。SDK 正确执行了从硬编到软编的降级策略
- **处理建议**: 非主因问题，SDK 降级逻辑正常。但在低端设备上软编会增加 CPU 负担，如果 App 可以预知设备能力，可通过 API 直接指定软编避免初始化开销

---

### §10.5 startSystemAudioLoopback 后远端音频回声泄漏（Linux UOS）

- **SDK 版本**: Linux UOS 12.1（已知 Bug）。Windows/iOS/Android/Mac 线上版本无此问题
- **关键字**: `StartSystemLoopback`, `use dsp to cancel echo`
- **排查步骤**:
  1. 搜索 `StartSystemLoopback` 确认是否调用了系统音频采集
  2. **★ 在 `StartSystemLoopback` 之后搜索 `use dsp to cancel echo`（audio_loopback_service_impl.cc:428）**
     - 有此日志 → 系统混音 AEC 正常工作，远端音频会被消除
     - **没有此日志 → 回声泄漏！** 远端音频未被消除，直接随 loopback 采集推流出去
- **日志特征**:
  ```
  # 正常（不漏回声）：
  [trtc-api]StartSystemLoopback [DeviceId:]
  [audio-loopback]AudioSystemLoopbackStarted|start system loopback device success{...}
  [audio-loopback]use dsp to cancel echo                    ← ★ 这条是关键

  # 异常（漏回声）：
  [trtc-api]StartSystemLoopback [DeviceId:]
  [audio-loopback]AudioSystemLoopbackStarted|start system loopback device success
  # 没有 "use dsp to cancel echo"
  ```
- **含义**: Linux UOS 12.1 的 `startSystemAudioLoopback` 未启动系统混音的 AEC 回声消除，导致扬声器中播放的远端音频被 loopback 采集后直接推流出去，对端听到回声
- **处理建议**: 等待 Linux UOS SDK 后续版本修复后升级

---

### §10.6 外部美颜插件（kExternalBeautyFilter）耗时突增导致画面卡顿（单链路）

- **平台**: Windows（全平台通用）
- **关键字**: `kExternalBeautyFilter`, `custom_beauty_cost_ms`, `Encoder output is unstable`, `Abnormal uplink cost`, `Drop frame because low performance`, `PREPROCESS,input_fps`
- **日志特征**:
  ```
  [video_preprocessor_v3.cc:195] StatusInfo:[PREPROCESS,input_fps:18,output_fps:18,custom_beauty_cost_ms:52]   ← ⚠️ 美颜 52ms/帧，帧率仅 18fps
  [video_encoder_monitor.cc:56] Encoder output is unstable, output frame interval:84,fps interval: 41          ← 编码器输出间隔翻倍
  [video_encoder_monitor.cc:122] Abnormal uplink cost:200ms, capture cost:132ms, preprocess cost:57ms          ← 上行总耗时 200ms（阈值 83ms）
  [pixel_frame_track_impl.cc:120] Drop frame because low performance, total:42177 continue drop:2             ← 累计丢帧 42177
  [filter_cost_time_stats.cc:87] Filters total cost time=26ms {kExternalBeautyFilter:25, }                     ← 美颜滤镜是主要耗时来源
  ```
- **含义**: 外部美颜插件单帧处理耗时从正常的 21~25ms 突增至 50~58ms（翻倍），导致视频预处理管线吞吐量骤降，输出帧率从 40fps 降至 17~19fps。摄像头采集层帧率（60fps）和编码器本身（encode cost 6~13ms）均正常，瓶颈完全在预处理阶段的外部美颜滤镜
- **因果链**: 外部美颜耗时突增 → 预处理管线堵塞 → 输出帧率降至 17~19fps → 编码器输入不均匀 → `Encoder output is unstable` + `Drop frame` → 观众端画面卡顿
- **鉴别要点**（⚠️ 落锤前**必须**全部满足，否则可能是「多链路同步劣化」模式，见 §10.11/§10.12）:
  1. **摄像头采集帧率（`camera_safe_wrapper.cc:620` 的 `capture fps`）保持正常** → 排除采集端被拖累
  2. **WASAPI 麦克风的 `bad wait duration` 保持在几毫秒级** → 排除系统级资源紧张
  3. **没有 `On render frame freeze: 1000ms+` 之类的渲染卡顿** → 排除渲染线程被拖累
  4. 编码器 encode cost 正常 → 排除编码器问题
  5. `custom_beauty_cost_ms` 与帧率强相关：美颜 50ms+ ↔ 18fps，美颜 23ms ↔ 40fps
  6. `Abnormal uplink cost` 中 preprocess cost 占大头 → 预处理管线是瓶颈
  7. 卡顿具有间歇性 → 可能与 GPU 资源竞争、美颜算法负载波动有关
- **⛔ 落锤陷阱（必读）**: 如果上面 1~3 条**有任何一条不满足**（采集 fps 也降了 / 麦克风 wait 也飙了 / 渲染也卡了），**绝不能下结论"美颜是根因"**，请改用 §10.11/§10.12 模式分析，否则会把"被牵连的结果链路"当成"根因链路"，给客户错误的整改方向（如换美颜厂商）
- **处理建议**（仅当上述鉴别全部满足时）:
  1. 告知客户美颜插件是卡顿根因，要求将单帧耗时控制在 25ms 以内
  2. 排查美颜插件进房后是否有预热开销或 GPU 资源竞争
  3. 如使用 GPU 美颜 + 软编码器（o264），CPU/GPU 资源分配可能不合理，建议启用硬件编码
  4. 可通过 `setVideoEncoderParam` 适当降低编码分辨率减轻预处理压力

---

### §10.7 USB 摄像头 JPEG 解码失败导致推流中断 → 被业务踢出

- **平台**: Windows（可能影响所有版本）
- **关键字**: `convert camera image: JPEG to I420 failed`, `No frame sent for`, `kick out room by business`, `CameraMediaType`, `video format:JPG`
- **日志特征**:
  ```
  [capture_pin.cc:90][CameraMediaType] video format:JPG, width:1280, height:720, fps:30   ← 摄像头采集格式为 JPEG
  ...（正常推流一段时间）...
  [E][directshow_capture.cc:619]convert camera image: JPEG to I420 failed.                 ← ⚠️ JPEG 解码突然失败
  [video_encoder_controller.cc:66]SetEncoderStrategy [BigStream]PreferHardware              ← 编码器策略重设
  [video_producing_context.cc:710]request key frame type: 0                                 ← 请求关键帧但无数据
  [W][local_channel_base.cc:136] BigStream No frame sent for 5 seconds                     ← ⚠️ 5秒无帧上行
  [local_channel_manager.cc:859] Will update media state from [Video:Big] [Audio:Has] to [Audio:Has]  ← SDK 降级
  [signal_manager.cc:1567] S2CRequest: {cmd:UnkownCommand: 0x210a}                         ← 服务端踢人指令
  [signal_manager.cc:1860] onReceiveKickOutPush. err:2 msg:kick out room by business        ← 业务踢人
  [trtc_pipeline.cc:2633] OnKickOut [code:2|msg:kick out room by business]                  ← 被踢
  ```
- **含义**: USB 摄像头输出 JPEG 格式数据，SDK 解码 JPEG → I420 失败。失败后采集链路中断，BigStream 连续 5 秒无帧上行。业务后台检测到主播视频流断开后，通过服务端 API 解散房间/踢出用户
- **因果链**: 摄像头 JPEG 解码失败 → 无帧可编码 → 5秒无上行 → SDK 降级媒体状态 → 业务检测到断流 → 业务踢人
- **根因分析**:
  1. **设备不稳定**：USB 摄像头输出了损坏的 JPEG 数据（最可能）
  2. **SDK 解码 bug**：某一帧解码失败后，采集流程可能未正确恢复（需确认新版本是否修复）
  3. **系统内存/资源不足**：导致 JPEG 解码分配内存失败
- **处理建议**:
  1. 告知客户摄像头卡死原因是 JPEG 解码失败，给出关键日志
  2. 建议排查设备稳定性（换 USB 端口/换摄像头/更新驱动）
  3. 建议升级 SDK 版本（老版本可能存在解码失败后恢复逻辑的 bug）
  4. 建议业务侧优化踢人策略（增加容错时间）
- **注意**: 同一日志文件出现两笔会话且都因相同原因被踢出 → 设备持续不稳定

---

### §10.8 DirectShow 摄像头 Stop/Start 操作偶发阻塞导致采集线程 ANR

- **触发条件**: Windows + DirectShow 采集框架 + 摄像头 Stop 或 Start 操作
- **日志特征**:
  ```
  [camera_safe_wrapper.cc] Stop physical device                          ← 主线程投递 Stop 任务
  [camera_safe_wrapper.cc] RunTask took(ms): 60000+                      ← Stop 耗时异常（正常 <500ms）
  [camera_safe_wrapper.cc] Camera worker thread stuck                    ← ANR 检测告警
  [thread_manager.cc] Anr exception. thread_name:camera_capture          ← ThreadManager ANR 上报
  [camera_safe_wrapper.cc] Camera stopped                                ← Stop 返回（阻塞结束）
  [camera_safe_wrapper.cc] RunTask took(ms): 305000+                     ← 后续 Start 又阻塞
  [camera_safe_wrapper.cc] Start camera failed, err: 1117                ← 最终 Start 失败
  ```
- **含义**: Windows DirectShow API（`IMediaControl::Stop()` 或 `::Run()`）在某些摄像头驱动/硬件组合下偶发性阻塞，导致 SDK 内部 `kCameraPlatformApi` 工作线程长时间无响应。工作线程被阻塞期间无法执行任何摄像头操作，视频帧输出中断
- **因果链**: IM 信令/业务操作 → 重复 startLocalPreview → SDK Switch camera（同设备 Stop→Start）→ DirectShow Stop 阻塞 60s+ → 工作线程 ANR → 无帧输出 → 后续 Start 排队又阻塞 → Start camera failed (1117) → 仪表盘采集帧率 0 → 远端冻屏
- **根因分析**:
  1. **DirectShow 驱动层阻塞**（根因）：操作系统/驱动层面问题，SDK 无法控制
  2. **同设备 Switch camera 触发 Stop**：业务层重复调用 startLocalPreview 且设备未变，SDK 走 Stop→Start 路径
  3. **ANR 检测无恢复机制**：暂无自动恢复
- **处理建议**:
  1. 确认业务层是否存在重复调用 startLocalPreview 的逻辑（如 IM 信令触发布局切换）
  2. 建议业务层优化：对同一摄像头避免重复 Start，先判断是否已在采集中
  3. 建议升级 SDK 版本，关注 ANR 超时恢复机制的改进
  4. 建议更新摄像头驱动或尝试切换到 MediaFoundation 采集框架
- **与 §10.7 区分**: 本模式根因是 DirectShow API 调用阻塞而非数据解码失败

---

### §10.9 蓝牙 HFP 麦克风采样率不匹配（声明 8kHz 实发 16kHz）导致音频慢放 + 全链路重启 ⭐

- **SDK 版本**: Windows（根因与 SDK 版本无关，任何基于 WASAPI 的应用都会遇到）
- **设备**: LC3/超宽带蓝牙耳机高发（如华为 FreeBuds 系列）
- **关键字**: `capture device: 耳机.*sampleRate: 8000.*block align: 4.*average data transfer rate: 32000`, `Audio total data size is under threshold: 0.2 expect is 2002, real is 4010`, `timestamp by data length slow down count`, `audio io abnormal`, `is abnormal, restart count`, `AbnormalRecord: type [CaptureDataSilence]`, `BluetoothHfp`
- **日志特征**:
  ```
  # 进房时 WASAPI 协商出的采集格式（数学自洽：32000 B/s ÷ 4 B/采样 = 8000 采样/s）
  [audio-capture] capture device: 耳机 (XXX蓝牙耳机) with
                     sampleRate: 8000
                     channels: 1, bits: 32
                     block align: 4
                     average data transfer rate: 32000
                     format tag: 65534 (WAVE_FORMAT_EXTENSIBLE)
  [audio-capture] Reset audio track since sample rate or channels has changed: 0:0 -> 8000:1
  [audio-3a]      recording format changed from [0, 0] to [16000, 1]
  [audio-encoder] audio encoder changed. format:opus, sample rate:48000 channels:1

  # 进入采集后：watchdog 连续异常（real ≈ 2× expect）+ 时间戳被迫减速修正
  [audio-io-watchdog] timestamp by data length slow down count: 487, max timestamp offset: 100
  [audio-io-watchdog] Audio total data size is under threshold: 0.2 expect is 2002, real is 3990,
                     type is recorder, sample rate: 8000, channels: 1
  [audio-io-watchdog] Audio total data size is under threshold: 0.2 expect is 2001, real is 4010,
                     type is player, sample rate: 44100, channels: 2
  [audio-io-watchdog] Audio total data size is under threshold: 0.2 expect is 2003, real is 4010,
                     type is loopback recorder, sample rate: 44100, channels: 2

  # 三路链路被 watchdog 循环重启 + Loopback 出现 20s+ 静音
  [audio-io]      audio io abnormal, source type: recorder
  [audio-io]      recorder is abnormal, restart count: 0 ~ 14
  [audio-io]      player is abnormal, restart count: 0 ~ 8
  [audio-io]      loopback recorder is abnormal, restart count: 0 ~ N
  [audio-abnormal]AbnormalRecord: type [CaptureDataSilence], duration_ms [20060]
  ```
- **含义**:
  - LC3 超宽带蓝牙麦克风实际以 16kHz 采集，但 Windows HFP 驱动栈仍按传统 HFP 向 WASAPI 声明 8kHz 端点，且**漏做了 16→8 降采样**
  - 协商面：SDK 看到的是 `sampleRate=8000, block align=4, avg rate=32000`（三者数学上完全自洽，符合 8kHz）
  - 数据面：驱动以 16kHz 的真实速率往 WASAPI 缓冲灌字节
  - SDK 信以为"是 8kHz 数据"送入 3A 和重采样链路 → **1 秒的真实采集内容被当成 2 秒的数据处理** → 重采到 48kHz 后时长依然是被拉长的 2 倍
  - 听感：**声音变慢 + 降八度**（频谱被压到一半）
- **因果链**:
  1. 驱动声明 8kHz / 实际 16kHz → SDK 按 8kHz 解析 → 音频被慢放 2 倍（①）
  2. audio_io_watchdog 每 2 秒按 8kHz 折算字节数 → `expect=2002ms / real=4010ms` → 判 io 异常（②）
  3. HFP recorder 反复重启 14+ 次 → 波及蓝牙链路 → A2DP player 反复重启 8+ 次（③）
  4. Loopback 抓的是 A2DP 默认播放设备 → A2DP 重启期间 Loopback 无数据 → `CaptureDataSilence 20+ 秒`（④）
- **鉴别要点**（快速区分"链路抖动/突发灌入"与"采样率不匹配"）：
  1. 查 `capture device ... with sampleRate/block align/avg rate` 三者是否数学自洽
     - **自洽**（32000÷4=8000）→ 协商声明的采样率没问题，问题在**驱动实际产出**
  2. 查 `real / expect` 的比例：
     - **稳定的 ≈2.0** → 采样率不匹配（本模式）
     - 忽大忽小（有时 1.x、有时 3.x）→ 链路抖动/突发灌入，不是本模式
  3. 查客户听感：**"慢放、低沉、像被降调"** → 强力支持本模式（慢放比例与 real/expect 比例一致）
  4. 查设备类型：蓝牙 HFP 麦克风（特别是 LC3 超宽带耳机）→ 高发场景
- **处理建议**:
  1. **立即验证**（客户侧 1 分钟）：切换麦克风到内置麦克风阵列，扬声器保持不变 → 慢放/watchdog 告警/静音应同时消失
  2. **客户侧规避**:
     - SDK 层：`setCurrentDevice(TXMediaDeviceTypeMic, 内置麦克风 deviceId)`
     - 系统层：Windows 控制面板 → 声音 → 录制 → 该设备 → 属性 → 高级，将默认格式改为 **16000Hz（单声道）**
     - 更新耳机固件
  3. **业务侧规避**: 开播前检测到麦克风为 `BluetoothHfp` 类型时弹窗提示用户切换麦克风
  4. **屏幕共享 Loopback**: `startSystemAudioLoopback(deviceId)` 显式指定非蓝牙的扬声器（如 Realtek），避免 Loopback 受蓝牙链路连锁影响
- **与其他模式区分**:
  - 与 §10.1（采集能量极低）不同：本模式采集能量正常，问题在**时长被拉长**而非能量被滤除
  - 与 §10.5（系统混音回声泄漏）不同：本模式是**采样率错**，回声泄漏是 AEC 未启动
- **⭐ 音视频联合验证法（如客户能提供录制文件）**:
  1. 用 ffmpeg 生成**全长频谱图**（`showspectrumpic`）：频谱上限"塌缩到 ~5kHz 以下"或"整体被压到一半" → 视觉确认带宽异常
  2. 做 `asetrate=88200,aresample=44100` 的**快放 2x 实验**：听感恢复正常语速+音调 → **铁证**

**⚠️ watchdog 日志解读铁律**：`Audio total data size is under threshold: 0.2 expect is X, real is Y` 中的 **`0.2` 是阈值常量**（偏差 20% 即报警），**不是** real/expect 的比例。必须看 `expect` 和 `real` 的**绝对值**计算 `real / expect`。

数学例证：
```
日志：expect is 2002, real is 4010, type is recorder, sample rate: 8000, channels: 1
协商：sample rate 8000, block align 4 → avg rate 32000 B/s
watchdog 2 秒窗口预期字节：32000 × 2 = 64000 B ↔ 日志中 expect=2002ms
实际 2 秒窗口收到字节：64000 × (real/expect) = 64000 × 2.0 = 128000 B
驱动实际采样率 = 128000 ÷ (2s × 4 B) = 16000Hz   ← 反推结果
```

---

### §10.10 播放设备高采样率（192kHz）导致 AEC 参考信号 ringbuffer overrun → 回声消不掉 ⭐⭐

- **平台**: Windows（所有版本均可能受影响）
- **关键字**: `ringbuffer.*overrun|data overrun`, `192000`, `playout.*sampleRate`, `Reset aec`, `Headphones`, `use_32k_process`
- **日志特征**:
  ```
  # 播放设备切换到高采样率设备（192kHz）
  [audio-device] playout device changed: Headphones (xxx), sampleRate: 192000

  # 切换后立即触发 ringbuffer overrun
  [audio-dsp] ringbuffer: data overrun state 0 -> 1    ← ⚠️ AEC 参考信号缓冲区溢出！

  # AEC 被 reset（可能多次）
  [audio-dsp] Reset aec ...

  # TapDSP 内部处理采样率
  [audio-3a] use_32k_process: 1    ← 内部只用 32kHz 处理
  ```
- **含义**:
  - 播放设备（如 USB 声卡的 Headphones 端口）协商的采样率为 192kHz
  - 麦克风采集设备采样率通常为 48kHz
  - TapDSP 内部仅以 32kHz 处理 AEC
  - 192kHz 的播放数据量是 48kHz 的 4 倍，是 32kHz 的 6 倍
  - AEC 参考信号的 ringbuffer 按正常采样率设计的容量，无法承受 192kHz 灌入的数据量 → **overrun**
  - overrun = AEC 拿不到正确的参考帧 = **回声消不掉**
- **因果链**: 切换 192kHz 播放设备 → 数据灌入 AEC 参考通道 → ringbuffer overrun → AEC 参考信号缺失 → 回声消除失败 → 远端听到回声
- **鉴别要点**（< 5 分钟）:
  1. 搜索 `ringbuffer.*overrun|data overrun` → **一搜即中**
  2. 搜索播放设备采样率 → 确认 192kHz / 96kHz 等异常高采样率
  3. 确认问题时间线：设备切换后立即出现 overrun → 吻合
  4. 麦克风采集正常（采集能量正常）但远端听到回声 → 确认是 AEC 失效
- **与其他回声问题区分**:
  | 特征 | 本模式（AEC 参考溢出） | 系统混音泄漏 | Echo Delay 过大 | 普通设备距离过近 |
  |---|---|---|---|---|
  | ringbuffer overrun | ✅ 有 | ❌ 无 | ❌ 无 | ❌ 无 |
  | 播放设备采样率异常高 | ✅ 192kHz+ | ❌ 正常 | ❌ 正常 | ❌ 正常 |
  | `use dsp to cancel echo` | 可能有（另一条路） | ❌ 缺失 | ✅ 有 | ✅ 有 |
  | Echo Delay 值 | 正常或无意义 | 无关 | >500ms | 正常 |
  | AEC 是否开启 | ✅ 已开启 | ❌ 未启动 | ✅ 已开启 | ✅ 已开启 |
- **处理建议**:
  1. **临时解决（客户侧 1 分钟）**：Windows 声音设置 → 播放设备 → 属性 → 高级 → 默认格式 → 从 192kHz 改为 **48000 Hz（16/24 bit）**
  2. **业务侧规避**：App 在切换音频设备时检测设备采样率，如果 >48kHz 提示用户手动调整
  3. **SDK 侧长期修复方向**：AEC 参考通道重采样到内部处理频率 / 动态扩大 ringbuffer / 检测 overrun 时主动降采样

---

### §10.11 多个独立子系统同步劣化（采集/麦克风/美颜同时变慢）= 系统级资源紧张 ⭐⭐

- **平台**: Windows（笔记本场景高发，与版本无关）
- **关键字**: `camera_safe_wrapper.*VideoStatsInfo capture fps`, `video_encoder_monitor.*capture cost`, `audio_recorder_wasapi.*bad wait duration`, `kExternalBeautyFilter`, `Load rate overload exception`, `Drop frame since too much cache`, `On render frame freeze`
- **典型客户描述**: "直播两三个小时后突然卡了，采集帧率从 24 跌到 14，码率掉一大半，再也回不去"
- **日志特征**（**关键：以下三~四条必须在同一秒~十几秒内同时出现，才命中本模式**）:
  ```
  # ① 摄像头真实拉帧 fps 腰斩（这是源头）
  [camera_safe_wrapper.cc:620] StatusInfo:[CAMERA, ...] VideoStatsInfo capture fps: 14    ← 故障前 25
  [video_encoder_monitor.cc:122] Abnormal uplink cost:930ms, capture cost:388ms, preprocess cost:529ms
                                                       ↑ SDK 等一帧画面要 388ms（标称 41ms/帧）

  # ② WASAPI 麦克风同步抖动（独立硬件 + 独立线程！）
  [audio_recorder_wasapi.cc:657] bad wait duration: (17-191 ms)    ← 故障前 (1-11 ms)
  [local_audio_frame_track.cc] Drop frame since too much cache, current cache ms:220

  # ③ 美颜 / 前处理同步飙升（GPU/CPU 链路）
  [filter_cost_time_stats.cc:87] Filters total cost time=103ms {kExternalBeautyFilter:103, }   ← 故障前 8~12ms
  [thread_manager.cc:945] Load rate overload exception. bizid=liteav_video_preprocess, value=90
  [thread_manager.cc:945] Max task cost exception. bizid=liteav_video_preprocess, value=1047

  # ④ 渲染线程也被波及（强证据：完全独立的链路也卡了）
  [render] On render frame freeze: 1053ms, render_interval: 1053ms, immediate 1 fps

  # ⑤ SDK QoS 自动降级（结果，不是原因）
  [qos] SetEncodeBitrate: 102400  SetFps:8
  [qos] Audio set encode bitrate is 40960
  ```
- **含义**: 摄像头驱动（USB/MF/DirectShow）、WASAPI 麦克风、GPU 美颜、CPU 渲染**分属不同硬件、不同线程、不同回调路径**，三~四条独立链路在同一秒（±10s 内）一起劣化，**唯一能同时拖慢这些链路的是客户端进程级 / 操作系统级的全局资源争用**（CPU/GPU 降频、IO 阻塞、调度抢占、电源策略切换、热限制）。
- **因果链**:
  ```
  系统级突发资源紧张（CPU/GPU 降频 / IO 阻塞 / 后台进程 / 电源切换 / thermal throttling）
            ↓
   ┌────────────┬────────────┬────────────┬────────────┐
   ↓            ↓            ↓            ↓            ↓
  USB 摄像头     WASAPI 麦克风  GPU 美颜      CPU 渲染      其他独立链路
  拉帧 25→14fps  wait 191ms    10→103ms     freeze 1s
            ↓
       SDK 检测到 preprocess/uplink cost 超阈值
            ↓
       主动降到 100kbps / 8fps / kSlowest 编码（保护性降级，不是 bug）
            ↓
       仪表盘呈现：采集帧率减半、发送帧率减半、码率掉到 ¼
  ```
- **⭐ 鉴别要点**（极其重要，避免把美颜或单链路当根因）:
  1. **看 `camera_safe_wrapper.cc:620` 的 `VideoStatsInfo capture fps`**——这是 SDK 实际从摄像头驱动回调拿到帧的 fps，**不是 `camera_capture_impl.cc` 的 `output_fps`**（后者是滑动平均，会"看上去没那么糟"）。`capture fps` 跌一半 → 摄像头驱动给得就少
  2. **看采集线程 `liteav_video_capture` 是否触发 `Load rate overload`**——如果**没**触发，说明采集线程**不忙**，只是**取不到帧**（驱动/硬件给得慢），这是"系统资源紧张拖慢驱动回调"的强证据
  3. **看音频是否同步异常**：`bad wait duration` 从几毫秒涨到上百毫秒、`local_audio_frame_track Drop frame` ——音频和视频是完全不同的硬件、不同的内核驱动栈，**不可能因为美颜慢就一起慢**，只能是系统级原因
  4. **看渲染线程是否被波及**：`On render frame freeze: 1000ms+` 出现在和上面同一秒
  5. **看美颜耗时变化的"形状"**：如果美颜耗时是**突然**从 10ms 跳到 100ms（而不是渐变上涨），且伴随上述其他链路同步劣化，那么美颜是**被牵连的结果**，不是根因
  6. 时间窗：长会（>2 小时）+ 笔记本设备 + 故障一旦发生**长时间不恢复** → 高度怀疑 thermal throttling / 电源策略降频
- **⚠️ 关键鉴别点（与 §10.12 反压级联的判别公式）**：
  - 美颜耗时是**突变**（10ms 一秒内跳到 100ms+）+ 命中 `Change to low performance mode` 熔断 → 90% 是反压级联，根因仍在美颜
  - 美颜耗时是**渐变**（30 分钟从 10ms 慢慢爬到 50ms）+ 故障与笔记本拔电/温度升高时间吻合 + 没有熔断日志 → 真·系统级资源紧张
- **处理建议**（给客户）:
  1. **业务侧请客户在故障复现时同时确认**：
     - 笔记本是否插着电源？是否切换过电源模式（高性能 ↔ 平衡 ↔ 节能）？
     - 设备温度（CPU/GPU 是否触发 thermal throttling）？任务管理器中的 CPU/GPU 频率曲线
     - 同时段是否启动了其他高占用应用（系统更新 / 杀毒扫描 / 云盘同步 / 浏览器视频 / 录屏）
     - **环境光是否变化**（弱光会让 USB 摄像头自动延长曝光 → 自动降帧到 12~15fps，与"capture fps 25→14"高度吻合）
     - 摄像头驱动是否开启「自动曝光/动态帧率」，必要时设为「固定帧率」
  2. **数据补充**：让客户用 perfmon / HWiNFO 记录 CPU/GPU 温度、频率、占用，重现时对齐时间戳
  3. **SDK 行为说明**：当前 QoS 降到 100kbps/8fps 是**正常的保护性降级**，不是 bug
  4. **不要做的事**：不要建议客户换美颜厂商；不要建议客户改 SDK 编码参数（无法解决采集源头问题）；不要把案例当成 SDK bug 提单
- **与 §10.6（单链路美颜）区分**:
  | 特征 | 本模式（系统级资源紧张） | 单链路美颜性能问题 |
  |---|---|---|
  | `camera_safe_wrapper` 真实 capture fps | ✅ 同步下降（25→14） | ❌ 正常（采集帧率不变） |
  | `audio_recorder_wasapi` bad wait duration | ✅ 同步抖动（>100ms） | ❌ 正常 |
  | `On render frame freeze` | ✅ 经常出现 | ❌ 极少出现 |
  | 美颜耗时变化形状 | 突变 + 与其他链路同时发生 | 渐变 / 进房后稳定偏高 |
  | 故障是否长时间不恢复 | ✅ 一旦发生持续偏低 | 取决于负载，可能恢复 |
  | 设备类型 | 笔记本（长会） / 共用 GPU 设备 | 台式机也可能 |
  | 整改方向 | 排查系统资源（电源/温度/抢占） | 优化美颜插件性能 |
- **关联仪表盘特征**:
  - "采集帧率"曲线（来自 `pixel_frame_track` 入口） = `camera_safe_wrapper` 的 `capture fps`，故障时跌一半
  - "发送帧率"被 QoS 限制到 4~8fps，"qos 下发码率"降到 100kbps
  - 故障后整段时间帧率/码率持续偏低、剧烈波动、不恢复 = 系统资源持续紧张的特征

---

### §10.12 美颜单点劣化引发的反压级联（伪多链路异常） ⭐⭐⭐

> **重要补充：§10.11"多链路 = 系统级"模式的反例**。美颜单点劣化通过 CPU 反压 + 调度抢占，能让"看起来像多链路同步异常"的现象出现。

- **平台**: Windows（DSHOW 采集 + 第三方美颜场景高发，与版本无关）
- **关键字**: `kExternalBeautyFilter:\d{3}`（三位数）, `Change to low performance mode`, `Load rate overload.*liteav_video_preprocess`, `RunTask took\(ms\): \d{3,}`, `Abnormal uplink cost.*capture cost:\d{3}`, `Drop frame because low performance.*continue drop`
- **典型客户描述**: "用了 7~30 分钟一切正常，突然画面卡了，仪表盘上采集帧率从 24 跌到 20 以下，前处理帧率掉到 4~10，CEF 界面也卡，但音频没事或只轻微抖动"
- **日志特征**（**判别公式：①+② 必须命中，③④⑤ 同时出现的概率极高**）:
  ```
  # ① 美颜耗时"断崖式突变"（关键特征，区别于真·系统级紧张）
  [filter_cost_time_stats.cc:87] Filters total cost time=9ms  {kExternalBeautyFilter:8, }   ← 故障前稳定 8ms 持续数分钟
  [filter_cost_time_stats.cc:87] Filters total cost time=14ms {kExternalBeautyFilter:12, }  ← 故障前 10s 开始爬升
  [filter_cost_time_stats.cc:87] Filters total cost time=117ms{kExternalBeautyFilter:103,}  ← ⚠️ 一秒内跳到 10x

  # ② 前处理熔断不可逆（强证据，一旦命中本次推流必走降级）
  [E] [video_filter_chain_v3.cc:365] Change to low performance mode. time_cost=117
  # 之后 QoS 持续把 fps 钳在 8~12，码率压到 100~250kbps，本次推流不再恢复

  # ③ 前处理线程被打满（与 ① 同步出现）
  [thread_manager.cc:945] Load rate overload exception. bizid=liteav_video_preprocess, value=90
  [thread_manager.cc:945] Max task cost exception. bizid=liteav_video_preprocess, value=1047
  {303:, 100%, 200ms, 181ms, 10, 1, 1047ms, 442ms}                     ← bizid=303 load_rate=100%

  # ④ 反压传播到采集线程（capture cost 飙升 = DSHOW 回调线程在 WriteFrame 里被阻塞）
  [video_encoder_monitor.cc:122] Abnormal uplink cost:254ms, capture cost:31ms,  preprocess cost:208ms  ← 刚开始
  [video_encoder_monitor.cc:122] Abnormal uplink cost:930ms, capture cost:388ms, preprocess cost:529ms  ← capture cost 飙到 388ms
  [camera_safe_wrapper.cc:620] VideoStatsInfo capture fps:14                                          ← 故障前 24
  [pixel_frame_track_impl.cc:120] Drop frame because low performance, total:11 continue drop:1        ← Track 覆盖丢帧（容量=1）
  [pixel_frame_track_impl.cc:120] Drop frame because low performance, total:4932 continue drop:1      ← 累计快速增长

  # ⑤ CEF / 渲染线程被波及（CPU 时间片被前处理线程吃满，OS 调度抢占）
  [video_renderer_controller.cc:723] Render slowly, external_present: max:197.7ms, avr:0.66ms
  [render] On render frame freeze: 1053ms, immediate 1 fps
  [task_annotator.cc:139] posted_from: video_preprocessor_v3.cc:158 RunTask took(ms): 1047

  # ⑥ 音频可能轻度抖动也可能正常（这是与"真·系统级紧张"的关键区别！）
  [audio_recorder_wasapi.cc:657] bad wait duration: (17-191 ms)   ← 可能偶发，但不会持续
  # 在大多数美颜反压案例中，音频 bad wait duration 仍然只是几毫秒级
  ```
- **含义**:
  - 第三方美颜插件单帧耗时突变（如从 8ms 跳到 100~200ms），导致：
  - **直接后果**：`liteav_video_preprocess` 线程被打满（load_rate 100%），filter chain 10s 滑窗均值越过阈值（约 50ms）→ 触发 `Change to low performance mode` **不可逆熔断**
  - **反压后果 A（采集 fps 假象）**：DSHOW 回调线程在 `OnPixelFrameAvailable` 里同步调用 `WriteFrame`，因下游 PostTask 入队抢锁、引用计数操作变慢被阻塞数百毫秒，导致 `VideoStatsInfo capture fps` 从 24 跌到 14。**但摄像头硬件本身仍在以 24fps 出帧**
  - **反压后果 B（CEF/渲染卡顿）**：前处理线程吃满 CPU 核，OS 调度器让 CEF 主线程、SDK 渲染线程拿不到时间片，表现为 `external_present` 卡 200ms、`On render frame freeze: 1000ms+`
  - **反压后果 C（音频可能轻微）**：WASAPI 麦克风可能也被抢占而出现 `bad wait duration: 17-191ms`，但通常远比"真·系统级紧张"轻微
- **因果链**（精确版）:
  ```
  第三方美颜单帧耗时突变（8ms → 100~200ms）
        │
        ├──▶ liteav_video_preprocess load_rate 99~100%
        │       │
        │       ├──▶ filter chain 10s 均值 >50ms
        │       │       └──▶ ⚠️ Change to low performance mode【不可逆熔断】
        │       │               └──▶ QoS 持续压制 fps 8~12, 码率 100~250kbps（本次推流不恢复）
        │       └──▶ PixelFrameTrack 持续被覆盖
        │               └──▶ Drop frame because low performance（累计快速增长）
        ├──▶ DSHOW 回调线程在 WriteFrame 中被反压
        │       └──▶ capture cost 飙到 200~400ms
        │               └──▶ VideoStatsInfo capture fps 24→14（统计值，硬件仍是 24fps）
        └──▶ 前处理线程独占 CPU 核 → OS 调度抢占其他线程
                        ├──▶ CEF 主线程卡顿
                        ├──▶ 渲染线程 freeze 1000ms+
                        └──▶ WASAPI 偶发 bad wait（轻微）
  ```
- **⭐ 三模式鉴别表**（本模式 vs §10.11 真·系统级 vs §10.6 单纯美颜耗时高）:

  | 特征 | 本模式（美颜反压级联） | 真·系统级资源紧张（§10.11） | 单纯美颜耗时（§10.6） |
  |---|---|---|---|
  | 美颜耗时变化形状 | ⭐ **突变**（8ms→100ms+，秒级） | 与其他链路同步爬升 | 渐变或进房即偏高 |
  | 美颜单帧耗时绝对值 | >80ms（常达 100~200ms） | 60~100ms | 30~60ms |
  | `Change to low performance mode` | ✅ **必然命中**（强证据） | 可能命中 | ❌ 通常不命中 |
  | `VideoStatsInfo capture fps` | ✅ 下降（反压所致） | ✅ 下降（硬件慢） | ❌ 正常 |
  | `Abnormal capture cost` | ✅ 200~400ms（反压拖累） | 可能 100~200ms | < 50ms |
  | `Load rate overload (303)` | ✅ 必然命中, 99~100% | 可能命中 | < 80% |
  | `bad wait duration` 音频 | 轻微（10~50ms 偶发） | ⭐ 显著且持续（100~300ms） | ❌ 正常 |
  | `On render frame freeze` | ✅ 经常（数百 ms） | ✅ 经常 | ❌ 极少 |
  | 故障与笔记本电源/温度变化 | ❌ 无关 | ⭐ 强相关 | ❌ 无关 |
  | 故障持续时间 | 直到关闭推流（熔断不可逆） | 取决于系统状态，可能恢复 | 持续整段 |
  | 整改方向 | **优化美颜插件单帧耗时** | 排查系统资源/电源/温度 | 优化美颜参数/分辨率 |

- **快速判别公式（< 1 分钟）**：
  ```
  if Change to low performance mode 命中  &&  kExternalBeautyFilter:\d{3} (三位数耗时):
      → 本模式（美颜反压级联）  整改：让客户优化美颜单帧耗时
  elif bad wait duration 持续 >100ms  &&  美颜耗时也异常  &&  无熔断或熔断很晚:
      → 真·系统级资源紧张  整改：排查电源/温度/抢占
  elif 美颜耗时 30~60ms  &&  capture cost 正常  &&  WASAPI 正常:
      → 单纯美颜耗时高  整改：优化美颜参数
  ```
- **⛔ 落锤陷阱**:
  1. **不要看到 `VideoStatsInfo capture fps:14` 就说"摄像头硬件卡住了"**——这个统计点包含了下游反压。本模式中硬件可能仍是 24fps
  2. **不要看到"采集 + 音频 + 渲染都异常"就直接落锤"系统级资源紧张"**——必须用三模式鉴别表精确区分
  3. **不要建议客户重启推流就能恢复但不告诉他为什么**——明确告知 `Change to low performance mode` 熔断机制，让他理解"为什么卡过之后再也没恢复"
- **处理建议**（给客户）:
  1. **直接结论**：第三方美颜插件单帧耗时从正常的 8ms 突增到 100~200ms 是根因。SDK 检测到前处理 10 秒均值超阈值后触发了不可逆的低性能熔断保护，所以本次推流期间帧率/码率不会回到正常水平
  2. **临时缓解**：让客户重新进房（重启推流）以复位熔断状态，或在故障复现时立即关闭美颜插件验证
  3. **根因排查**（让美颜厂商查）:
     - 故障时间点美颜内部是否触发了人脸检测/AI 模型重加载、贴纸切换、特效启动
     - 美颜插件内部线程模型：是否独立线程？是否塞进 SDK 的前处理线程跑？是否走 GPU？
     - 故障时整机 CPU/GPU 占用曲线
  4. **SDK 侧无需修改**：当前 latest-wins 覆盖式 Track + 不可逆熔断都是有意设计（防止反压到摄像头硬件假死、防止抖动反复降级），不是 bug
  5. **客户长期方案**:
     - 让美颜厂商把单帧耗时控制在 25ms 以内
     - 若必须用重美颜，建议启用硬件编码、降低编码分辨率减轻总 CPU 压力
     - 应用层监听 `onWarning` 中的视频渲染相关警告事件，自动提示用户
- **关联仪表盘特征**:
  - 后台仪表盘"采集帧率"曲线 = `pixel_frame_track` 入口的有效帧率 = `VideoStatsInfo capture fps`
  - 一旦熔断，后续整段曲线钉在 8~12 fps，不会自行回升（与"真·系统级紧张"故障消失后能恢复不同）

---

### §10.13 屏幕分享 Pause 后 Start 被 `is_started_` 状态残留拦截 → 采集器未启动 → 黑屏 ⭐⭐

- **平台**: Windows（影响所有使用 ScreenSafeWrapper + ScreenCaptureSessionWin 的版本）
- **关键字**: `OnScreenSharingPaused`, `kWindowHidden`, `StartScreenCapture`, `SetCaptureParams`, `Start failed, capture has already started`
- **日志特征**:
  ```
  # ① 上一次屏幕分享被 Pause（窗口隐藏），之后没有 Stop
  [E][screen_safe_wrapper.cc:525] OnScreenSharingPaused: window_id = XXXXX, reason = kWindowHidden = 3
  # （之后无 OnScreenSharingStopped / StopScreenCapture 日志）

  # ② 跨 session（退房+进房）后再次 Start 屏幕分享
  [I][trtc_pipeline_video.cc:687] SetCaptureParams [stream_type:BigStream|source=kScreenShare|source_id=YYYYYY]
  [I][trtc_pipeline_video.cc:604] StartScreenCapture [stream_type:BigStream]
  [I][local_video_channel.cc:132] [BigStream]UpStream - start             ← 上行通道已开
  [I][video_encoder_wrapper.cc:381] Start encoder                          ← 编码器已启动

  # ③ 关键缺失：无以下任何日志！
  # - 无 "Start new screen capture: config = ..."（screen_safe_wrapper.cc）
  # - 无 "Start screen capture with type: config = ..."（screen_capture_session_win.cc）
  # - 无 OnScreenCaptureFirstFrame / OnVideoCaptureFirstFrame [type:BigStream|window_id:...]
  # - 无 "Received first input frame for preprocessor"
  # - 无 content type changed to kScreenCapture

  # ④ 编码器等待输入帧超时，业务层主动停止
  [I][trtc_pipeline_video.cc:664] StopScreenCapture [stream_type:BigStream]    ← 7~11s 后放弃
  ```
- **含义**:
  - `ScreenCaptureSessionWin::Pause()` **不修改** `is_started_` 标志（只有 `StartCapture()` 设 true、`Stop()` 设 false）
  - `ScreenSafeWrapper` 的 `status_` 被设为 `kPaused`，但底层 `is_started_` 仍为 `true`
  - 同一 `TRTCCloud` 实例退房+再进房时，`TRTCScreenCapturer` 和底层 `ScreenCaptureSessionWin` 不会被销毁
  - 再次 `StartScreenCapture` 时：`ScreenSafeWrapper` 检查 `status_ == kPaused`（≠ kStarted）不拦截 → `StartNewScreenCapture` 复用旧 capturer → `ScreenCaptureSessionWin::Start()` 检查 `is_started_ == true` → **打印 WARNING 并 return！采集器未实际启动**
  - 编码器/上行通道正常等待输入帧 → 永远等不到 → **黑屏**
- **鉴别要点**（< 3 分钟）:
  1. 搜索 `OnScreenSharingPaused.*kWindowHidden` → 确认上一次屏幕分享被窗口隐藏事件暂停
  2. 确认 `OnScreenSharingPaused` 之后到下一次 `StartScreenCapture` 之间**没有** `StopScreenCapture` / `OnScreenSharingStopped` / `DoStop`
  3. 确认下一次 `StartScreenCapture` 之后**缺失** `Start new screen capture` 日志
  4. 确认上行通道和编码器正常启动但无帧进入（无 `Received first input frame`、无 `content type changed`）
  5. 可选：如果日志级别够低能看到 `Start failed, capture has already started` 则是铁证
- **与其他屏幕分享黑屏问题区分**:
  | 特征 | 本模式（is_started_ 残留） | WGC 初始化超时 | 窗口最小化无帧 | 显卡不兼容 |
  |---|---|---|---|---|
  | 有 OnScreenSharingPaused 前置 | ✅ 必然 | ❌ 无 | ❌ 无 | ❌ 无 |
  | "Start new screen capture" 日志 | ❌ **缺失** | ✅ 有 | ✅ 有 | ✅ 有 |
  | OnScreenCaptureFirstFrame | ❌ 永远不会出现 | ✅ 最终会出现 | ❌ 不出现 | ❌ 不出现 |
  | 换窗口后是否仍黑屏 | ✅ **是**（is_started_ 未重置） | ❌ 可能好 | ❌ 换可见窗口好 | ⚠️ 取决于窗口 |
  | Stop 后再 Start 是否恢复 | ✅ **是**（Stop 重置 is_started_） | — | — | — |
- **处理建议**:
  1. **对客户（临时规避）**：在每次 `StartScreenCapture` 之前先调用 `StopScreenCapture`，确保底层状态被完全重置
  2. **对 SDK 研发（修复方案）**：StartNewScreenCapture 中复用旧 capturer 前先 Stop；或 Pause 时重置 is_started_
- **详细诊断链路**：见 `trtc-screen-share-diagnostics.md` §6 Bug 1

---

### §10.14 MAG 采集器失败 → DXGI 降级 → addExcludedShareWindow 失效 ⭐⭐

- **平台**: Windows（属于平台兼容性问题）
- **关键字**: `Failed to capture frame by MAG`, `Failed to select perfect matched capturer`, `Selected capturer is DXGI`, `Before frist normal frame,.*blank frame`, `magnifier_capturer.cc`
- **典型客户描述**: "屏幕分享时 addExcludedShareWindow 调用后窗口仍出现在分享画面中，某台电脑必现"
- **日志特征**:
  ```
  # ① MAG 采集器并行尝试，持续产出空白帧（核心证据）
  [W][magnifier_capturer.cc:1097] [MAG] Before frist normal frame,10 blank frame(s) captured, and 628ms passed.
  [W][capturer_controller_core.cc:171] Failed to capture frame by MAG

  # ② 系统降级到 DXGI（必然结果）
  [W][capturer_controller_core.cc:467] Failed to select perfect matched capturer.
  [I][capturer_controller_core.cc:480] Selected capturer is DXGI

  # ③ addExcludedShareWindow 调用（此时采集器已是 DXGI，调用无效）
  [I][trtc_cloud.cc:1270] Electron: AddExcludedShareWindow, window_id:XXXXXX
  ```
- **含义**:
  - MAG (Magnification API) 是唯一支持窗口排除的采集方案
  - DXGI (Desktop Duplication API) 是全屏级采集方案，获取整个桌面位图副本，**不支持按窗口裁剪**
  - WGC 和 GDI 也不支持窗口排除
  - 当 MAG 因显卡/驱动兼容性问题无法正常采集（仅产出空白帧）时，SDK 自动降级到 DXGI，此时所有 `addExcludedShareWindow` 调用均无效
- **因果链**: Intel Graphics GPU + 特定系统版本 → MAG 无法产出有效帧 → 降级 DXGI（全桌面复制，无窗口裁切能力）→ addExcludedShareWindow 无效
- **鉴别要点**:
  1. 搜索 `Failed to capture frame by MAG` → 确认 MAG 采集器失败
  2. 搜索 `Failed to select perfect matched capturer` → 确认发生了降级
  3. 检查降级后的采集器类型 → 如果是 DXGI，则窗口排除不可能生效
  4. 确认所有 `AddExcludedShareWindow` 调用之后，采集器未曾切换到 MAG 或 WGC
- **处理建议**:
  1. **首选方案**：更新显卡驱动到最新版本（Intel Graphics 驱动），看 MAG API 是否能恢复正常
  2. **次选方案**：改用窗口级 WGC 采集 + 业务层裁剪，手动判断要排除的区域
  3. **临时规避**：要求用户手动最小化不需要出现在分享中的窗口（最小化窗口系统不渲染其像素）
  4. **不推荐**：不建议客户强制使用 GDI 模式（性能最差，且也不支持窗口排除）

---

### §10.15 DirectShow 摄像头启动失败 hr=0x80040217（VFW_E_CANNOT_CONNECT / IDispatch error #23）的正确归因 ⭐⭐

- **平台**: Windows（DirectShow 采集通用问题，非特定版本 bug）
- **关键字**: `Failed to set camera capability`, `run media control failed`, `hr = 0x80040217`, `IDispatch error #23`, `kCameraStartFailed`, `OnCameraError`, `code:1117`, `Video: Start camera failed`, `camera_device_directshow.cc`
- **典型客户描述**: "摄像头打开失败/本地预览黑屏，日志报 IDispatch error #23"
- **日志特征**:
  ```
  [E][camera_device_directshow.cc:316][camera-capture] Failed to set camera capability: result = 0x80040217: IDispatch error #23
  [E][camera_device_directshow.cc:xxx] Start camera failed, run media control failed, hr = 0x80040217: IDispatch error #23
  [I][camera_safe_wrapper.cc:484] Camera start: result = kCameraStartFailed = 3
  [W][trtc_camera_capturer2.cc:262] OnCameraError [type:BigStream|code:1117|message:Video: Start camera failed.]
  [I][trtc_cloud_callback.cc:55] Electron: onWarning, errorCode:1117, errorMessage:Video: Start camera failed.
  ```
- **含义**: `0x80040217` = DirectShow 的 `VFW_E_CANNOT_CONNECT`（"无法在过滤器之间建立连接"），本质是**摄像头输出 pin 与下游 filter 的 media type 协商失败 / 图无法启动**，与"分辨率/帧率/格式"直接相关
- **⭐ 正确归因（避免误判）**：不同根因对应**不同 HRESULT**，不能把 0x80040217 一律当成"设备被占用"或"权限问题"：

  | 根因 | 典型 HRESULT | 是否报 0x80040217 |
  |---|---|---|
  | 请求分辨率/帧率/格式设备不支持 | `0x80040217` | ✅ 最直接、最常见，**换分辨率即解** |
  | USB 带宽/供电不足 | `0x80040217` 居多 | ✅ 本质是格式在当前总线交付不了，**降分辨率同样解** |
  | 被其他进程独占 | 常见 `0x800705AA` / `0x80070020`(SHARING_VIOLATION)，部分 UVC 驱动退化成 `0x80040217` | ⚠️ 有时会 |
  | 系统相机隐私/权限被关 | `0x80070005` E_ACCESSDENIED | ❌ 一般不是这个码 |
  | 驱动崩溃/设备错误/掉线 | `E_FAIL` / `0x8007001F` 等 | ❌ 一般是别的码 |

- **关键鉴别点**：
  1. **"同一格式时好时坏"**（如当天早上同分辨率能采集、晚些时候失败）→ 静态"格式不支持"解释不了，**更可能是运行时被其他进程抢占或 USB 带宽争抢**
  2. 若同时出现 `0x80070005`，才考虑权限/隐私被关
  3. "降分辨率能好"对"格式不支持"和"带宽不足"两类都有效，但当属"时好时坏"时，真正诱因往往是那一刻的占用/带宽，降分辨率只是缓解表现
- **处理建议**:
  1. **首选**：降低采集分辨率/帧率（如 1280x720 → 640x480）
  2. 复现时查任务管理器确认是否有其他会议软件/浏览器/系统相机服务/另一实例占用摄像头
  3. 检查 Windows 相机隐私开关（若配 `0x80070005`）
  4. 更新/重装驱动，USB 直插主板口避开扩展坞
  5. 用系统"相机"App/AMCap 验证是否系统级也失败
- **典型案例**: 内置摄像头（USB 接口），请求 1280x720@15，能力列表含对应格式，当天 00:00 采集正常、19:01 同一格式启动失败 → 判为运行时占用/带宽争抢而非静态格式不支持

---

## 关联文档

- 音频模块完整诊断链路（AudioDeviceModule/3A/watchdog/黑盒测试） → `trtc-audio-diagnostics.md`
- 屏幕分享模块完整诊断链路 → `trtc-screen-share-diagnostics.md`
- 分析决策树（症状 → 搜索 → 根因） → `trtc-analysis-playbook.md`
- 已知问题速查 → `trtc-known-issues.md`
