# TRTC 音频模块诊断链路（Windows 深度）

> 将音频模块的日志关键字映射到其产生的**模块**、**触发条件**和**因果链关系**。
> 与 `audio-troubleshooting.md`（跨平台症状速查）互补：本文档聚焦 Windows 音频子系统（WASAPI/watchdog/3A）的模块级深度诊断。

---

## 目录

- [1. 模块架构总览](#1-模块架构总览)
- [2. AudioIOWatchdog（IO 看门狗）](#2-audioiowatchdogio-看门狗)
- [3. AudioRecorderWasapi（Windows WASAPI 采集）](#3-audiorecorderwasapiwindows-wasapi-采集)
- [4. AudioRecorderSafeWrapper（采集安全包装层）](#4-audiorecordersafewrapper采集安全包装层)
- [5. DeviceHealthMonitor（设备健康监控）](#5-devicehealthmonitor设备健康监控)
- [6. IOWorkingStatusPrinter（IO 状态打印器）](#6-ioworkingstatusprinterio-状态打印器)
- [7. AudioTrackHealthMonitor（音频轨道健康监控）](#7-audiotrackhealthmonitor音频轨道健康监控)
- [8. DesktopActiveDeviceDecider（桌面设备决策器）](#8-desktopactivedevicedecider桌面设备决策器)
- [9. 音频无声问题完整因果链（Windows）](#9-音频无声问题完整因果链windows)
- [10. 常见 HRESULT 错误码与含义](#10-常见-hresult-错误码与含义)
- [11. 标准分析路径](#11-标准分析路径)

---

## 1. 模块架构总览

```
音频引擎
├── IO 层（数据采集/播放 + 看门狗监控）
│   ├── AudioIOWatchdog — 数据流监控看门狗
│   ├── AudioRecorderWasapi — Windows WASAPI 麦克风采集
│   ├── AudioPlayerWasapi — Windows WASAPI 播放
│   └── AudioLoopbackRecorder — Windows 系统音频回采
├── 设备管理层（设备切换/重启/静音检测）
│   ├── AudioRecorderSafeWrapper — 采集器安全包装（含重启逻辑）
│   ├── AudioSilenceDetector — 静音检测
│   ├── DesktopActiveDeviceDecider — 桌面设备热插拔决策
│   └── AudioDeviceEventNotifier — Windows 设备事件通知
├── 统计层（健康监控/状态输出）
│   ├── DeviceHealthMonitor — 设备健康评分
│   └── IOWorkingStatusPrinter — IO 状态周期性打印
└── 轨道监控
    └── AudioTrackHealthMonitor — 轨道健康（hunger/overflow）
```

**数据流链路（正常采集）**：
```
硬件麦克风 → WASAPI 采集线程 → 分发数据 → FeedDog(watchdog) + 上报给上层
```

**异常处理链路**：
```
watchdog 定时检测 → 发现数据异常 → 滑动窗口评分累加
    → 评分达到阈值 → 通知 IO 异常
        → WASAPI 录音器收到通知
            → 执行重启流程：Stop() + Start()（重启设备）
```

---

## 2. AudioIOWatchdog（IO 看门狗）

### 核心参数

| 参数 | 值 | 含义 |
|------|---|------|
| 检测周期 | 2 秒 | 定时检查数据量 |
| 滑动窗口大小 | 2（Windows） | 需要连续异常几次才评分 |
| 重启阈值 | 1（Windows） | 异常分数达到多少触发重启 |
| 严重异常偏差阈值 | 0.2 | 实际数据偏离预期超过 20% 即为严重异常 |
| 轻微异常偏差阈值 | 0.1（Android/OHOS） | 偏离 10% 为轻微异常 |

### 日志关键字与含义

| 日志关键字 | 触发条件 | 诊断意义 |
|-----------|---------|---------|
| `Start watchdog for type XXX` | 采集/播放设备启动时 | 看门狗开始监控 |
| `Stop watchdog for type XXX` | 采集/播放设备停止时 | 看门狗停止监控 |
| `Audio total data size is under threshold: 0.2 expect is X, real is Y` | 实际数据量偏离预期超过阈值 | ⭐ 核心告警：real=0 表示完全无数据，real≈0.5×expect 表示数据断一半 |
| `audio io abnormal, source type: XXX` | 滑动窗口评分达到重启阈值 | ⭐ 即将触发设备重启 |
| `audio io energy constant, energy: X, count: Y` | 连续 500+ 帧能量值恒等（>20） | 数据在流但内容恒定（可能采集到的是噪声底） |
| `App switch to background, reset check tick` | App 切到后台 | 暂停检测，避免误报 |
| `App switch to foreground from background` | App 回到前台 | 重置检测器 |

### 检测逻辑说明

**数据量判定**：
```
期望数据量 = 本检测周期经过的时间（ms）
实际数据量 = 累计接收到的音频数据转换为时长（ms）
下限 = 期望 × (1 - 0.2) = 期望 × 0.8
上限 = 期望 × (1 + 0.2) = 期望 × 1.2
异常 = 实际 < 下限 或 实际 > 上限
```

⚠️ **关键理解**：日志中的 `threshold: 0.2` 是偏差容忍度参数（即 20%），**不是** real/expect 的比值！

**滑动窗口评分机制**：
```
每个检测周期评估数据量 → 得到 Normal / SlightlyAbnormal / SeriouslyAbnormal
→ 放入滑动窗口（大小=2）
→ 如果窗口内全部是 SeriouslyAbnormal → 直接达到重启阈值
→ 触发重启
```

**Windows 含义**：滑动窗口=2, 重启阈值=1 → 连续 2 个检测周期（约 4 秒）都是严重异常就触发重启。

**能量恒定检测**：
```
每帧检查能量值
如果连续 500+ 帧（约 5 秒）能量值完全相同且 > 20 → 通知能量恒定异常
冷却时间：2 分钟内不会重复触发
豁免条件：能量 ≤ 20 不计数（降噪耳机静默时能量极低是正常的）
```

---

## 3. AudioRecorderWasapi（Windows WASAPI 采集）

### 核心参数

| 参数 | 值 | 含义 |
|------|---|------|
| Stop 超时 | 2000 ms | 等待采集线程退出的最长时间 |
| Start 超时 | 5000 ms | 等待采集线程就绪的最长时间 |
| 能量异常音量门槛 | 10 | 音量高于此值时能量恒定才会触发重启 |

### 日志关键字与含义

| 日志关键字 | 触发条件 | 诊断意义 |
|-----------|---------|---------|
| `record device started already!` | 重复调用 Start | 逻辑异常（不应发生） |
| `active device pid is empty!` | 设备 ID 为空 | 设备未正确指定 |
| `capture device:XXX start succeed` | WASAPI 采集启动成功 | ⭐ 设备启动正常的标志 |
| `record device stopped already!` | 重复调用 Stop | 逻辑异常（不应发生） |
| `failed to close down capture thread in 2 second` | 采集线程退出超时 | ⚠️ 采集线程被阻塞，可能 COM 调用卡住 |
| `capture device:XXX succeed, stop capture thread duration(ms):Y` | 停止完成 | 记录停止耗时 |
| `capture device:XXX with sampleRate:Y channels:Z bits:W ...` | WASAPI 格式协商完成 | 记录设备实际采集参数（⭐ 慢放问题关键行，见 `trtc-deep-log-patterns.md` §10.9） |
| `XXX is abnormal, current restart count: N` | watchdog 触发重启 | ⭐ 设备正在重启，N=已重启次数 |
| `energy abnormal with volume: X, mute: Y` | 能量恒定检测触发后检查音量 | 判断是否因为音量为0导致能量恒定 |
| `windows hardware 3a enable: true/false` | 硬件 3A 配置变更 | 硬件前处理开关状态（< 13.3 版本） |
| `windows recorder hardware 3a: 1` / `0` | 硬件前处理开关 | `1`=开启，`0`=关闭（≥ 13.3 版本，新格式） |

### WASAPI 采集生命周期

```
Start() [主线程]
├── 检查是否已启动（防重入）
├── 创建看门狗
├── 检查设备有效性
├── 创建采集线程（高优先级）
└── 输出 "capture device:XXX start succeed"

采集线程运行
├── 初始化 WASAPI（格式协商）
│   ├── 获取 IMMDevice → 激活 IAudioClient → 获取设备混合格式
│   ├── 输出 "capture device:XXX with sampleRate:..."
│   ├── 初始化音频客户端 → 获取 IAudioCaptureClient
├── 数据采集循环（等待缓冲区事件 → 获取数据 → 分发[喂狗+上报] → 释放缓冲区）
└── 释放 COM 资源

Stop() [主线程]
├── 停止看门狗 → 通知采集线程退出 → 等待线程退出（超时 2 秒）
│   └── 超时则输出 "failed to close down capture thread in 2 second"
└── 输出 "capture device:XXX succeed, stop capture thread duration(ms):Y"
```

### 重启流程

```
watchdog 通知 IO 异常（需要重启）
→ WASAPI 录音器收到通知 → 发送到平台 API 线程执行
    ├── 检查条件：设备匹配 && 已启动 && 需要重启 && 未超过最大重启次数
    ├── 输出 "XXX is abnormal, current restart count: N"
    ├── 计算下次重启间隔（逐步退避）
    ├── 调整 watchdog 灵敏度
    ├── 通知上层设备异常
    ├── Stop() — 停止当前采集
    ├── Start() — 重新启动采集
    └── 广播重启事件
```

**⚠️ 重启失败场景**：如果 Stop() 中的 WASAPI COM 操作因 RPC 故障（如 `0x800706BE`）而阻塞/失败，则重启后 Start() 中的初始化也会失败（如 `0x80040154`），导致**持续无声**。

---

## 4. AudioRecorderSafeWrapper（采集安全包装层）

### 核心参数

| 参数 | 值 | 含义 |
|------|---|------|
| 重启频率限制 | 最低 1000 ms 间隔 | 避免过于频繁重启 |
| 回调错误累计上限 | 3 | 达到后触发重启 |
| 健康异常最大重启次数 | 3 | 因健康度低导致的重启上限 |
| 长静音最大重启次数 | 1 | 因持续静音导致的重启上限 |
| 非中断静音最大重启次数 | 3 | 非硬件中断的静音重启上限 |

### 日志关键字与含义

| 日志关键字 | 触发条件 | 诊断意义 |
|-----------|---------|---------|
| `start XXX` (AudioDeviceProperties) | 采集器启动 | 包装层发起启动 |
| `start recorder.` | 平台录音器启动完成 | 底层启动成功 |
| `stop recorder.` | 平台录音器停止完成 | 底层停止成功 |
| `restarted XXX` (AudioDeviceProperties) | 重启完成（Stop+Start） | 设备重启完成 |
| `Recorder restarted for error XXX for api YYY` | 异常重启广播 | 通知上层重启原因 |

### 层级关系

```
SafeWrapper（设备管理层）
└── 管理底层录音器（IO 层）
    └── 具体实现：WASAPI (Windows) / AudioRecorderAndroid (Android) 等
```

SafeWrapper 负责：**频率限制**（最低 1 秒间隔）、**权限检查**、**重启次数上限**（避免无限重启）。

⚠️ **Windows 平台特殊**：Windows 的 WASAPI 录音器自己直接处理 watchdog 通知并执行重启，不经过 SafeWrapper 的重启逻辑。SafeWrapper 在 Windows 上主要处理设备切换（默认设备变更等）。

---

## 5. DeviceHealthMonitor（设备健康监控）

### 核心参数

| 参数 | 值 | 含义 |
|------|---|------|
| 检测周期 | 2000 ms | 每 2 秒计算一次健康值 |
| 健康值下限 | 1900 | 低于此值为不健康 |
| 健康值上限 | 2100 | 高于此值为不健康 |
| 首帧观测窗口 | 500 ms | 至少需要 500ms 数据才开始评估 |
| 启动超时 | 5000 ms | 超过 5s 无首帧则判定启动失败 |
| 正常基准值 | 2000 | 健康值归一化基准 |

### 健康值计算公式

```
speed = 新增数据时长 / 经过时间
healthy = speed × 2000
```

- `healthy ≈ 2000` → 正常（数据按预期速率产出）
- `healthy < 1900` → 不健康（数据产出不足）
- `healthy > 2100` → 不健康（数据产出过多）
- `healthy = 0` → 设备启动失败（超过 5s 无首帧）

### 监控类型

| 监控类型 | 上报字段 | 含义 |
|---------|---------|------|
| 采集监控 | `capture_health` | 麦克风采集健康度 |
| 预处理监控 | `dsp_processing_health` | 3A 处理健康度 |
| 播放监控 | `thread_health` | 播放线程健康度 |

日志关键字：`Start XXX health monitoring.` / `Stop XXX health monitoring.`

---

## 6. IOWorkingStatusPrinter（IO 状态打印器）

### 行为特征

- 每 **40 秒** 打印一次 IO 状态统计
- 只有数据变化超过 **10%** 才输出（避免刷屏）
- 分别统计 recorder / player / loopback 三路

### 日志关键字与含义

| 日志关键字 | 格式含义 |
|-----------|---------|
| `Within X ms, [recorder\|player\|loopback] produced Y ms data, callback count is Z, average io duration is W ms.` | X=统计窗口(~40s)，Y=产出数据时长，Z=回调次数，W=平均每次回调耗时 |

### 诊断用法

```
正常情况：
Within 40000 ms, [recorder] produced 40000 ms data, callback count is 4000, avg io duration is 10 ms.
→ 产出时长 ≈ 统计窗口 → 数据按时产出

异常情况 1（数据过载，蓝牙 HFP 采样率不匹配）：
Within 40000 ms, [recorder] produced 80000 ms data, callback count is 8000, avg io duration is 5 ms.
→ 产出时长 ≈ 2× 统计窗口 → 驱动实际采样率是声明的 2 倍

异常情况 2（数据饥饿，设备故障）：
Within 40000 ms, [recorder] produced 20000 ms data, callback count is 2000, avg io duration is 10 ms.
→ 产出时长 ≈ 0.5× 统计窗口 → 设备供数据不足

异常情况 3（设备彻底无数据）：
Within 40000 ms, [recorder] produced 0 ms data, callback count is 0, avg io duration is 0 ms.
→ 设备完全停止产出 → 可能已失联
```

---

## 7. AudioTrackHealthMonitor（音频轨道健康监控）

### 核心参数

| 参数 | 值 | 含义 |
|------|---|------|
| 帧读取延迟异常阈值 | 60 ms | 超过此值计为异常 |
| 统计输出周期 | 约 10 秒 | 周期性打印健康统计 |

### 日志关键字与含义

| 日志关键字 | 含义 |
|-----------|------|
| `abnormal frame read delay counts: N` | 帧读取延迟 >60ms 的次数 |
| `hunger: X, overflow: Y` | track 饥饿/溢出计数 |
| `wsola stretch: X, wsola compress: Y` | WSOLA 时间拉伸/压缩操作次数 |

### 诊断意义

- **hunger > 0**：消费者（编码器/录制器）取数据时 buffer 为空 → **上游供数据不足**
- **overflow > 0**：buffer 满了还在写入 → **下游消费不及时**
- **abnormal frame read delay > 0**：取帧间隔超过 60ms（正常 10-20ms）→ 处理链路存在阻塞
- **wsola stretch > 0**：NetEQ 在拉伸音频弥补网络抖动

---

## 8. DesktopActiveDeviceDecider（桌面设备决策器）

处理三种设备事件：**DeviceAdded**（新设备接入）、**DeviceRemoved**（设备移除）、**DefaultDeviceChanged**（系统默认设备变更）。

### 日志关键字

| 日志关键字 | 含义 |
|-----------|------|
| `Default device changed` | 系统默认音频设备变更 |
| `Device added` | 新音频设备接入 |
| `Device removed` | 音频设备移除 |
| `Switch to device XXX` | 切换到新设备 |

### 设备切换对采集的影响

```
系统默认麦克风变更 → 设备决策器收到通知 → 通知 SafeWrapper
→ 执行重启（Stop + 使用新设备 Start）
→ 切换期间有短暂静音（数百 ms，正常现象）
```

事件转发链：`Windows Audio Service → 系统回调 → AudioDeviceEventNotifier → 设备决策器 → SafeWrapper/录音器 → 设备重启或切换`

---

## 9. 音频无声问题完整因果链（Windows）

### 典型场景：WASAPI 设备故障导致持续无声

```
时间线：
T+0s    正常采集中，WASAPI 采集线程运行正常
T+Xs    Windows Audio Service (AudioSrv) RPC 通信异常
        → 获取音频缓冲区操作返回错误（如 0x800706BE）
        → 采集循环退出或无法获取数据
T+Xs    watchdog 检测到数据量为 0 → 判定为严重异常
T+2周期 滑动窗口连续 2 次严重异常（约 4 秒）
        → 输出 "Audio total data size is under threshold: 0.2 expect is X, real is 0"
        → 通知 IO 异常 → 输出 "audio io abnormal, source type: recorder"
T+重启  执行设备重启
        → 输出 "XXX is abnormal, current restart count: N"
        → Stop() [等待旧采集线程退出]
            → 可能输出 "failed to close down capture thread in 2 second"
        → Start() [重新创建采集]
            → 初始化 WASAPI 时激活/初始化操作失败
            → 错误码：0x80040154 或 0x800706BE
            → 采集无法恢复 → 持续无声
T+再次  下个 watchdog 周期再次触发重启，但 COM 组件仍不可用，继续失败
```

### 关键日志特征（按时间顺序出现）

```
1. [IOWorkingStatusPrinter] "Within 40000 ms, [recorder] produced 0 ms data"
   → 确认设备彻底无数据
2. [AudioIOWatchdog] "Audio total data size is under threshold: 0.2 expect is X, real is 0"
   → watchdog 告警
3. [AudioIOWatchdog] "audio io abnormal, source type: recorder"
   → watchdog 判定异常
4. [AudioRecorderWasapi] "XXX is abnormal, current restart count: N"
   → 触发重启
5. [AudioRecorderWasapi] "failed to close down capture thread in 2 second" (如果线程卡住)
   → 旧线程无法正常退出
6. [AudioRecorderWasapi] "capture device:XXX start succeed" (如果重启成功)
   → 或者初始化失败日志（如果重启失败 → 持续无声）
```

### 根因分类与对应日志特征

| 根因 | 日志特征 | 严重程度 |
|------|---------|---------|
| Windows Audio Service RPC 故障 | HRESULT `0x800706BE`、`0x80040154` | 严重（需重启服务） |
| 麦克风驱动崩溃/断开 | `AUDCLNT_E_DEVICE_INVALIDATED`（`0x88890004`） | 中等（重新插入可恢复） |
| 蓝牙耳机断开 | 设备 removed + 默认设备切换日志 | 可恢复（自动切换） |
| 麦克风权限被收回 | `E_ACCESSDENIED`（`0x80070005`） | 需用户操作 |
| 驱动采样率声明错误 | `real ≈ 2× expect` + 反复重启 | 慢放问题而非完全无声 |

---

## 10. 常见 HRESULT 错误码与含义

| HRESULT | 含义 | 对音频的影响 |
|---------|------|------------|
| `0x800706BE` | RPC 远程调用失败 | Windows Audio Service 通信中断，所有 WASAPI 操作失败 |
| `0x80040154` | 类没有注册 | COM 组件不可用，无法创建 AudioClient |
| `0x88890004` | 音频设备已失效 | 设备被拔出或驱动崩溃 |
| `0x80070005` | 拒绝访问 | 麦克风权限被系统策略阻止 |
| `0x88890008` | 格式不支持 | 设备不支持请求的音频格式 |
| `0x88890003` | 端点类型错误 | 设备类型不匹配（如用播放设备做采集） |
| `0x80070490` | 元素未找到 | 设备属性查询失败，通常不影响基本采集 |
| `0x8007007E` | 模块未找到 | 驱动 DLL 缺失 |
| `0x800706BA` | RPC 服务器不可用 | AudioSrv 服务未运行 |

### 错误码诊断决策树

```
HRESULT 错误码
├── 0x800706BE / 0x800706BA → Windows Audio Service 故障
│   ├── 建议：重启 Windows Audio 服务 (AudioSrv / AudioEndpointBuilder)
│   └── 如果频繁发生：检查音频驱动是否有冲突（Intel SST 已知问题）
├── 0x80040154 → COM 组件注册异常
│   ├── 通常伴随 0x800706BE 出现（RPC 故障的连锁反应）
│   └── 根因同上
├── 0x88890004 → 设备失效
│   ├── USB 设备：重新插拔
│   ├── 蓝牙设备：重新连接
│   └── 内置设备：驱动问题，更新驱动
├── 0x80070005 → 权限问题
│   ├── Windows 隐私设置：设置 → 隐私 → 麦克风
│   └── 企业策略：GPO 限制
└── 0x80070490 → 设备属性查询失败
    └── 通常无影响，仅是硬件增益控制不可用的警告
```

---

## 11. 标准分析路径

### 音频无声问题的标准分析路径

1. **先搜索 watchdog 告警**：
   ```bash
   grep -n "Audio total data size is under threshold" <log>
   grep -n "audio io abnormal" <log>
   ```
   → 确认是否有数据流异常

2. **确认重启情况**：
   ```bash
   grep -n "is abnormal, current restart count" <log>
   grep -n "capture device.*start succeed" <log>
   ```
   → 看重启了几次，是否重启成功

3. **查找 HRESULT 错误码**：
   ```bash
   grep -nE "HRESULT|0x8[0-9A-Fa-f]{7}|failed" <log>
   ```
   → 确认失败原因

4. **查看 IO 状态统计**：
   ```bash
   grep -nE "Within.*ms.*recorder.*produced" <log>
   ```
   → 确认数据产出是否中断

5. **查看设备事件**：
   ```bash
   grep -nE "Default device changed|Device added|Device removed" <log>
   ```
   → 是否有设备热插拔导致切换

6. **查看健康度**：`grep "capture_health" <log>`

### 结论模板

```
## 根因
[设备/驱动/服务/权限] 问题导致 WASAPI 采集 [数据中断/启动失败/格式异常]

## 证据链
1. [时间] watchdog 检测到数据异常（expect=X, real=Y）
2. [时间] 触发设备重启（restart count=N）
3. [时间] 重启 [成功/失败]（HRESULT=0xXXXX）
4. [时间] 最终状态：[恢复正常/持续无声]

## 建议
- 根据 HRESULT 对照 §10 错误码表给出针对性建议
```

---

## 关联文档

- 无声问题决策树（上行 15 类/下行 6 类 + WASAPI 深度诊断入口） → `trtc-analysis-playbook.md` §2
- 回声问题决策树（AEC 参考信号健康检查） → `trtc-analysis-playbook.md` §2.5
- 蓝牙 HFP 慢放 / 192kHz AEC overrun 等深度模式 → `trtc-deep-log-patterns.md` §10.9/§10.10
- 跨平台音频症状速查 → `audio-troubleshooting.md`
