# TRTC 产品概念速查（日志分析必备背景）

> 本文档整理理解 TRTC/IM SDK 日志所必需的产品概念。
> 看不懂这些概念，就无法正确解读 `enterRoom` 参数、错误码和退房原因。

---

## 目录

- [1. 三要素：SDKAppID / UserID / UserSig](#1-三要素sdkappid--userid--usersig)
- [2. RoomID（数字 vs 字符串）](#2-roomid数字-vs-字符串)
- [3. 房间生命周期](#3-房间生命周期)
- [4. UserID 冲突与互踢](#4-userid-冲突与互踢)
- [5. 断线重连时序（-3301 背景）](#5-断线重连时序-3301-背景)
- [6. 防火墙白名单（进房失败/黑屏常备）](#6-防火墙白名单进房失败黑屏常备)
- [7. 高级权限控制（PrivateMapKey）](#7-高级权限控制privatemapkey)
- [8. 国际站（200 开头 SDKAppID）特殊行为](#8-国际站200-开头-sdkappid特殊行为)
- [9. 各平台默认本地日志路径](#9-各平台默认本地日志路径)

---

## 1. 三要素：SDKAppID / UserID / UserSig

TRTC SDK 进房必须提供三个关键信息，任何一个错误都会导致进房失败：

| 要素 | 说明 | 日志中的表现 |
|------|------|-------------|
| **SDKAppID** | 腾讯云后台区分不同 TRTC 应用的唯一标识，控制台创建应用时自动生成。**不同 SDKAppID 之间数据不互通** | `enterRoom [sdkAppId:1400XXXXXX...]`；错误码 -3317 / 70014 / 70020 |
| **UserID** | 标识用户，**区分大小写**，建议 ≤ 32 字节，仅英文/数字/下划线，不能全为数字 | `userId:xxx`；错误码 -3319 / 70013 |
| **UserSig** | 基于 SDKAppID + UserID + 密钥用 **HMAC-SHA256** 算得的安全签名，用于登录鉴权 | 错误码 -3320 / 6206 / 70001 / 70009 |

### UserSig 要点

- **生成算法**：HMAC-SHA256，三个输入：SDKAppID、UserID、密钥
- **两种使用方式**：
  - 客户端本地生成（仅调试用，SECRETKEY 易被反编译，**正式上线禁止**）
  - 服务端生成后下发（正式上线唯一推荐方式）
- **有效期**：官方建议不小于 24 小时（86400 秒）。过短会导致通话中频繁过期
- **过期表现**：客户端回调 `onUserSigExpired`（IM 日志锚点 `OnUserSigExpired`），错误码 6206（客户端感知）/ 70001（服务端感知）
- **验证失败错误码速查**：

| 错误码 | 含义 |
|--------|------|
| 70001 | UserSig 已过期 |
| 70009 | 验证失败（密钥/SDKAppID 不一致） |
| 70013 | UserID 不一致 |
| 70014 | SDKAppID 不一致 |
| 70016 | 密钥/公钥不存在 |
| 70020 | SDKAppID 不存在（或访问了错误的数据中心） |
| 70050 | 验证失败 + 频率超限 |

### SDKAppID 前缀含义（区域）

| 前缀 | 区域 | 说明 |
|------|------|------|
| **1400xxx** | 国内 | 北京、上海、广州、中国香港 |
| **200xxx / 400xxx** | 海外 | 国际站，部分接口行为不同（见 §8） |

---

## 2. RoomID（数字 vs 字符串）

> ⚠️ **高频踩坑点**：RoomID 区分**数字类型（roomId）**和**字符串类型（strRoomId）**，两者**不可混用**——`"123"` 和 `123` 在 TRTC 后台看来是**两个不同的房间**。

- 数字房间号取值范围：**1 ~ 4294967295**（uint32）
- 典型症状：A 端用数字 `123` 进房，B 端用字符串 `"123"` 进房，两端**互相看不到对方**
- 日志识别：`enterRoom` 参数中 `roomId:` vs `strRoomId:` 字段
- 分析"双方都在房里却看不到彼此"类问题时，**第一件事就是核对两端房间号类型是否一致**

---

## 3. 房间生命周期

### 房间创建

TRTC **没有房间创建接口**。客户端 `enterRoom` 加入一个不存在的房间时，后台自动创建。
第一个加入的用户是房间所有者，但**所有者也无法主动解散房间**。

### 解散规则

| 场景 | 规则 |
|------|------|
| 通话模式（VideoCall / AudioCall） | 所有用户主动退房 → 后台**立即解散** |
| 直播模式（LIVE / VoiceChatRoom），最后退房的是**主播** | 后台立即解散 |
| 直播模式，最后退房的是**观众** | 后台**等 10 分钟**后解散 |
| 单个用户异常掉线 | **90 秒**后服务端清理该用户 |
| 所有用户都异常掉线 | 90 秒后服务端解散房间 |

> ⚠️ **用户异常掉线的等待时长会被纳入计费用时统计。**

### 主动解散 / 踢人（服务端 API）

| API | 作用 | 客户端表现 |
|-----|------|-----------|
| `DismissRoom` | 解散房间（区分数字/字符串房间号） | 所有成员收到退房/被踢回调 |
| `RemoveUser` | 将指定用户移出房间 | 该用户收到 `OnExitRoom [code:2]`（被业务后台踢出） |

> 日志中看到 `OnExitRoom [code:2|msg:kick out room by business]` 即业务侧调用了服务端踢人 API。

### 房间容量

- 通话模式：单房间 300 人在线，最多 50 人同开摄像头/麦克风
- 直播模式：单房间 10 万观众，最多 50 人主播开摄像头/麦克风

---

## 4. UserID 冲突与互踢

> **同一个 UserID 同一时间只能在一个房间内**。相同 UserID 进入同一房间，前一个会被移出。

### 典型症状

- 客户反馈"用户频繁掉线" / "一上线就被踢"
- 大概率是业务层生成了重复 UserID，或同一账号多端登录

### 规律的重进房 = 互踢的强信号

如果日志中重进房**间隔非常规律**（固定 12s / 24s / 30s 一次），几乎可以直接锁定为**账号互踢**，而不是弱网：

- SDK 心跳每 500ms 一次，**8 秒**收不到回包触发重连，重连间隔约 **11~12 秒**
- 后台收到新的进房连接后，会**主动停止**与旧连接的通信、不再回任何信令包——是后台切断而非网络丢包，所以节奏非常规律
- 弱网导致的重进房**没有这种规律性**，间隔随网络抖动变化

### 实锤手段

| 场景 | 手段 |
|------|------|
| 不同设备互踢 | 在线日志/监控中按 `dev_uuid` 过滤：异常时段同一 RoomID/UserID 下有**两个不同 dev_uuid 交替上报** |
| 同一设备多实例互踢 | dev_uuid 相同；看 `enterRoom`/`exitRoom` 是否成对、`self:` 后的实例对象号是否每次不同；常见成因：destroy 时旧实例未清理干净，或重新 new 了实例进房 |

---

## 5. 断线重连时序（-3301 背景）

| 阶段 | 时间 | 回调 | 含义 |
|------|------|------|------|
| T1 | 断网瞬间 | — | SDK 每 500ms 发心跳 |
| T4 | 8s 未连上 | `onConnectionLost` | 提示检查网络 |
| T5 | 再 3s | `onTryToReconnect` | SDK 开始重连 |
| T6 | 每 24s | `onTryToReconnect` | 持续重连中 |
| **T∞** | **30 分钟** | **`-3301`** | **放弃重连，自动退房** |

- `-3301`（`reconnection continues to fail`）= 断线 30 分钟未恢复，SDK 放弃并退房
- 业务侧收到 -3301 后如需继续通话，**必须主动重新 enterRoom**
- 日志中相关锚点：`OnConnectionStateChanged [status:ConnectionLost / TryToReconnect]`、`OnError [code:-3301...]`

### 网络质量判读阈值（监控/日志通用）

| 指标 | 阈值 | 判读 |
|------|------|------|
| rtt | > 1s | 大概率影响互通；持续升高直到重进房/超时退房则一定影响 |
| pingRtt + rtt | 同时变差 | 实锤弱网（手机到本地路由器 RTT 与服务端 RTT 同时差，换线路也救不回来） |
| loss | > 20% | 有概率影响互通，结合下行卡顿判读 |
| 视频渲染帧率 | < 5fps | 用户主观感觉不流畅 |
| 音频卡顿时长 | 单次 > 500ms | 几乎必然被用户感知 |

---

## 6. 防火墙白名单（进房失败/黑屏常备）

TRTC 媒体传输走 **UDP**，信令走 **TCP**。办公网/企业内网常拦 UDP，导致进房失败或收不到音视频流。
服务端 IP 不固定（无法提供固定 IP 清单），必须**解除 IP 限制 + 配置端口和域名白名单**。

### 排障技巧（现象 → 结论）

| 现象 | 结论 |
|------|------|
| 能进房但收不到远端画面 | **UDP 被拦**（媒体走不通，信令还能走） |
| 完全进不去房间、无任何回调 | **TCP 443 都被拦** |
| 进房成功但延时极高 | **UDP 被降级为 TCP**（TCP 443 兜底，性能差） |

### Native SDK（iOS/Android/Windows/Mac/Flutter/Electron）

| 协议 | 端口 |
|------|------|
| TCP | 443、20166、10443~10451、13275、23275、33000、37528 |
| UDP | 8000、8080、8001~8009、16285、9000 |

域名白名单：
```
cloud.tim.qq.com
gz.file.myqcloud.com
avc.qcloud.com
yun.tim.qq.com
dldir1.qq.com
mlvbdc.live.qcloud.com
query.tencent-cloud.com
*.trtc.tencent-cloud.com
events.my-imcloud.com
apisgp.my-imcloud.com
mlvbdc.live.tlivesource.com
sdkdc.live.tlivesource.com
*.intltencentcos.com
*.tencentcos.cn
```

### Web SDK

- 信令（TCP 443）：`yun.tim.qq.com`、`*.rtc.qcloud.com`、`*.rtc.qq.com`、`*.cloud-rtc.com`、`*.my-imcloud.com`、`*.cloud-rtc.net`、`*.rtc-web.com`、`*.rtc-web.io`
- Web SDK < v4.12.0 还需 TCP 8687
- 媒体：TCP 443；UDP 8000、8080、8800、843、443、16285
- 企业内网代理方案：Nginx + coturn（见官方文档"企业内网代理方案"）

### 微信小程序

`<trtc-room>` request 合法域名：
```
https://official.opensso.tencent-cloud.com
https://yun.tim.qq.com
https://cloud.tencent.com
https://webim.tim.qq.com
https://query.tencent-cloud.com
https://events.my-imcloud.com
```

---

## 7. 高级权限控制（PrivateMapKey）

业务开启"进房权限保护"后，TRTC 后台除校验 UserSig 外还**校验 PrivateMapKey**（含加密 roomid + 8 位权限位）。

- **PrivateMapKey 必须在服务端计算**，放客户端会被逆向破解
- ⚠️ **开启后所有用户都必须传 `privateMapKey`**——线上有存量用户时不要轻易开启
- 典型症状：进房成功但切换角色/上麦被拒绝

---

## 8. 国际站（200 开头 SDKAppID）特殊行为

| 接口 | 国际站行为 |
|------|-----------|
| `startPublishing` | **不支持**，调用报 `[-102083] please turn on push switch and try later` |
| 替代方案 | 改用 `startPublishMediaStream` |

> 这条不是"开关没开"的问题，是接口本身在国际站不可用。分析日志前**先确认 SDKAppID 是不是 200 开头**。

---

## 9. 各平台默认本地日志路径

向客户索取日志时使用（若客户调过 `setLogDirPath()` 则以自定义路径为准）：

| 平台 | 默认路径 |
|------|---------|
| Android | `/sdcard/Android/data/<应用包名>/files/log/liteav/` |
| iOS / Mac | App sandbox `Documents/log` |
| Windows | `%appdata%/Tencent/liteav/log` |
| Web | 无本地文件，用控制台日志/页面日志采集 |
| 微信小程序 | 无本地文件，用微信开发者工具/体验版 vConsole |

- 文本日志：`.txt` / `.log`
- 加密二进制日志：`.xlog` / `.clog`（仅在已配置可信本地 decoder 时由 `scripts/analyze-local.js` 解码，否则获取解码后的 `.log/.txt`）
- LiteAV 分片规则：`LiteAV_C_YYYYMMDD-PID.clog`（按天+进程 ID 分片），多进程场景**必须收集全部进程的日志**

---

## 关联文档

- 进房失败完整排障决策树 → `trtc-analysis-playbook.md` §进房失败
- 错误码 JSON 数据 → `../data/api/error-code.json`
- 监控事件 ID 字典 → `trtc-event-id-mapping.md`
