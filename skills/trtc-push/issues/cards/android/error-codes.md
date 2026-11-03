---
doc_source:
  - faq-android-800005
  - faq-android-vivo-10302
  - faq-android-vivo-10096
  - faq-android-xiaomi-errors
  - faq-harmony-80300002
  - faq-android-huawei-80300002
  - doc-error-codes
doc_revision: c8a142b7
---

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
- vivo 服务端发送：`10302`、`10096`、`10097`
- 小米服务端发送：`10016`、`10041`、`200001`
- 服务端发送：`80300002`（鸿蒙与华为 Android 原因不同，见该节分流）

不适用于：

- 无错误码的「收不到」现象主链（P2：offline flow）。
- iOS `InvalidProviderToken` → `../ios/p8-invalid-provider-token.md`。

## 共同根因

错误码有权威层级，**禁止把码义收窄成单一厂商故事**：

1. TIMPush 客户端码（800005/800006/800008）→ 码义以产品「错误码」文档为准。
2. 厂商服务端码（10302、10096/10097、小米 10016/10041/200001、80300002）→ 以厂商官方说明和官网 FAQ 为准。
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

## 80300002 — 对指定 Token 下发无权限（服务端发送）

**先按 `errMsg` 分流**（同一个码在鸿蒙和华为 Android 里原因不同）：

| 信号 | 归属 | 处理 |
|---|---|---|
| `errMsg` 含 `harmony requestid`，如 `No permission to send message to these tmIDs` | **HarmonyOS 推送** | 以官网 FAQ「HarmonyOS 推送报错 80300002」为准：IM 控制台证书凭证没有在正确项目下创建，或密钥文件里的 `project_id` 与应用在 AppGallery Connect 的项目 ID 不一致。逐项核对厂商配置里「创建 IM 控制台证书凭证」一步 |
| 无 `harmony requestid`，华为 Android 通道回执 | **华为 Android 服务端下发** | 见下方「排查要点（华为 Android 服务端下发）」 |

**权威码义（华为服务端）**：下发消息给指定用户（Token）报无权限。

**不是**：不要默认当成鸿蒙客户端 `registerPush` 失败的唯一解释。鸿蒙客户端注册问题
走 `../../flows/harmonyos/offline-not-received.md`（如 `1000900010` 等）。

### 排查要点（华为 Android 服务端下发）

处理步骤以官网 FAQ「华为推送报错 80300002（Android）」为准，逐项核对：

1. AppGallery Connect「项目设置 > API 管理」已开启推送服务权限。
2. IM 控制台华为证书的 AppID / AppSecret，与客户端 `agconnect-services.json` 属于同一个华为**应用**（项目级与应用级各有一组 Client ID / Secret，取应用级）。
3. 应用在国内推送正常、仅海外环境报错：需开通海外 Push 权益（AppGallery Connect「开发与服务」> 应用 >「项目设置 > API 管理」，关闭 Push 服务后重新启用；若只开通推送服务，先在应用市场上传 APK 并保存草稿，否则重新添加应用时可能找不到原应用）。官网《错误码》页有华为 80300002 的完整处理方法。
4. 在华为推送运营平台用同一 Token 试推，区分配置 / 权益问题与 Token 问题。

OAuth Access Token 转义、多发送者属于开发者直接调用华为接口的场景；腾讯云场景由腾讯云服务端调用，**不要**让用户排查这两项。

### 与鸿蒙客户端的边界

- 客户端注册失败、AGC 身份 / Profile → Harmony flow。
- 发送回执 80300002：先按上表 `errMsg` 分流，鸿蒙走 FAQ 的 `project_id` 核对，华为 Android 走本节。

### 验证

- 华为侧试推或腾讯云经华为通道下发成功；或明确为权益/Token 不一致并已修正。

---

## 10096 / 10097 — vivo 消息分类参数错误（服务端发送）

**码义（以官网 FAQ 为准）**：

- `10096`：`category` 的取值无效，`category` 必须大写。
- `10097`：`category` 与 `classification` 不是正确的对应关系，例如 `classification` 为 0（运营消息）时 `category` 填了 `IM`。

### 排查要点

1. 确认是**发送阶段**回执，不是客户端注册失败。
2. 取发送侧实际传的 `category` 和 `classification`（控制台默认值与 REST / 客户端覆盖值都要看）。
3. IM 聊天消息 `category` 填大写 `IM`；其他消息按 vivo 消息分类说明取值。
4. vivo 建议只传 `category`、不传 `classification`；同时传时核对对应关系。

### 验证

- 改正后同一设备再发，不再返回 10096 / 10097。
- 与分类限额类问题互链：`message-category-limit.md`。

---

## 小米 10016 / 10041 / 200001 — 小米通道下发失败（服务端发送）

**码义（以官网 FAQ 为准）**：

- `10016`：缺失必选参数，缺哪个以回执 `reason` 为准。私信消息需同时带 `channel_id`、模板 id、模板参数；`reason` 指向模板参数为空时，核对控制台证书或发送参数里是否配置了小米 ChannelID、模板 ID 和模板参数。
- `10041`：`reason` 为 `Template parameter value must be String type`。检查模板参数 JSON 中每个变量值是否都是字符串，且参数个数与模板预配置一致。
- `200001`：超过小米当日推送数量限制（`reason` 为 `exceed quota`）。私信消息不限量，公信消息单日总量按应用通知开启用户数乘以倍数计算；响应里 `day_quota` 与 `day_acked` 分别是当日可下发总量和已送达数。

### 排查要点

1. 必须拿到**回执原文的 `reason`**，不要只凭码判断。
2. 10016 / 10041：核对私信模板参数（ChannelID、模板 ID、模板参数）及其类型和个数。
3. 200001：确认消息是公信还是私信；IM 聊天类建议接入私信消息；确需提高额度走小米官方申诉。

### 验证

- 修正参数后再发不再返回对应码；或 200001 已通过接入私信消息规避。

---

## 11043（弱说明，未证实）

工单/日志中偶发 `11043`，**未在 vivo 公开错误码表中坐实**。若同时有「每天只能收几条」
等限额特征 → 弱匹配 `message-category-limit.md`，文案标注「疑似 / 请核对厂商回执原文」。
不要把 11043 写成官方确定码义。
