# TRTC 日志分析决策手册（症状 → 搜索 → 根因）

> 按问题类型分类的分析思路与决策树。先按用户描述的症状定位章节，按步骤搜索日志。
> 深度日志模式（具体日志特征/因果链/鉴别表）见 `trtc-deep-log-patterns.md`。

## 目录

- [1. 分析前准备](#1-分析前准备)
- [2. 无声问题](#2-无声问题)
- [2.5 回声/回声泄漏问题](#25-回声回声泄漏问题)
- [2.6 音频慢放/降八度/watchdog 反复重启](#26-音频慢放降八度watchdog-反复重启)
- [3. 黑屏问题](#3-黑屏问题)
- [4. 卡顿/延迟问题](#4-卡顿延迟问题)
- [4.5 卡死问题（推流突然中断）](#45-卡死问题推流突然中断)
- [4.6 多链路同步劣化的根因鉴别（⭐必读）](#46-多链路同步劣化的根因鉴别)
- [4.7 视频采集链路反压传播机制（⭐必读）](#47-视频采集链路反压传播机制)
- [5. 断流/断连问题](#5-断流断连问题)
- [5.5 掉线/被踢问题](#55-掉线被踢问题)
- [6. 进房失败](#6-进房失败)
- [6.5 退房超时/多进程场景](#65-退房超时多进程场景)
- [7. 设备问题](#7-设备问题)
- [8. 屏幕分享问题](#8-屏幕分享问题)
- [9. 崩溃分析](#9-崩溃分析)
- [10. 仪表盘/监控参考](#10-仪表盘监控参考)
- [11. 退房/踢人原因码参考](#11-退房踢人原因码参考)
- [12. 分析最佳实践（黄金法则）](#12-分析最佳实践黄金法则)

---

## 1. 分析前准备

每次分析日志前，先收集：

1. **基本信息**：SDK 版本号（从日志提取）、平台、问题描述、问题发生的大致时间
2. **解码并获取概览**：
   ```bash
   # 1. 统一入口：识别 + 解码（.clog/.xlog → 文本）+ 时间线（推荐）
   node scripts/analyze-local.js --logs <log_path> --workers 2

   # 或对已解码文本手动提取时间线（进房/退房/错误/网络）
   node scripts/timeline.js --logs <log_file> --workers 2

   # 再按问题时段用 grep/sed 切片，聚焦分析
   ```
   `.clog/.xlog` 只有在已配置可信本地 decoder 时才能由统一入口解码；否则先请用户提供解码后的 `.log/.txt`。
3. **确认 SDK 版本**：不同版本有不同已知问题，先对照 `trtc-sdk-versions.md` 与 `trtc-known-issues.md`
4. **确认 3A 引擎**（音频问题）：搜索 `Enable Tap dsp`，true = 自研 3A（TapDSP）/ false = 天籁 3A

---

## 2. 无声问题

**分析思路：**

```
无声
├── 本地无声（自己说话对方听不到）
│   ├── 第一步：检查 API 调用
│   │   ├── startLocalAudio 是否调用
│   │   ├── muteLocalAudio 是否为 true
│   │   └── setAudioCaptureVolume 是否为 0
│   ├── 第二步：检查日志确认采集链路
│   │   ├── capture first frame 成功 → 采集链路正常
│   │   └── capture first frame 失败 → 设备初始化问题
│   ├── 第三步：查看仪表盘采集音量 ★
│   │   ├── 采集能量极低（<100）→ 检查系统录音设备音量设置 ⭐
│   │   ├── 采集能量正常（>1000）但 3A 后音量为 0 → 检查 setAudioCaptureVolume
│   │   ├── 采集和 3A 后都有值 → 网络传输问题
│   │   └── 采集音量为 0 → 麦克风设备或权限问题
│   └── 第四步：检查 3A 处理状态
└── 远端无声（听不到对方声音）
    ├── 检查 muteRemoteAudio / muteAllRemoteAudio
    ├── 检查 setAudioPlayoutVolume 是否为 0
    ├── 检查扬声器设备
    ├── 检查 onUserAudioAvailable 回调
    └── 检查对方是否正常推流
```

**重要区分**：
- `capture first frame` 成功 ≠ 采集能量正常
- 日志中 `audio_system_api_wasapi.cc` 的错误（如 `0x80070490`）只是硬件增益控制警告，不影响基本采集
- **必须先排除 API 调用问题，再查日志，最后看仪表盘确认采集能量**

**仪表盘对照**：

| 采集能量 | 3A后能量 | 可能原因 | 排查方向 |
|---------|---------|---------|---------|
| 极低（<100） | 0 | 麦克风增益过低 | 检查系统录音设备音量设置 |
| 正常（>1000） | 0 | setAudioCaptureVolume=0 | 检查 SDK API 调用 |
| 正常（>1000） | 正常 | 网络传输问题 | 检查上行码率、网络质量 |
| 0 | 0 | 设备/权限问题 | 检查设备初始化、权限 |

**采集能量极低的排查步骤**（⭐ 沉淀经验）：
1. 确认 API 调用正确（startLocalAudio 已调用，未静音）
2. 确认日志中 `capture first frame` 成功（采集链路正常）
3. 查看仪表盘**音频采集能量**数值（正常几千~几万，异常<100）
4. 指导用户检查系统录音设备设置（Windows：声音设置 → 输入 → 麦克风输入音量调到 70% 以上）
5. 检查声卡控制面板中的麦克风增益设置

### 上行无声 15 类原因速查（按检查难度从易到难）

**API 调用层（最常见，先排除）**：

| # | 现象 / 关键日志 grep | 原因 |
|---|---------------------|------|
| 1.1 | iOS/Mac: `has no microphone permision`；Android: `mic permission denied` | 未申请麦克风权限 / 被其他 app 占用 |
| 1.2 | 检查代码：是否调用了 `startLocalAudio()` | 未启动声音采集 |
| 1.7 | `set hardware(system) record volume` 且 volume 很小（<20） | 误调用系统麦克风静音 API |
| 1.13 | enterRoom 后调用了 `muteLocalAudio(true)` | 误调用本地音频静音 API |
| 1.11 | 当前用户 `role=Audience` | 观众角色不能上行，需 switchRole 切主播 |
| 1.6 | `AudioDevice: set hardware(system) record volume [system volume:N]`，N 较小 | 采集音量设置错误 |

**麦克风设备层**：

| # | 现象 / grep | 原因 |
|---|------------|------|
| 1.3 | `microphone start failed` | 麦克风启动失败（被独占/驱动异常/物理故障） |
| 1.4 | 已调 startLocalAudio 但无音频采集回调 | 设备采集回调不正常，收集完整日志转研发 |
| 1.9 | 日志含 `headset` 类、插上耳机就没声 | 耳机麦克异常（蓝牙耳机常见） |

**应用打断 / 后台**：

| # | 现象 / grep | 原因 |
|---|------------|------|
| 1.5 | `interrupted by other app or system` / `OnAudioInterrupted [AudioDevice: recorder interrupted]` | 被系统电话/其他 app 打断（结束后看到 `resume from interruption` 即恢复） |
| 1.8 | APP 切后台时段 | 切后台导致采集中断；需要后台采集时按平台 API 申请权限 |

**业务逻辑导致**：

| # | 现象 / grep | 原因 |
|---|------------|------|
| 1.10 | 客户在 `onCapturedRawAudioFrame`/`onProcessedAudioFrame` 回调中修改了 audio data 缓冲区 | 修改 data 后未正确写回，或写入静音数据 |
| 1.14 | 持续有上行码率但接收侧解不出 | 上行音频编码异常，收集日志转研发 |
| 1.15 | 业务"频繁创建销毁 TRTC 实例" | 改为 enter/exitRoom 切换房间，复用同一实例 |

**网络层**：1.12 — 监控显示主播持续断连/重连或 rtt > 1s → 主播网络异常。

### 下行无声 6 类原因速查

| # | 现象 / grep | 原因 |
|---|------------|------|
| 2.1 | grep `onUserAudioAvailable`：未搜到或 `bAvailable:0` | 网络层没收到音频数据，转研发 |
| 2.2 | 有 `onUserAudioAvailable bAvailable:1` 但仍无声 | 观众端解码或播放数据异常 |
| 2.5 | 调用了 `setDefaultStreamRecvMode(false, false)` 或 `muteRemoteAudio` | 取消了音频自动订阅 |
| 2.3 | 扬声器/听筒/耳机切换异常 | 播放设备不工作 |
| 2.4 | `set hardware(system) play volume [system volume:N]` N<20 / `switch to handset` / `current play device changed kDeviceEarPhone` | 系统播放音量过低 / 误切听筒 / 用耳机听 |
| 2.6 | 路由切换时 / 蓝牙耳机断开时 | 播放路由异常 |

### Windows WASAPI 设备故障导致的无声（深度诊断路径）

当 API 调用正确、采集曾经正常但**突然无声**时，高度怀疑 WASAPI 设备层面故障：

```bash
# Step 1: 确认 watchdog 是否报告数据中断
grep "Audio total data size is under threshold.*real is 0"
# → real=0 表示采集完全停止；real≈0.5×expect 表示数据断供一半

# Step 2: 确认是否触发了设备重启
grep "is abnormal, current restart count"
# → restart count 递增说明在反复重启

# Step 3: 查找 HRESULT 确定失败原因
grep -E "0x800706BE|0x80040154|0x88890004|HRESULT"
# → 0x800706BE: AudioSrv RPC 故障（最严重，无法自愈）
# → 0x80040154: COM 组件注册失败（通常是 RPC 故障的连锁）
# → 0x88890004: 设备失效（拔出/驱动崩溃，重新插入可恢复）

# Step 4: 查看 IO 状态确认数据产出趋势
grep -E "Within.*ms.*recorder.*produced"
# → produced 0 ms data = 完全无数据

# Step 5: 查看是否有设备切换事件
grep -E "Default device changed|Device added|Device removed"
```

**判别表**：

| watchdog real/expect | 重启结果 | HRESULT | 结论 | 建议 |
|---------------------|---------|---------|------|------|
| real=0 | 反复重启失败 | 0x800706BE/0x80040154 | **AudioSrv RPC 故障** | 重启 Windows Audio 服务或重启系统；排查 Intel SST 驱动冲突 |
| real=0 | 重启成功后恢复 | 0x88890004 | 设备瞬时失效 | 检查 USB/蓝牙连接稳定性 |
| real≈2×expect | 反复重启 | 无错误码 | **采样率不匹配** | 非无声问题，是慢放 → 转 §2.6 |
| real=0, 无重启 | - | E_ACCESSDENIED | 权限问题 | 检查系统隐私设置 |

> 详细分析：`trtc-audio-diagnostics.md`（watchdog 机制 / WASAPI 采集流程 / HRESULT 速查表）

---

## 2.5 回声/回声泄漏问题

**分析思路：**

```
回声（远端听到自己的声音被传回来）
├── 【第 0 步】快速定性：确认回声来源 ⭐
│   ├── 学生/观众端听到老师/主播的声音被回传 → 老师端 AEC 问题
│   ├── 老师/主播听到自己的声音被回传 → 学生端 AEC 问题
│   └── 确认出问题的是哪一端的日志
│
├── 【第 1 步】★★★ AEC 参考信号健康检查（最高优先级！）
│   │  ⚠️ 铁律：回声问题第一步不是看 BGM/音源/混音配置，
│   │         而是确认 AEC 参考信号（playout → AEC 的数据通路）是否正常！
│   │         publish:0 的 BGM 被麦克风采集后，应该被 AEC 消掉，
│   │         消不掉 = AEC 参考信号有问题。
│   ├── 搜索 `ringbuffer.*overrun|data overrun` ⭐⭐⭐
│   │   ├── 有 overrun → 参考信号缓冲区溢出！AEC 拿不到正确参考帧 → 根因找到
│   │   │   └── 继续查原因：搜索播放设备采样率（`playout.*192000|playout.*96000`）
│   │   │       ├── 播放设备采样率远高于 48kHz（如 192kHz）→ 数据量过大撑爆 ringbuffer
│   │   │       └── 建议客户修改播放设备默认格式为 48kHz
│   │   └── 无 overrun → 继续
│   ├── 搜索 `playout count|diff between capture and playout`
│   │   ├── playout count = 0 或极低 → 播放设备未正常工作，AEC 无参考信号
│   │   └── playout count 正常 → 参考信号数据量没问题
│   ├── 搜索 `Reset aec|aec.*reset`
│   │   ├── 频繁 reset → AEC 反复重置无法收敛，回声消不干净
│   │   │   └── 查 reset 前后事件（设备切换？采样率变化？BGM 开始/停止？）
│   │   └── 无频繁 reset → 继续
│   └── 检查播放设备采样率 vs 采集设备采样率
│       ├── 搜索 `playout.*sampleRate|Headphones.*Hz`
│       ├── 两端采样率差异极大（如播放 192kHz vs 采集 48kHz）
│       │   → TapDSP 内部只用 32kHz（`use_32k_process: 1`），
│       │     192kHz 参考信号的 ringbuffer 来不及消费 → overrun → AEC 失效
│       └── 采样率差异正常（均在 44.1~48kHz）→ 继续第 2 步
│
├── 【第 2 步】AEC 配置状态检查
│   ├── 搜索 `aec_enable|Set aec level|kAecLevel`
│   │   ├── AEC 被关闭（level = 0）→ 检查为什么（设备被识别为耳机？业务主动关？）
│   │   └── AEC 已开启 → 继续
│   ├── 搜索 `playout_device_type|headphone|headset|earphone`
│   │   ├── 设备类型识别为耳机 → SDK 可能降低 AEC 等级
│   │   │   └── 若实际是外放被错误识别为耳机 → AEC 等级不够
│   │   └── 扬声器/Unknown → AEC 应全力工作
│   └── 搜索 `tap_dsp_used|TapAudioEnhance|3a_config` → 确认 3A 模块正常加载
│
├── 【第 3 步】AEC 已开启但仍有回声 → 排查失效原因
│   ├── Echo Delay 过大（>500ms）→ 超出 AEC 搜索窗口 → 建议调整设备距离
│   ├── 独立声卡场景 → 搜索设备列表确认
│   ├── 播放/采集设备物理距离太近 → 无日志依据，需询问客户
│   └── BGM 播放路径问题（仅当第 1 步排除了参考信号异常后才看）
│       ├── BGM publish:0 → 本地播放，被麦克风采集后应被 AEC 消除
│       │   └── 参考信号正常则问题在 BGM 音频路径没送入 AEC 参考通道
│       └── BGM publish:1 → 推流，不经过本地扬声器，不会产生回声
│
└── 【第 4 步】系统混音回声泄漏（startSystemAudioLoopback 场景，Windows/Linux）
    ├── 1. 确认 StartSystemLoopback 已调用
    ├── 2. ★ 搜索 "use dsp to cancel echo"（仅 Windows/Linux 有此日志）
    │   ├── 有 → 系统混音 AEC 正常，排查其他原因
    │   └── 没有 → SDK Bug！远端音频未被消除，直接回采推流
    │       └── 检查 SDK 版本（Linux UOS 12.1 已知有此 Bug。Windows 无此问题）
    └── 3. 确认 SDK 版本，对照 trtc-known-issues.md
```

**⚠️ 回声问题分析铁律**：
1. **第一步永远是检查 AEC 参考信号健康状态**（ringbuffer overrun / playout count / 采样率异常）
2. **不要一开始就分析 BGM/音源配置**——publish:0 的 BGM 被麦克风采集后本应被 AEC 消掉
3. **采样率差异极大是高发原因**——192kHz 播放 + 48kHz 采集 = AEC 参考信号 ringbuffer 溢出

### Echo Delay（回声延迟）⭐

- **日志来源**：`tealab_internal_dsp_filter.cc:296`，标签 `[audio_log][audio-dsp]`
- **示例**：`update echo delay: 256 ms` / `Echo Delay (ms): 856`
- **含义**：扬声器播放到麦克风重新采集之间的延迟。AEC 根据此延迟定位并消除回声

**⚠️ 关键认知：Echo Delay 不影响音质！**
- 延迟大时仅可能导致**漏回声**（AEC 搜索窗口有限，超出范围的回声无法消除）
- 正常范围：桌面设备通常 100~400ms，专业会议设备可能更高

```
Echo Delay 较大（>500ms）
├── 客户反馈有回声/漏回声 → 可能 AEC 无法覆盖 → 建议调整音箱麦克风距离
├── 客户反馈音质差 → ❌ 与 Echo Delay 无关！从其他方向排查
└── 客户无回声相关反馈 → 仅供参考，无需特别关注
```

---

## 2.6 音频慢放/降八度/watchdog 反复重启

**典型客户描述**："对方听我说话像慢放" / "声音拖长了" / "像降调了" / "像醉酒说话"

**核心怀疑方向**：**采集设备的采样率声明与驱动实际产出速率不一致**（蓝牙 HFP 麦克风高发）

```
音频"慢放/降八度" or watchdog 反复重启
├── 【第 1 步】查采集设备与 WASAPI 协商格式 ⭐最关键
│   └── 搜索 `capture device:.*with sampleRate`
│       └── 得到 sampleRate / channels / bits / block align / average data transfer rate
│           ├── 验证三者数学自洽：avg rate = sampleRate × block align
│           └── 记录协商采样率（如 8000）
│
├── 【第 2 步】查 watchdog 的 real/expect 比例 ⭐
│   └── 搜索 `Audio total data size is under threshold`
│       └── 取 expect=X, real=Y，计算 ratio = Y / X（不是看 0.2！0.2 是阈值常量）
│           ├── ratio ≈ 2.0 且长时间稳定 → 采样率不匹配（驱动实际按 协商率×ratio 产数据）
│           ├── ratio ≈ 0.5 稳定 → 驱动数据饥饿
│           ├── ratio 在 1~3 剧烈波动 → 链路抖动/突发投递，非采样率不匹配
│           └── ratio ≈ 1.0 → 数据量正常，问题不在 IO 层
│
├── 【第 3 步】印证"时间戳修正方向" ⭐
│   └── 搜索 `timestamp by data length (slow down|speed up) count`
│       ├── slow down count 很大（数百级）+ max offset 接近 100ms → 数据偏多/偏快
│       └── speed up count 很大 → 数据偏少/偏慢
│
├── 【第 4 步】查设备类型，判断是否为已知场景
│   └── 蓝牙耳机（BluetoothHfp）+ ratio ≈ 2.0 → 命中「蓝牙 HFP 采样率不匹配」⭐
│       → 详见 trtc-deep-log-patterns.md §10.9
│
└── 【第 5 步】查链路连锁反应
    └── 搜索 `is abnormal, restart count` 统计每一路重启次数
        ├── recorder/player/loopback 三路同时高频重启 → 根因在共用链路（蓝牙/驱动/WASAPI）
        └── 只有单路重启 → 单路硬件/驱动问题
```

**⚠️ 铁律 —— watchdog 日志的正确解读**：

| 错误读法 | 正确读法 |
|---|---|
| ❌ `under threshold: 0.2` → 实际数据量是预期的 20% | ✅ `0.2` 是 watchdog 的**阈值常量**（偏差 20% 即报警） |
| ❌ 看到 0.2 就判"数据饥饿" | ✅ 看 `expect` 和 `real` 的**绝对值**，计算 real/expect 比例 |

**客户听感与数学比例的对应关系**：
- ratio = 2.0 → 音频慢放 2 倍、降八度（频谱压到一半）
- ratio = 0.5 → 音频加速 2 倍、升八度
- ratio = 1.5 → 音频慢放 1.5 倍、略降调

---

## 3. 黑屏问题

```
黑屏
├── 本地预览黑屏
│   ├── 检查 startLocalPreview 是否调用
│   ├── 检查摄像头设备是否正常打开
│   ├── 检查 D3D11 设备创建是否成功
│   ├── 检查视频采集帧率是否为 0
│   └── 检查渲染窗口设置
└── 远端视频黑屏
    ├── 检查 startRemoteView 是否调用
    ├── 检查 muteRemoteVideo 状态
    ├── 检查 onUserVideoAvailable 回调
    ├── 检查 onFirstVideoFrame 是否收到
    └── 检查网络传输和解码状态
```

> 屏幕分享黑屏走专门链路 → `trtc-screen-share-diagnostics.md` §8 标准分析路径

---

## 4. 卡顿/延迟问题

```
卡顿/延迟
├── 检查网络质量指标
│   ├── 丢包率 > 10% → 网络问题
│   ├── RTT > 300ms → 延迟高
│   ├── Jitter 大 → 网络不稳定
│   └── Bandwidth 不足 → 带宽瓶颈
├── 检查编码参数
│   ├── 分辨率和帧率是否过高
│   ├── 码率设置是否合理
│   └── 硬件编码器状态
└── 检查设备性能
    ├── CPU 使用率
    ├── 编码耗时
    └── 渲染帧率 vs 采集帧率
```

### 4.1 特殊情况：丢包严重但 RTT 正常

**现象**：仪表盘显示丢包率很高，但 RTT 延迟正常（通常 < 100ms）。

```
丢包高 + RTT 正常
├── 第一步：确认问题时间点（让客户提供仪表盘截图或明确时间范围）
├── 第二步：检查日志中的 ClientIP 和 Server
│   ├── 搜索 "ClientIP:" 查看服务端识别的客户端 IP
│   ├── 搜索 "EnterRoom successful" 查看分配的服务器节点
│   └── 判断 ClientIP 地理位置是否与用户实际位置一致
├── 第三步：询问是否使用 VPN/代理
│   ├── VPN 分流配置可能导致：
│   │   ├── 出口 IP 与实际位置不符 → 节点分配不合理
│   │   ├── UDP 大包受 VPN 影响 → 丢包严重
│   │   └── 小包（RTT 测量）正常走直连 → RTT 看起来正常
│   └── 关闭 VPN 后测试是否恢复
└── 第四步：确认根因
    ├── ClientIP 国内 + 用户实际在海外 + 开了 VPN → VPN 分流问题
    ├── ClientIP 海外 + 用户实际在国内 → 代理/VPN 全局模式
    └── ClientIP 与位置一致但仍丢包 → 真正的网络问题
```

**关键日志**：
```
[signal_manager.cc] ClientIP: xxx.xxx.xxx.xxx
[signal_manager.cc] EnterRoom successful ... Server: xxx.xxx.xxx.xxx:port Self IP: xxx.xxx.xxx.xxx:port
```

---

## 4.5 卡死问题（推流突然中断）

> 区别于"卡顿"：卡顿是断断续续，卡死是完全停止出帧。

```
卡死（画面完全停止）
├── 第一步：定位无帧时间点
│   ├── 搜索 "No frame sent for N seconds" 确认无帧时间
│   ├── 从仪表盘找码率突然掉0的精确时间
│   └── 两个时间应该吻合
├── 第二步：在无帧时间点前搜索错误日志
│   ├── 摄像头异常
│   │   ├── "convert camera image: JPEG to I420 failed" → JPEG 解码失败
│   │   ├── "convert camera image: YUYV to I420 failed" → YUYV 转换失败
│   │   ├── 摄像头断开/设备丢失 → USB 连接问题
│   │   └── 采集帧率突然为 0 → 设备停止输出
│   ├── 编码器异常
│   │   ├── "Create video card encoder failed" → 硬编码器故障
│   │   ├── "OnEncoderError" → 编码器错误
│   │   └── 编码器降级日志 → 可能影响帧率
│   └── 系统/内存问题
│       └── 日志空白期（长时间无日志输出） → 系统资源不足
├── 第三步：确认摄像头采集格式
│   ├── 搜索 "[CameraMediaType] video format:" 确认采集格式
│   ├── JPG → 摄像头输出 JPEG 数据，SDK 需要解码
│   ├── YUYV → 摄像头输出 YUYV 原始数据
│   └── NV12/I420 → 直接使用，无需转换
├── 第四步：区分根因
│   ├── JPEG 解码失败 → ①设备不稳定输出损坏数据 ②SDK 解码 bug ③内存不足
│   ├── 设备断开 → USB 连接不稳定
│   └── 编码器故障 → 硬件问题
└── 第五步：确认后续影响
    ├── 推流中断后是否触发了业务踢人？（OnKickOut code:2）
    ├── 推流中断后是否自动恢复？（搜索后续 OnCameraStarted）
    └── SDK 是否正确处理了异常？（"Will update media state" → 自动降级）
```

**给客户的报告模板**：
1. **告知根因**：如"摄像头 JPEG 解码失败导致推流中断"，附上关键日志
2. **分析可能性**：设备不稳定 / SDK bug / 内存等
3. **建议升级版本**：如果版本较老，建议升级
4. **建议排查设备**：更换 USB 端口/摄像头/更新驱动

---

## 4.6 多链路同步劣化的根因鉴别

> **适用场景**：客户描述"长会几小时后突然采集帧率掉一半、码率掉一大半，再也回不去"、"美颜耗时上涨"、"画面变卡顿"。
>
> **核心原则**：当**采集 fps、麦克风 wait、美颜耗时、渲染**等**多条独立链路同时**变慢时，**不要**急于把任何单一链路当根因。

### 一、为什么必须先做这个鉴别？

TRTC SDK 内部有多条相互独立的链路：

| 链路 | 线程 | 消费的硬件资源 | 关键日志 |
|---|---|---|---|
| 摄像头采集 | `camera-capture` | USB / MF / DirectShow 驱动 | `camera_safe_wrapper.cc:620` 的 `VideoStatsInfo capture fps` |
| 麦克风采集 | WASAPI 回调线程 | 板载麦克风 / 蓝牙 HFP | `audio_recorder_wasapi.cc:657` 的 `bad wait duration` |
| 视频前处理（美颜） | `liteav_video_preprocess` | GPU / CPU | `filter_cost_time_stats.cc` 的 `kExternalBeautyFilter` |
| 视频编码 | `liteav_video_encode` | GPU 硬编 / CPU 软编 | `video_encoder_monitor.cc` 的 `encode cost` |
| 渲染 | 渲染线程 | GPU | `On render frame freeze` |

这些链路**消费不同硬件、运行在不同线程**，正常情况下互不影响。但有**两种**机制都能让多条链路同步劣化：

1. **真正的系统级资源紧张**（CPU/GPU 降频、热限制、电源策略切换、其他进程抢占）——所有链路被同一上游拖慢
2. **单一下游消费者足够慢导致的反压级联**（如美颜单帧 100~200ms 把整机 CPU 时间片吃满）——表面看也像"多链路同时变慢"，但其实是单点性能问题通过反压把统计指标和邻近链路一起拽下去

⚠️ **重要认知**："美颜慢绝对不会让摄像头驱动给帧速度变慢"这个绝对化论断**不成立**。当美颜单帧耗时达 100ms+、`liteav_video_preprocess` 队列 load_rate=99%~100% 时：
- DSHOW 回调线程在 `WriteFrame` 同步调用里可能被反压阻塞数百毫秒（`capture cost:388ms`）
- 整机 CPU 被前处理线程吃满，导致 WASAPI 回调时延、CEF 主线程、SDK 渲染线程**全部**同步抖动
- 表象上"采集 fps 也降了"、"WASAPI bad wait 飙了"、"渲染 freeze 了"，但**真正的根源仍是美颜单点**

因此**仅凭"多链路同步异常"无法直接落锤"系统级资源紧张"**，必须先通过 §4.7 的鉴别排除"美颜单点反压"。

### 二、强制鉴别清单（10 分钟内执行完）

按顺序检查这 5 项，**任意 2 项以上同步异常 = 命中本模式**：

```bash
LOG_FILE="<已解码的日志文件>"

# ① 摄像头真实拉帧 fps（关键源头指标）
grep -n "VideoStatsInfo capture fps" "$LOG_FILE" | tail -20
# ⚠️ 看 camera_safe_wrapper.cc:620 输出的值，不是 camera_capture_impl 的 output_fps（后者是平滑值会骗人）

# ② SDK 拉一帧的耗时（capture cost）
grep -nE "Abnormal uplink cost.*capture cost" "$LOG_FILE" | tail -20

# ③ 麦克风 WASAPI 回调等待时长
grep -n "bad wait duration" "$LOG_FILE" | tail -20

# ④ 美颜 / 前处理耗时
grep -nE "Filters total cost time|kExternalBeautyFilter" "$LOG_FILE" | tail -20

# ⑤ 渲染卡顿
grep -n "On render frame freeze" "$LOG_FILE" | tail -10

# ⑥ 各线程负载
grep -nE "Load rate overload|Max task cost exception" "$LOG_FILE" | tail -30
```

### 三、判断决策树

```
故障时间点 ±30s 内观察以下指标的变化：
├── ① camera_safe_wrapper 的 capture fps 是否跌一半？（如 25→14）
├── ② video_encoder_monitor 的 capture cost 是否飙到 100ms+？（正常 < 50ms）
├── ③ audio_recorder_wasapi 的 bad wait duration 是否飙到 100ms+？（正常 < 30ms）
├── ④ kExternalBeautyFilter 是否飙升？（如 10ms → 100ms）
└── ⑤ 是否有 On render frame freeze: 1000ms+？

判断规则：
├── ① + ③ 同时异常（视频源 + 音频源同步劣化）
│       → ⭐ 一定是「多链路同步劣化 = 系统级资源紧张」模式（铁证）
├── ① + ④ + ⑤ 同时异常但 ③ 正常
│       → 高度怀疑 GPU/CPU 资源被外部抢占（其他进程占用 GPU、显卡降频）
│       → 仍属本模式
├── 仅 ④ 异常，①②③⑤ 全部正常
│       → 命中「外部美颜插件耗时突增」单链路模式（trtc-deep-log-patterns.md §10.6）
│       → 此时整改方向才是优化美颜插件
├── 仅 ① 异常，②③④⑤ 正常
│       → 摄像头硬件 / 驱动 / USB 链路单点问题 → 见 §4.5
└── 仅 ③ 异常，①②④⑤ 正常
        → 麦克风硬件 / WASAPI / 蓝牙链路单点问题 → 见 §2 / §2.6
```

**辅助证据：采集线程是否触发 Load rate overload？**
- `liteav_video_capture` **没**触发 overload + capture fps 降一半 → 采集线程不忙，是**等不到帧**（驱动/硬件给得慢）→ 强证据指向系统级资源紧张
- `liteav_video_capture` **触发了** overload → 采集线程自己忙不过来 → 看是否有大量 Drop frame，可能是 SDK 内部问题

### 四、命中本模式后给客户的回复要点

**结论模板**：
> "故障时间点附近，**摄像头真实采集帧率（capture fps）、WASAPI 麦克风等待时长、GPU 美颜耗时、渲染线程**等多条**完全独立**的链路同步劣化（具体证据见时间线）。这些链路消费不同硬件、运行在不同线程，单一组件性能问题不可能同时拖累所有链路，因此根因不在 TRTC SDK 自身、也不在第三方美颜插件，而在客户端进程级 / 操作系统级的全局资源紧张。SDK 后续的码率/帧率降级（QoS）是正常的保护性行为。"

**排查方向**（让客户提供）：
1. 笔记本电源状态（是否插电？是否切换过电源模式？）
2. 任务管理器中故障时间点的 CPU/GPU 频率曲线（是否有降频）
3. CPU/GPU 温度（是否触发 thermal throttling）
4. 是否启动了其他高占用应用（系统更新 / 杀毒扫描 / 云盘同步 / 录屏 / 浏览器视频）
5. **环境光是否变暗**（USB 摄像头会自动延长曝光降低出帧速度，是"capture fps 突然减半"的常见原因）
6. 摄像头驱动「自动曝光/动态帧率」是否开启，必要时设为「固定帧率」

**不要**给的建议：
- ❌ 不要让客户换美颜厂商（美颜不是根因）
- ❌ 不要让客户改 SDK 编码参数（无法解决采集源头问题）
- ❌ 不要把案例当 SDK bug 提单
- ❌ 不要建议升级 SDK 版本（与版本无关）

---

## 4.7 视频采集链路反压传播机制（⭐必读，本节是 §4.6 的精化）

> **适用场景**：客户问"为什么 `VideoStatsInfo capture fps` 也降了？是不是采集出问题了？"、"为什么前处理慢能拖到 CEF / WASAPI / 渲染都卡？"

### 一、SDK 内部视频上行链路的真实结构

```
摄像头硬件 (DSHOW/MF/AVF/V4L2/Camera2)
    │  驱动回调线程（DSHOW SampleGrabber / MF SourceReader）
    ▼
[A] CameraSafeWrapper::OnPixelFrameAvailable      ← 在驱动回调线程内执行
    │  ① 对每个下游 track 同步调用 WriteFrame()
    │  ② 调用 stats_->NotifyFrameComing()（注意：放在 WriteFrame 之后！）
    ▼
[B] PixelFrameTrack (容量 = 1 帧，单帧 ringbuffer)
    │  • 临界区只做 pop_front + emplace_back，纳秒~微秒级
    │  • 满了不阻塞生产者，而是丢掉最老的一帧（latest-wins / overwriting）
    │  • 触发 reader_listener->OnPixelFrameReadableSignal()（异步 PostTask）
    ▼
[C] preprocessor_queue（bizid=303, liteav_video_preprocess）
    │  • VideoPreprocessorV3::DoProcessFrame
    │  • 同步串行跑 filter chain（kInputFrameTransformer / kExternalBeautyFilter / kLocalRender / ...）
    │  • 美颜耗时 = 这条线程的吞吐瓶颈
    ▼
[D] encoder_queue（编码线程）
```

### 二、几个 fps 统计点的精确语义（极易混淆，本节核心）

**很多客户/分析人员看到"采集 fps 降了"就以为是"摄像头硬件给慢了"。这是错的。**

| 统计点 | 来源代码位置 | 真实含义 | 故障时表现 |
|---|---|---|---|
| `VideoStatsInfo capture fps:N` | `camera_safe_wrapper.cc:620` | **SDK 在驱动回调线程上"每秒能完整跑完 OnPixelFrameAvailable 的次数"**。⚠️ **它不是硬件给帧速率**！它把 `WriteFrame` 同步调用的耗时也算进去了 | 下游反压时 DSHOW 回调线程在 `WriteFrame` 里被拖慢，1 秒内能完成的回调减少 → 数值下降。**硬件可能仍在 24fps 出帧** |
| `StatusInfo:[CAMERA, output_fps:N]` | `camera_capture_impl.cc:489` | StatusCenter **平滑统计**，统计窗口更长 | 下降幅度通常更小（平滑掩盖瞬时阻塞），**不要只看这个值** |
| `StatusInfo:[PREPROCESS, input_fps:N, output_fps:N]` | `video_preprocessor_v3.cc:195` | 前处理线程**实际取走并处理掉**的帧速率 | 真实反映"美颜后能产出多少帧/秒"，故障时 24→4~10 |
| 仪表盘"采集帧率" | 后台聚合 `pixel_frame_track` 入口的有效输入 | 与 `VideoStatsInfo capture fps` 高度一致 | 与 `capture fps` 同步下降 |
| `[ENCODER, input_fps]` / `[ENCODER, output_fps]` | `video_encoder_wrapper.cc:261` | 编码器实际拿到/编出的帧速率 | 故障时 15→8 |

**铁律**：
> **`VideoStatsInfo capture fps` 这个统计点本身就是"链路健康度指标"，不是"硬件状态指标"。它跌一半，可能是硬件慢，也可能是下游反压。**
>
> 区分方法：看 §4.6 强制鉴别清单第 ②③⑤ 项是否也异常。如果**只有** `capture fps` 跌但 ②③⑤ 都正常 → 真是硬件慢；如果**伴随**美颜耗时上涨 + load_rate=99% + WriteFrame 同步阻塞证据 → 是反压。

### 三、`PixelFrameTrack` 的反压传播机制（必看）

```
采集 24fps，每 ~42ms 一帧；前处理因美颜耗时 100ms，每帧处理需 100ms

T=0ms   F1 到 → WriteFrame → 入队 [F1] → 异步 PostTask 通知前处理
T=1ms   前处理拿到 F1，开始美颜（100ms）
T=42ms  F2 到 → WriteFrame → 入队 [F2]，没满（前一帧已被取走）
T=84ms  F3 到 → WriteFrame → 队列满 [F2]，pop_front(F2) 丢弃 F2，入 [F3]
                ↑ 打印 "Drop frame because low performance, total:1"
                整个临界区只需几微秒，采集线程立刻返回 ✓
T=101ms 前处理跑完 F1，ReadFrame 拿到 F3（跳过了被覆盖的 F2）
```

**关键事实**：
1. **采集线程从不阻塞等待空位**。Track 满时直接覆盖旧帧、立刻返回
2. **保新策略（latest-wins）**：丢的是"中间旧帧"，留的总是最新画面，避免延迟堆积
3. **`Drop frame because low performance` 是"覆盖丢帧"的日志，不是"采集卡死"的日志**。`total:4932` 不等于"采了 4932 帧出错"，而是"被覆盖丢弃了 4932 帧"
4. **`continue drop:N`** 是连续被覆盖的次数。N≥5 说明消费者已经完全跟不上

### 四、反压如何"间接"把上游统计指标拖下来

**间接耦合 1：`OnPixelFrameAvailable` 内部的同步 `WriteFrame` 调用**

```
DSHOW 回调线程在 OnPixelFrameAvailable 里同步调用 WriteFrame
   → WriteFrame 触发 OnPixelFrameReadableSignal → 前处理队列 PostTask
   → 当前处理队列已被卡死任务占满时，PostTask 入队需要拿队列锁
   → 如果整机 CPU 紧张（前处理线程吃满核心），队列锁竞争 + 引用计数操作变慢
   → 每次 WriteFrame 在异常情况下可能多花几十~几百毫秒
   → 1 秒内 OnPixelFrameAvailable 跑的次数下降 → VideoStatsInfo capture fps 下降
```

**间接耦合 2：操作系统级线程调度抢占**

当 `liteav_video_preprocess` 线程（bizid=303）`load_rate=99%~100%` 时，它事实上独占一个 CPU 核。OS 调度器可能让其他线程拿不到时间片：

- DSHOW 回调线程：`capture cost` 飙到 300~400ms（看 `Abnormal uplink cost`）
- WASAPI 麦克风：`bad wait duration` 从几毫秒跳到 100~200ms
- CEF 主进程：UI 卡顿、SwapChain Present 卡 200ms（`external_present: max:197ms`）
- SDK 渲染线程：`On render frame freeze: 1000ms+`

**这就是为什么单点美颜变慢，能让"看起来像系统级资源紧张"的现象出现。**

### 五、`Change to low performance mode` 不可逆熔断（关键副作用）

```
[E] video_filter_chain_v3.cc:365  Change to low performance mode. time_cost=117
```

- 触发条件：filter chain 10 秒滑窗内单帧平均耗时 > 阈值（约 50ms）
- **一旦进入低性能模式，本次推流过程中不再回滚**（设计如此）
- 副作用：QoS 持续把编码 fps 钳制在 8~12，码率压在 100~250kbps。**即便美颜耗时后续回落，本次推流帧率也回不到 24**
- 客户感知：**"卡过之后再也没恢复"**（不重新进房的话）

### 六、`liteav_video_preprocess` 队列 load_rate 的解读公式

日志样式：
```
[thread_manager.cc:916] Threads stats
1_0_0_0_0_303 =>
  {303:, 99%, 75ms, 97ms, 15, 1, 468ms, 468ms}
```

字段顺序：
```
{bizids, load_rate, avg_task_cost, avg_task_delay, task_count, reuse_count, max_task_cost, max_task_delay}
```

**load_rate 计算公式**：`load_rate = Σ每个任务执行耗时 / 统计窗口总时长 × 100%`
代入验算：15 个任务 × 平均 75ms = 1125ms 累计执行时间，窗口约 1.13 秒 → 99%。

**阈值参考**：

| load_rate | avg_task_delay | 含义 |
|---|---|---|
| 0~30% | < 20ms | 正常 |
| 30~70% | 20~80ms | 偏忙，可能临近瓶颈 |
| 70~95% | 80~200ms | **队列拥塞**，新帧需排队等待，画面延迟开始增加 |
| 95~100% | >200ms | **队列饱和**，前处理已成为系统瓶颈，会触发 Drop frame + QoS 降级 |

**bizid 速查表**（最常见的）：
- `100` = liteav_common
- `300` = kCameraPlatformApi（摄像头平台接口）
- `303` = kVideoPreprocess（视频前处理 ⭐）
- `304` = kVideoRender
- `305` = kVideoEncoder

### 七、给客户的回复模板

**模板 A：客户问"为什么 `VideoStatsInfo capture fps` 也降了？"**

> `VideoStatsInfo capture fps` 不是摄像头硬件给帧速率，而是 SDK 在驱动回调线程上每秒能完整处理一次回调的次数（1 秒滑动窗口）。它把 SDK 内部 `WriteFrame` 同步调用的耗时也算了进去。
>
> 本案中前处理线程（`liteav_video_preprocess`）因美颜耗时上涨被打满（load_rate=99%），导致 DSHOW 回调线程在 `WriteFrame` 里被反压阻塞，对应日志 `Abnormal uplink cost ... capture cost:388ms`。1 秒内能完成的回调从 24 次降到 13~16 次，所以这个统计值跌了。
>
> 摄像头硬件本身大概率仍在以 ~24 fps 出帧（除非音频链路也异常）。

**模板 B：客户问"采集→前处理之间是同步阻塞队列吗？"**

> 不是。SDK 用一个**容量为 1 帧的 `PixelFrameTrack`** 做异步连接，**采集线程不会等空位**。当 Track 满时，新到达的帧会**覆盖**队列里的旧帧，并打印 `Drop frame because low performance, total:N continue drop:M`。整个过程不阻塞，只持锁微秒级。
>
> 这是 latest-wins 策略：让消费者总是拿到最新画面，避免延迟堆积；同时不反压到摄像头驱动，避免硬件假死。

**模板 C：客户问"美颜慢为什么会拖累 CEF / WASAPI / 渲染？"**

> 直接拖累机制有两层：
> 1. **CPU 抢占**：前处理线程 `load_rate=99%` 独占一个核，OS 调度器会让其他线程拿不到时间片
> 2. **共享资源**：CEF 与 SDK 都用 D3D11、Loopback 走 WASAPI 共享驱动栈，在 GPU 命令队列或驱动锁层面可能相互影响
>
> 这与"系统级资源紧张"（§4.6）的表象类似，但**根因仍是美颜单点**——只要解除美颜瓶颈，所有连锁现象都会消失。

### 八、本节与 §4.6 的关系

```
症状：多链路同步异常（采集 fps↓ + WASAPI 抖 + 渲染 freeze + 美颜耗时↑）
   │
   ├── 走 §4.6 强制鉴别清单（5 项指标）
   │
   ├── 美颜耗时是"突变"还是"逐渐变高"？
   │     ├── 突变 + 美颜 cost 与其他链路异常同步出现 → 90% 是「美颜单点反压级联」
   │     │     → 整改方向：让客户优化美颜插件（trtc-deep-log-patterns.md §10.12）
   │     └── 渐变 + 与笔记本拔插电源/温度上升相关 → 「系统级资源紧张」
   │           → 整改方向：排查电源/温度/抢占进程（trtc-deep-log-patterns.md §10.11）
   │
   └── 是否有 Change to low performance mode 日志？
         └── 有 → 本次推流码率/帧率不会自行恢复，需重启推流
```

---

## 5. 断流/断连问题

```
断流
├── 检查网络连接状态
│   ├── 搜索 onConnectionLost 时间点
│   ├── 检查 onTryToReconnect 次数
│   └── 检查 onConnectionRecovery 是否出现
├── 检查恢复后状态
│   ├── 推流是否正常恢复
│   ├── 拉流是否正常恢复
│   └── 屏幕分享是否正常恢复（已知可能不恢复）
└── 检查是否周期性断连
    ├── 多次 Lost → Reconnect → Recovery 循环
    └── 间隔是否规律（规律 → 互踢！见 §6 分支 E）
```

---

## 5.5 掉线/被踢问题

> 用户说"掉线"时，需要先确认是真正的网络断连还是被业务服务端踢出。两者处理方式完全不同。

```
掉线
├── 第一步：查退房日志确认退房方式
│   ├── OnKickOut → 被踢出
│   │   ├── code:2, msg:"kick out room by business"
│   │   │   → ⭐ 业务后台通过服务端 API 主动踢人/解散房间（DismissRoom/RemoveUser）
│   │   │   → 这不是 SDK 问题，也不是网络问题
│   │   └── code:1 → 同名用户在其他设备登录，被挤下线
│   ├── OnExitRoom → 退房
│   │   ├── code:0 → 用户主动退房（App 调用了 exitRoom）
│   │   ├── code:1 → 被踢出
│   │   └── code:2 → 房间被解散
│   ├── 日志中断（无退房日志） → 可能崩溃或进程被杀
│   └── 多笔会话 → 分别分析每笔的退出原因
├── 第二步：分析掉线前的状态
│   ├── 掉线前推流是否正常？
│   │   ├── 正常 → 业务主动操作，与 SDK 无关
│   │   └── 异常（无帧、码率为 0）→ 设备异常导致业务检测断流后踢人（连锁反应）
│   ├── 是否有网络断连？（搜索 onConnectionLost）
│   └── 是否有设备异常？（搜索 Error 级别日志）
├── 第三步：识别因果链
│   ├── 典型链1：设备异常 → 推流中断 → 业务检测 → 踢人
│   │   例：JPEG解码失败 → 5秒无帧 → 业务后台解散房间
│   ├── 典型链2：网络断连 → 推流中断 → 业务检测 → 踢人
│   ├── 典型链3：业务主动解散房间（与 SDK 无关）
│   └── 典型链4：同名用户多端登录 → 被挤下线
└── 第四步：确认归责
    ├── SDK 问题 → 提 bug
    ├── 设备问题 → 建议客户排查设备
    ├── 网络问题 → 建议客户排查网络
    └── 业务逻辑问题 → 建议客户优化业务策略
```

**关键日志关键字**：`OnKickOut` / `OnExitRoom` / `kick out room by business` / `UnkownCommand: 0x210a` / `onReceiveKickOutPush` / `HandleIncSyncRequest.*action:Exit.*exit_reason:2`

---

## 6. 进房失败

> **⚠️ 铁律（最高优先级）**：凡"进房失败 / 无法进房 / 私有化部署异常"，在写结论前**必须**先提取 SDK 版本**及构建时间**并强制比对 `trtc-known-issues.md` 私有化进房失败条目。命中 13.0 或 13.1 修复点之前的构建即引用，**不得只看日志表象（RST/TIMEOUT/连不上）就单一归因网络/服务端**。

### 通用决策树

```
进房失败
├── 第 0 步【必做】提取 SDK 版本 + 构建时间 + 是否私有化部署
│   ├── 私有化特征：PrimaryAnycast / SecondaryTcp / DNS: 0 / Local IP Stack Info（IP 直连无公网 DNS）
│   └── 命中 13.0，或 13.1 修复点之前的构建 + 私有化 → 强制比对已知问题（首要嫌疑）
│
├── 检查 onEnterRoom 回调
│   ├── result < 0 → 获取错误码（重点关注 -3307 进房超时）
│   ├── 无回调 → 网络超时
│   └── result 值异常大 → 进房耗时过长（>3000ms 可能网络问题或 userSig 校验慢）
│
├── 检查参数（对照 trtc-product-concepts.md）
│   ├── sdkAppId 是否正确（1400 国内 / 200 国际站）
│   ├── userId 是否合法（区分大小写，≤32 字节）
│   ├── userSig 是否过期（6206/70001）
│   └── roomId 类型是否两端一致（数字 vs 字符串不互通！）
│
└── 检查版本和环境
    └── 网络是否能连通 TRTC 服务器（防火墙 UDP？）
```

**服务端纯问题 vs SDK 版本 Bug 快速判别**：同环境其他版本客户端能否进房 → 只有特定版本构建失败、其他版本正常 = SDK 版本 Bug；全量客户端均失败 + 端口确实未监听 = 服务端问题。两种可能都需在结论中列出，并把"升级到修复点之后的构建做对比"作为首条建议。

### 按错误码/现象分流

```
├── 错误码 70001/70009/70013/70014/6206/6014 → UserSig 鉴权问题（trtc-product-concepts.md §1）
├── 错误码 -3301 → 断线 30 分钟自动退房，需业务侧主动重进房
├── 错误码 -1208 → Android 麦克风被其他应用打断（电话/语音助手），或 targetSdk 30+/34+ 前台服务配置
├── 收不到任何错误码/回调 → 防火墙/网络完全阻塞（trtc-product-concepts.md §6）
├── 进房成功但立刻被踢 → UserID 冲突/多端登录（分支 E）
├── 进房成功但被拒绝角色切换 → privateMapKey 权限
├── 重进房非常规律（12s/24s/30s）→ 互踢（分支 E，不是网络问题！）
└── 无错误码、只能看 SDK log → 信令阶段诊断（分支 G）
```

### 分支 E — UserID 冲突/多端互踢

**规律的重进房 = 强互踢信号**：
- SDK 心跳 500ms 一次，**8s 收不到回包**触发重连，重连约 **11~12s 一轮**
- 后台收到新进房连接后，会**主动**停止与旧连接通信、不再回任何信令——后台行为所以节奏规律
- 弱网导致的重连**没有这种节奏感**

实锤手段：
| 场景 | 方法 |
|---|---|
| 不同设备互踢 | 在线日志/监控按 `dev_uuid` 过滤：同一 RoomID/UserID 下两个不同 dev_uuid 交替上报 |
| 同设备多实例互踢 | 看 `enterRoom`/`exitRoom` 是否成对、`self:` 后的实例对象号是否每次不同（旧实例未清理/重新 new 实例） |

### 分支 G — 信令阶段诊断（无错误码时）

> 进房信令分两个关键阶段：
> - **0x1 阶段** — `requestACCIPandSign`：向后台请求接口机 IP + 签名
> - **0x109 阶段** — `cmd:0x2001`：基于 0x1 拿到的信息发起进房请求

| 模式 | 0x1 | 0x109 | 日志特征 | 根因 | 处理 |
|------|-----|-------|---------|------|------|
| 模式 1 | ✅ | ❌ 大量失败 | `Signal: onRequestACCIP SUCC` + `retrySend: seq:xxx cmd:0x2001` 一直重试 | SDK socket 多线程处理异常（已知 Bug） | 升级 9.1stable+/9.2release+ |
| 模式 2 | ❌ | — | `retrySend: seq:xxx cmd:0x3001` 一直重试；过滤 `dns` 见 `240.x.x.x` / `198.18.x.x` 保留地址段（合法结果应为公网 IP） | DNS 解析异常（SDK 8.6~9.2 之间高发） | 升级 SDK；整理异常 DNS 日志转研发 |
| 模式 3 | ✅ | ✅ 后心跳超时重进房 | 进房成功但后续心跳超时频繁重进房、"收到不可解的包" | 8.9 前版本本地 token 未更新（`bytes_key` 必须用最新值） | 升级 8.9+；已新版仍出现 → 转研发核对前后台 key |
| 模式 4 | ❌ 解码异常 | — | `Signal: handleResponseACCIPandSign, Acc ip ERROR: ..., msg:unknown command` | SDK↔后台加解密配置不一致 | **必须联系研发**（客服无法独立修复） |

> 💡 进房未成功时想知道客户的 clientip，可从在线日志上报里取（上报走 TCP 通道，不受 UDP 阻塞影响）。

### 进房失败前置确认（"对方收不到我"类问题）

当问题是"我能进房但听不到/看不到对方"时，**先确认双方对应时间段都真的在房间中**：
1. 对应时间点前双方都调用了 `enterRoom`
2. sdkappid 一致；**字符串和数字房间号类型一致**（`"123"` 和 `123` 是两个房间！）
3. 双方都进房成功：日志中找 `OnJoinRoom [code:0|msg:OK]`
4. 问题时间点没有断网：检查 `OnConnectionStateChanged [status:ConnectionLost/TryToReconnect]` / `OnError [code:-3301...]`

---

## 6.5 退房超时/多进程场景

> 适用：用户描述"点击退房后 UI 没有反应"、应用层日志显示 `exitRoom timeout`、"退出课堂时卡死"、存在多个 TRTC 进程/实例。

### 分析步骤

1. **收集全部日志文件**：⚠️ 关键原则——不能只看一个日志文件，必须收集所有进程的日志（`LiteAV_C_YYYYMMDD-PID.clog` 按 PID 区分进程）

2. **对每个进程提取关键参数**：
   ```bash
   grep -E "user_id:|room_id:|str_room_id:" <解码后日志> | head -5
   ```

3. **分析应用层日志**（如有）：搜索 `exitRoom` 调用时间 vs `OnExitRoom` 回调时间 vs 超时告警时间

4. **逐个进程分析 SDK 退房日志**：
   - **正常退房特征**：
     ```
     [09:28:42.879] ExitRoom [stop_capture:True]
     [09:28:42.890] OnExitRoom [code:0|msg:]
     ```
     ExitRoom → OnExitRoom 耗时 11ms ✓，code:0 正常 ✓
   - **被业务后台踢出特征**：
     ```
     [09:28:44.231] OnExitRoom [code:2|msg:kick out room by business]
     ```
     该进程没有主动调用 exitRoom，而是被动收到踢人通知

5. **构建时间线**：

   | 时间 | 进程 | 事件 | 说明 |
   |------|------|------|------|
   | 09:28:42.879 | 进程一 | 应用层调用 exitRoom | 用户点击退房 |
   | 09:28:42.890 | 进程一 | SDK 回调 OnExitRoom code:0 | 主进程正常退房 ✓ |
   | 09:28:44.231 | 进程二 | SDK 回调 OnExitRoom code:2 | 辅助进程被后台踢出 |
   | 09:28:52.907 | 应用层 | exitRoom timeout 告警 | 应用层等待超时（10s） |

### 典型根因（真实案例）

- **SDK 层面**：主进程 11ms 内正常完成退房 ✓；辅助进程被业务后台踢出（code:2）✓ —— SDK 退房流程完全正常
- **应用层面**：应用层可能在等待**所有进程/实例**都退房，但没有正确处理辅助进程的 `code:2` 回调 → 超时
- **归责**：SDK 无问题；业务侧按预期踢人；**应用层未能正确处理多进程退房场景**

### 给应用层的建议

1. **区分主动退房和被动踢出**：
   ```javascript
   onExitRoom(code, msg) {
     if (code === 0) { this.cleanup(); }          // 主动退房成功
     else if (code === 2) { this.cleanup(); }      // 被业务踢出：直接清理，不要等待、无需再调 exitRoom
   }
   ```
2. **多实例场景分别处理**：每个 TRTC 实例分别监听 onExitRoom；不要等所有实例都退房才清理 UI，主实例退房后立即更新 UI
3. **设置合理的超时时间**：正常退房 < 100ms，超时可设 5s，超时后强制清理

---

## 7. 设备问题

```
设备问题
├── 摄像头
│   ├── 检查 getDevicesList 返回
│   ├── 检查 setCurrentDevice 调用
│   ├── 检查采集框架（DirectShow / MediaFoundation）
│   ├── D3D11 创建失败 → 驱动问题
│   └── 启动失败 hr=0x80040217 → trtc-deep-log-patterns.md §10.15 归因表
├── 麦克风
│   ├── 检查设备列表
│   ├── 检查采集状态
│   └── KS 句柄泄露 → 多次开关触发
└── 扬声器
    ├── 检查设备列表
    ├── 检查播放状态
    └── 检查音量设置
```

---

## 8. 屏幕分享问题

```
屏幕分享
├── 无法开启
│   ├── 检查权限
│   ├── 检查采集源设置
│   └── 检查采集方式（WGC/GDI/DXGI）
├── 推流无画面 / 有效推流极短 ⭐
│   ├── Start/Stop 时序异常（常见！）
│   │   ├── 检查 StartScreenCapture 到 StopScreenCapture 间隔
│   │   ├── 是否在 onScreenCaptureStarted 回调前就 Stop
│   │   ├── 关注 WGC 异步初始化耗时（高端 ~2s，低端可达 ~7s）
│   │   └── 搜索 `Capture has not started` 确认采集就绪状态
│   ├── WGC 初始化失败 → 检查 `[wgc] start capture` 相关日志
│   └── 硬件编码器失败降级 → `Create video card encoder failed`
├── 自动暂停
│   ├── 窗口最小化
│   ├── Word 启用编辑模式 → 窗口 ID 变化（已知）
│   └── 目标窗口被遮挡
├── Pause 后再次 Start 黑屏
│   └── is_started_ 状态残留 → trtc-screen-share-diagnostics.md §6 Bug 1
└── 断流后不恢复
    └── 网络恢复后屏幕分享推流未恢复（已知问题）
```

> 完整诊断链路（模块架构/状态机/黑屏因果链/快速鉴别表）→ `trtc-screen-share-diagnostics.md`

---

## 9. 崩溃分析

1. 查找 `crash`、`fatal`、`exception` 关键字
2. 提取崩溃堆栈，定位崩溃函数和模块
3. 对照已知崩溃：`nvEncGetLastErrorString` 空指针 → 低端 NVIDIA 显卡驱动（13.0 已修复）；D3D11 设备创建失败 → 12.8 版本已知问题
4. 客户提供 crash 堆栈/dump 时的符号化分析 → `sdk-crash-analysis.md`

---

## 10. 仪表盘/监控参考

关键指标正常范围：

| 指标 | 正常范围 | 异常含义 |
|---|---|---|
| 音频采集音量 | > 0 | 0 表示无音频采集 |
| 3A 后音量 | > 0 | 0 可能是 setAudioCaptureVolume(0) |
| 上行丢包率 | < 5% | >10% 严重影响通话质量 |
| 下行丢包率 | < 5% | >10% 严重影响通话质量 |
| RTT | < 200ms | >300ms 明显延迟感 |
| 视频帧率 | ≥15fps | <10fps 会卡顿 |
| 视频码率 | 取决于分辨率 | 突然降低可能是网络拥塞 |
| 音频播放延迟 | <500ms(低延时模式) | setAudienceLatencyLevel 影响 |

**setAudienceLatencyLevel 延迟级别参考**：
- 级别 1（低延时）：优质线路，NetEQ 目标延迟约 440ms，最小延迟约 700ms
- 级别 2（普通延迟）：边缘节点，NetEQ 目标延迟约 1000ms，最小延迟约 1000ms

**网络质量判读阈值**：
- **rtt > 1s** 大概率影响互通；持续升高直到重进房/超时退房则一定影响
- **pingRtt 与 rtt 同时变差** → 实锤弱网（换线路也救不回来）
- **loss > 20%** 有概率影响互通，结合下行卡顿判读
- **clientip 变了但 accip 没变** + 前后线路质量差异巨大 → 后台线路分配可疑，转研发

**监控查询注意**：
- 日志时间戳后缀 `+8.0` 是时区
- 监控默认环境为全球站；**200 开头的国际账号需切换国际站**查询
- 房间持续时间过久时，需重新选择问题时间点查询
- 监控上报需网络畅通，"打点 gap 超过 15s"可能是网络真的断了；打点超过 20s 不连续才判定为断开

---

## 11. 退房/踢人原因码参考

### OnExitRoom 退房原因码

| code | 含义 | 说明 |
|---|---|---|
| 0 | 主动退房 | 用户/App 调用了 exitRoom |
| 1 | 被踢出 | 同名用户在其他设备登录 |
| 2 | 房间被解散 | 业务后台解散了房间 |

### OnKickOut 踢人原因码

| code | msg | 含义 |
|---|---|---|
| 2 | kick out room by business | 业务后台通过 DismissRoom/RemoveUser 等服务端 API 操作 |
| 1 | - | 同名用户登录，同一 userId 在其他设备/实例进入同一房间 |

### 服务端踢人相关日志特征

```
S2CRequest: {cmd:UnkownCommand: 0x210a}           ← 收到服务端踢人指令
onReceiveKickOutPush. err:2 msg:kick out room by business  ← 确认是业务踢人
OnKickOut [code:2|msg:kick out room by business]   ← 回调触发
```

**重要**：`kick out room by business` 是客户自己的业务后台操作（通过腾讯云 API 解散房间或踢人），**不是 SDK 问题**，也**不是网络断连**。需要引导客户排查自己的业务逻辑。

---

## 12. 分析最佳实践（黄金法则）

1. **日志 + 仪表盘必须结合**：只看日志容易误判；只看仪表盘无法定位代码问题
2. **区分"链路正常"和"数据正常"**：链路正常（设备启动成功、首帧成功、连接成功）≠ 数据正常（采集能量、码率稳定、无丢包）。链路正常但数据异常 → 通常是设置/环境问题
3. **日志中的 Error 不一定是根因**：有些 Error 只是警告，要结合现象和仪表盘判断
4. **先看现象，再看日志**：明确用户反馈的问题现象，根据现象找对应的日志/仪表盘指标，避免"看见 Error 就分析"
5. **区分"进房前"和"进房后"的日志状态**：
   - SDK 只有进房后才会推流，**进房前的丢帧（Drop frame）、编码器不稳定等是完全正常的**
   - `Drop frame because low performance` 的 `total` 计数从 SDK 初始化就开始累计，进房时 total 值很大不代表有问题
   - 分析卡顿/丢帧类问题时，**只关注进房后（EnterRoom 之后）的日志**
   - 同理，进房前的 `Encoder output is unstable`、`Abnormal uplink cost` 等也可忽略
6. **误区的教训**：

   | 误区 | 正确做法 |
   |-----|---------|
   | ❌ 看到日志 `Error` 就认为是根本原因 | ✅ 必须先查仪表盘采集能量/关键指标 |
   | ❌ `capture first frame` 成功 = 采集正常 | ✅ 采集链路正常 ≠ 采集能量正常 |
   | ❌ `0x80070490` 错误导致无声 | ✅ 该错误只是硬件增益控制警告 |
   | ❌ `under threshold: 0.2` = 实际为预期的 20% | ✅ 0.2 是阈值常量，看 real/expect 绝对值比例 |
   | ❌ `VideoStatsInfo capture fps` 跌 = 摄像头硬件慢 | ✅ 它含下游反压，需结合 §4.6 鉴别清单 |
   | ❌ 多链路同时异常 = 系统级资源紧张 | ✅ 先用 §4.7 排除美颜单点反压级联 |

---

## 关联文档

- 深度日志模式（具体日志特征/因果链/三模式鉴别表） → `trtc-deep-log-patterns.md`
- 音频模块完整诊断链路 → `trtc-audio-diagnostics.md`
- 屏幕分享完整诊断链路 → `trtc-screen-share-diagnostics.md`
- 已知问题速查 → `trtc-known-issues.md`
- 产品概念（UserSig/RoomID/防火墙） → `trtc-product-concepts.md`
- 结论格式与安全输出规范 → `../SKILL.md` §5
