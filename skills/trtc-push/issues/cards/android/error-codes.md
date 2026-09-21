# Android / 厂商错误码快路径

## 与 MCP 的关系

本文件是 **知识卡**，不拥有独立主链。

- ROUTER `workflow_id`：`troubleshoot-android`
- 关联 flow：`flows/android/register-failed.md / offline-not-received.md`
- 挂载：主要挂 `stage-4-register-observation`（错误码下钻）
- 执行仍走 MCP 状态机；命中本卡后按挂载阶段取证，禁止用本卡替代 `complete_workflow_step`。

## 适用现象

当用户反馈里出现明确错误码，且属于本节覆盖范围时，**先读本卡对应节（码义）**，再按
`errMsg` / 厂商 / 场景下钻子因卡或 flow：

- TIMPush 客户端：`800005` / `800006` / `800008`
- vivo 服务端发送：`10302`
- 华为服务端发送：`80300002`

不适用于：

- 无错误码的「收不到」现象主链（P2：offline flow）。
- iOS `InvalidProviderToken` → `../ios/p8-invalid-provider-token.md`。

## 共同根因

错误码有权威层级，**禁止把码义收窄成单一厂商故事**：

1. TIMPush 客户端码（800005/800006/800008）→ 码义以产品「错误码」文档为准。
2. 厂商服务端码（10302、80300002）→ 以厂商官方说明为准。
3. FAQ / 子因卡只解释常见子因，不得覆盖码义。

## 必须收集的证据

- 完整错误码与 `errMsg` / 厂商回执原文。
- 设备品牌、系统、是否国内环境 / GMS。
- `registerPush` 时机（是否在 IM login 成功后）。
- `timpush-configs.json` 与对应厂商配置文件是否存在。
- 若是发送阶段：TaskId、目标 RegistrationID / regId / Token、厂商控制台发送结果。

## 排查步骤（总入口）

1. 确认码属于客户端注册还是厂商服务端发送。
2. 打开下方对应节，先复述**码义**，再按分支收集证据。
3. 命中子因后转对应子因卡；仍无解则回 `../../flows/android/vendor-not-received.md`。

## 解决方案

见各节。跨端（Flutter / uni-app）无独立错误码：命中后仍读本节，再下钻原生配置。

## 验证信号

见各节。

---

## 800005 — 本机通道注册推送失败

**权威码义（TIMPush）**：本机通道注册推送失败。

**不是**：不等于「仅 FCM / GMS 问题」。FCM unavailable 只是常见子因之一。

### 常见子因分支

| 信号 | 处理 |
|---|---|
| `FCM unavailable` / Firebase 初始化失败 / 国内无 GMS | → `fcm-gms-domestic.md` |
| 缺厂商 SDK / `timpush-configs.json` / Manifest / 混淆 | 按快速接入核对本机厂商通道配置 |
| 已明确华为/小米/OPPO/vivo 等厂商配置问题 | → `../../flows/android/vendor-not-received.md` |

### 排查要点

1. 确认设备品牌与「本机通道」应对应哪家厂商。
2. 核对厂商参数、`timpush-configs.json`、AndroidManifest、厂商 SDK、混淆。
3. 仅当日志指向 FCM/GMS 时再走 FCM 子因卡。

### 验证

- `registerPush success`，RegistrationID 非空。

---

## 800006 — 本机失败后再试 FCM 也失败

**权威码义（TIMPush）**：本机通道注册失败后，尝试 FCM 通道注册也失败。

**不是**：不等于「仅华为指纹 / 仅 AGConnect」。华为指纹是本机通道失败的常见子因。

### 排查顺序（强制）

1. **先查本机厂商通道**：品牌、厂商 SDK、AppId/Key、配置文件、包名/签名。
2. **再查 FCM 兜底**：GMS 是否可用、`google-services.json`、Firebase 初始化。
3. 华为 / 荣耀出现 `Huawei appId missing`、`certificate fingerprint empty`、`907135702`
   → `vendor-huawei.md`（子因，不替代本码义）。

### 验证

- 本机通道或（海外场景）FCM 至少一条注册成功；`800006` 消失。

---

## 800008 — 注册推送服务超时

**权威码义（TIMPush）**：注册推送服务超时。

### 排查要点

1. 确认设备品牌与系统版本是否在厂商推送支持范围内。
2. 检查厂商推送服务在设备上的可用性（服务未装、被禁用、网络不通）。
3. 查看厂商 SDK 设备兼容性要求；稍后重试；必要时换真机对照。
4. Flutter / uni-app：先确认自定义基座 / 插件含推送原生能力，再按本机厂商排。

### 验证

- 同设备重试 `registerPush` 成功，或对照机成功且本机定位到厂商服务不可用。

---

## 10302 — vivo regId 不合法（服务端发送）

**权威码义（vivo 官方）**：regId 不合法（找不到该 regId）。单推响应可看 `invalidUser.status`：

- userid 不存在
- 卸载 / 主动解订阅 / 用户清除数据（会触发客户端解订阅）
- 非测试用户（未加入测试设备集）— 测消息场景

### 排查要点

1. 确认是**发送阶段**回执，不是客户端 `registerPush` 失败。
2. 用当前设备重新 `registerPush`，拿**新** RegistrationID / regId 再测。
3. 若发测试消息：确认设备已加入 vivo 测试设备集。
4. 排除卸载、清数据、过期 token。

### 验证

- 使用新 regId 单推不再返回 10302；或 invalidUser 原因可解释并已处理。

---

## 80300002 — 华为对指定 Token 下发无权限（服务端发送）

**权威码义（华为服务端）**：下发消息给指定用户（Token）报无权限。

**不是**：不要默认当成鸿蒙客户端 `registerPush` 失败的唯一解释。鸿蒙客户端注册问题
走 `../../flows/harmonyos/offline-not-received.md`（如 `1000900010` 等）。

### 排查要点（服务端下发）

1. AppGallery Connect 推送服务是否已开通。
2. Token 与鉴权令牌所属应用 / 项目是否一致。
3. OAuth Access Token 转义与 URL Encode 是否按华为文档处理。
4. 国内正常、海外 80300002 → 核对海外 Push 权益。
5. 多发送者场景核对接口与权限。
6. 可先在华为推送运营平台对同一 Token 试推，区分「接口调用错误」与「权益/Token」。

### 与鸿蒙客户端的边界

- 客户端注册失败、AGC 身份 / Profile → Harmony flow。
- 仅发送回执 80300002 → 本节。

### 验证

- 华为侧试推或腾讯云经华为通道下发成功；或明确为权益/Token 不一致并已修正。

---

## 11043（弱说明，未证实）

工单/日志中偶发 `11043`，**未在 vivo 公开错误码表中坐实**。若同时有「每天只能收几条」
等限额特征 → 弱匹配 `message-category-limit.md`，文案标注「疑似 / 请核对厂商回执原文」。
不要把 11043 写成官方确定码义。
