# TRTC SDK 版本发布历史（日志分析用）

> 日志中 SDK 版本格式为 `Major.Minor.Patch.Build`（如 `12.8.0.16983`）。
> 用途：从日志中的版本号判断平台、发布时间、是否命中已知问题、是否建议升级。

---

## 版本号编码规则

格式：`Major.Minor.Patch.BuildNumber`，**BuildNumber 范围区分平台**：

| Build 段 | 平台 |
|----------|------|
| `14xxx` | Android（早期） |
| `15xxx` | Windows（11.x / 12.0~12.5 时代） |
| `16xxx` | Windows（12.6+ 统一格式后）/ iOS（11.x 时代） |
| `17xxx` | Android（12.3+）/ Windows（13.x） |
| `18xxx` | iOS/Mac（12.x 时代） |
| `19xxx` | iOS/Mac（12.6+）/ Android（12.6+） |
| `20xxx` | iOS/Mac（13.x）/ Android（13.x） |
| `6xxx`/`7xxx` | OHOS（鸿蒙） |

### 快速版本识别

日志中搜索：
```
SDK Version:X.Y.Z.BUILD
GetSDKVersion, version:X.Y.Z.BUILD
```

示例：`SDK Version:12.8.0.16983 Device Name::MateBook D/13th Gen i5-13420H/UHD Graphics System Version:10.0.26200.8037`
→ SDK 12.8（2025-04 发布），Windows 平台，华为 MateBook D 笔记本。

---

## 版本线说明

| 版本线 | 适用平台 | 说明 |
|--------|---------|------|
| 主线 | iOS/Android/Windows/Mac | 四大平台共用版本线 |
| Linux UOS | 桌面 Linux 发行版 | 独立版本线 |
| Linux TransportSDK | 服务端/嵌入式 Linux | 独立版本线 |
| HarmonyOS (OHOS) | 鸿蒙 | 随主线，12.1 起支持 |
| Flutter | 跨平台 | 随主线，基于 C 接口 FFI |
| Unity | 游戏引擎 | 随主线，基于 C++ 接口 |
| Electron | 桌面跨平台 | 基于 Windows/Mac SDK |

---

## 版本发布时间线

| 版本 | 发布/拉分支时间 | 已知构建号举例 |
|------|---------------|---------------|
| 13.3 | 2026-04 | iOS/Mac 13.3.20845；Win 13.3.0.17944；Android 13.3.0.20247 |
| 13.2 | 2026-02 | — |
| 13.1 | 2026-01 | Win 13.1.0.17562/17563 |
| 13.0 | 2025-11 | — |
| 12.9 | 2025-10 | Win(Electron) 12.9.0.17165 |
| 12.8 | 2025-04 | Win 12.8.0.16983（主发布）/16972/19691(patch)；12.8.1.6902(patch) |
| 12.7 | 2025-04 | iOS/Mac 12.7.0.19272；Win 12.7.0.16768；Android 12.7.0.19072 |
| 12.6 | 2025-02 | iOS/Mac 12.6.0.18866；Win 12.6.0.16559；Android 12.6.0.17772；OHOS 12.6.0.7537 |
| 12.5 | 2025-01 | iOS/Mac 12.5.18359；Win 12.5.16383；Android 12.5.17567 |
| 12.4 | 2024-12 | iOS/Mac 12.4.17856；Win 12.4.16164；Android 12.4.17372 |
| 12.3 | 2024-11 | iOS/Mac 12.3.16995；Win 12.3.15893；Android 12.3.0.17115；OHOS 12.3.0.6950 |
| 12.2 | 2024-10 | iOS/Mac 12.2.16945；Win 12.2.15661；Android 12.2.15065 |
| 12.1 | 2024-09 | iOS/Mac 12.1.16597；Win 12.1.15400；Android 12.1.14886；OHOS 12.1.0.6493 |
| 12.0 | 2024-08 | iOS/Mac 12.0.16266；Win 12.0.15124；Android 12.0.14661 |
| 11.9 | 2024-06 | iOS/Mac 11.9.15963；Win 11.9.15031；Android 11.9.14445 |
| 11.8 | 2024-04 | iOS/Mac 11.8.0.15669；Win 11.8.0.14953；Android 11.8.0.14176 |

---

## 各版本核心变更与已知问题（日志关键字视角）

### 13.3

- encoder 默认使用 v3 版本
- 修复宽高比决策条件错误（候选项宽/高/帧率均需 >= 请求值）
- 屏幕分享全平台层支持三种编码分辨率计算模式
- Android loopback 消除第三方 app 声音，增加 200ms 采集处理延时
- 修复 iOS 锁屏后 loopback 被系统停止、上层无法感知的问题
- 音频：`capture_energy` 改为双声道 mix 后的能量值；无声率统计去除 VAD 检测（避免误报）；AMDF AIEC 使用 32K 处理解决 8K 附近啸叫
- NetworkGlobalInit 相关全局变量改为调用时构造（影响启动时序）

**日志关键字**：`encoder v3`、`capture_energy`、`VAD`、`AMDF AIEC 32K`、`NetworkGlobalInit`、`loopback` + `NotifyBroadcastExtFinished`

### 13.2

- 智能降噪场景识别（自动识别环境噪声类型）；KTV 场景 AI 回声消除
- 画质增强模块安全运行环境检测 + 资源加密；视频降噪算法优化（减少色彩拖影）
- 鸿蒙支持双路上行推流和音视频自定义采集
- Android 异常无声场景识别（检测后台采集受限）
- 已修复：Windows 图形设备丢失后未切换备用渲染、Mac 连接 iPhone 后可能采集无声、iOS VideoZoomFactor 崩溃、Android 超分切换内存泄漏、Android 屏幕分享授权等待期间更新编码参数异常、鸿蒙快速切换视图渲染中断（黑屏）、Linux 系统混音漏回声

### 13.1

- HIFI2 音效模式（`SetAudioQualityEx`）；美声（Voice Beautifier）预设
- 设备打分查询能力；下行 1080P 超分增强；多通路传输弱网提示与链路切换回调
- NTP 定时对时机制（解决设备时钟漂移）；Mac 窗口最小化后自动暂停屏幕采集
- 已修复：多 BGM 同时上行时短 BGM 播完影响长 BGM、本地录制重音、Windows 多端 Loopback 啸叫、Windows 屏幕分享添加排除/额外窗口不生效、优先拉小流时进退房偶现小流画面卡住、音频静音未及时同步导致音频位闪烁、Mac 屏幕分享多文档窗口切换黑屏闪烁、iOS 4K 采集前后置切换异常、Android 联发科芯片硬解 64x64 不出帧、OnNetworkQuality 自动重进房后回调异常、自定义加解密进房后音视频交互异常、私有化进房失败

**日志关键字**：`SetAudioQualityEx`、`VoiceBeautifier`、`NTP`、`pauseScreenCapture`/`resumeScreenCapture`

### 13.0

- AI 转录/翻译全平台 API（callExperimentalAPI）；HEVC 回退 AVC 码率补偿；HEVC 硬件编解码成功率上报
- Loopback 回声消除升级为自研算法；Windows 播放支持配置开关系统音效处理
- Android 硬解超低延迟策略（默认开启）；Windows AMD 显卡硬编安全模式
- 已修复：**13.0 私有化进房失败（重要已知问题）**、iOS 屏幕分享切自定义采集推流失败、快直播音频减速音画不同步、断网重连失败、iOS/Android HLS 播放结束 crash、Android 数据持久化越界崩溃、Mac 演讲者模式副屏分享失败、Windows 内置美颜丢失透明通道、进房前 startLocalAudio:Music 进房后变通话音量、Windows 低端 N 卡驱动 `nvEncGetLastErrorString` 空指针崩溃、鸿蒙自定义预处理 appfreeze、SEI 消息处理崩溃

**日志关键字**：`use dsp to cancel echo`（自研 Loopback AEC 生效）、`HEVC`/`H265`、`nvEncGetLastErrorString`、`appfreeze`

### 12.9

- Live Flutter 接口支持 Mac & Windows；Android Multi-DRM 播放；单推清晰优先模式
- iOS 屏幕分享采集回调日志（`CapturerStarted/Stopped/Paused/Resumed`）
- 已修复：退出后重进房 AI 降噪不生效、对端停止推流时可用性回调缺失、音画同步接收间隔阈值异常、观众进房配置获取失败、垫片帧率过高、Mac(Intel) 编码极小分辨率 crash、Windows H265 软解误开、水印插件多线程安全、回声消除模式降级时声道配置未切换、自定义渲染混流画面闪烁（Android）

**日志关键字**：`CapturerStarted` 等、`AI_ANS`、`mute_image`

### 12.8

- Windows AMD 硬编 B 帧自动检测修复；iOS CVPixelBuffer 引用计数优化；鸿蒙硬件编码
- iOS/Mac 采集模块出帧监控定时器；Android AAudio 路由切换检测
- 已修复：iOS CVPixelBuffer 转 NSData 通道拷贝错误、Android 摄像头打开失败后无法重开、Windows H265 解码失败时解码线程死循环、水印旋转镜像后位置异常

**日志关键字**：`AMD`/`B frame`、`CVPixelBuffer`、`AAudio`、`camera_safe_wrapper`、`kExternalBeautyFilter`（外部美颜插件耗时）、`video_encoder_monitor`

### 12.7

- 暂停/恢复远端音频流隐藏接口；低延迟模式优化；Android 异步解码端到端延迟降约 80ms
- 已修复：**AMD 硬件编码器不出 IDR 帧**、Intel 显卡硬编 HEVC 参考帧标记错误导致播放卡顿、退房后音效未重置、自研 3A 声道选择导致爆音

**日志关键字**：`IDR`、`HEVC`/`reference frame`、`3DSpatial`

### 12.6

- TRTC C 接口部分 API（Flutter FFI）；自定义音频渲染 `OnMixedAllAudioFrame` 回调
- 已修复：LivePlayer TRTC 上行 + CDN 播放音频同步问题、华为 P30 Pro 视频拼接蓝线、特定配置上下麦偶现无声

### 12.5

- 视频超分辨率增强（SR Enhancement）；CDN 推流弱网重连策略；Android 后台切换采集恢复
- 已修复：部分机型摄像头采集问题、iOS 循环播放 pause 无效、macOS 窗口采集 scale 计算问题
- **已知问题**：Windows 12.5 麦克风采集无声 —— 关键字 `get capture device boost info failed` / `0x80070490`

### 12.4 ~ 12.0 要点

- 12.4：iOS/Mac 采集模块 3 秒无帧重启机制；已知问题：Dashboard 卡顿率显示超 100%
- 12.3：均衡器预设；已修复退房后均衡器/混响音效未重置
- 12.1：**鸿蒙平台支持**、视频编码器健康度检测；已修复 Windows 屏幕分享选择 QQ 音乐白屏、超时重进房 QosAppScene 同步不正确
- 12.0：**至臻画质**（B 帧/AQ/ROI）、**智能 3A**（自动 AEC/ANS/AGC）；已修复快速进退房收不到 onEnterRoom 回调
- 12.0 日志关键字：`3AConfigDecider`、`at_quality`/至臻画质、`encoder_health`、`o264`/`O264rt`（内部软编码器）

### 11.9 / 11.8 要点

- 11.9：视频卡顿监控；已修复 iOS 17.4+ 长时间推流码率下降、Windows 硬编出错无法切软编
- 11.8：**Mac ScreenCaptureKit (SCK) 桌面采集**（macOS 12.3+ 默认）；已修复 Mac 扬声器切 HDMI 无声
- 11.8 日志关键字：`SCK`/`ScreenCaptureKit`、`onLocalProcessedAudioFrame`

---

## 内部模块对照表（从日志源码路径识别问题归属）

| 日志源码路径/前缀 | 内部模块 | 负责领域 |
|------------------|---------|---------|
| `trtc_cloud.cc` | sdk 层 | 接口调用/转发 |
| `trtc_pipeline_network.cc` | trtc/network | 网络传输层 |
| `audio_recorder_wasapi` | audio (Windows) | WASAPI 音频采集 |
| `audio_loopback_service_impl.cc` | audio/loopback | 系统音频采集 |
| `camera_safe_wrapper.cc` | video/capture | 摄像头安全包装 |
| `video_encoder_monitor` | video/encoder | 编码器监控 |
| `o264_encoder_impl.cc` | video/encoder | 内部 o264 软编码器 |
| `screen_capture_session_win` | video/screen | Windows 屏幕采集 |
| `screen_safe_wrapper` | video/screen | 屏幕采集安全包装 |
| `wgc` | video/screen | Windows Graphics Capture |
| `liteav_video_preprocess` | video/preprocess | 视频前处理 |
| `3AConfigDecider` | audio/3A | 智能 3A 策略 |
| `audio_system_api_wasapi` | audio (Windows) | 音频系统接口 |

---

## 版本升级建议参考

| 日志中看到的版本 | 距最新版本差距 | 升级优先级 |
|-----------------|---------------|-----------|
| 11.x | 差 2+ 个大版本 | ⚠️ 强烈建议升级 |
| 12.0~12.5 | 差 1+ 个大版本 | 建议升级 |
| 12.6~12.9 | 差 0.5~1 个大版本 | 建议评估升级 |
| 13.0~13.2 | 差 0~1 个小版本 | 按需升级 |
| 13.3 | 最新 | 无需升级 |

> 注意：版本线不同不要直接比大小——Linux UOS / Linux TransportSDK 是独立版本线，版本号与主线不可比。
