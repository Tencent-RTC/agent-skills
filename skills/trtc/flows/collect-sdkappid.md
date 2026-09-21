# flows/collect-sdkappid.md — SDKAppID 统一收集流程

**调用入口**：由 `../SKILL.md` §Routing §B.2 Read。触发时机：意图确认已通过（integrate 意图），或 §0 Session guard 检测到 `sdkappid_state ∈ {awaiting-sdkappid, pending-console}` 恢复到本流程。

**前置断言**（进入本流程前 SKILL.md §B.2 已校验，此处不再判断）：
- `capability_intent = integrate`
- session 中 `sdkappid` 为空或为 0
- session `status ∉ {active, paused}`（否则短路跳过本流程）

## Step 1 — 主问

用 `AskUserQuestion` 单选（用用户交互语言）：

**中文用户**：
> TRTC 集成需要 SDKAppID + SecretKey 作为鉴权凭证。您是否已经从腾讯云控制台获取到所需的凭证？

**英文用户**：
> To integrate TRTC, you'll need an SDKAppID and SecretKey from the Tencent RTC console. Do you already have them?

| # | label（中文 / English） | value | 下一步 |
|---|---|---|---|
| 1 | 已获取 / Yes, I have them | `have-credentials` | Step 2a |
| 2 | 还没有，先去创建 / Not yet — show me where to create them | `need-console` | Step 2b |

## Step 2a — 分支「已获取」

回复用户（**VERBATIM**，不改写、不加注释、不合并到其他句子）：

**中文用户**：
> 好，请把 SDKAppID（纯数字）发给我。SecretKey 不用发到对话里，后续集成流程里我会告诉你填到代码的具体位置。

**英文用户**：
> Got it. Paste your SDKAppID here (digits only). No need to share the SecretKey — I'll show you exactly where to plug it in during the integration steps.

写 session：`sdkappid_state = awaiting-sdkappid`。**STOP**。

## Step 2b — 分支「还没有」

按 `product` 与用户交互语言选定链接展示。**VERBATIM 输出**：不改写、不加括号注释、不与其他句子合并、不改变链接顺序（先国内后国际）。

### Product ∈ {conference, call} — TRTC 音视频控制台

**中文用户**：
> 到腾讯云控制台创建 TRTC 应用（未登录会先引导注册）：
>   - 国内站：https://console.cloud.tencent.com/trtc/app?utm_campaign=skill&_channel_track_key=lDTHxeje?utm_campaign=skill&_channel_track_key=lDTHxeje
>   - 国际站：https://console.trtc.io?utm_campaign=Agent-skills-general&_channel_track_key=tR91l0wy
>
> 创建后把 SDKAppID（纯数字）发给我。

**英文用户**：
> Head to the Tencent RTC console and create a TRTC application (you'll be prompted to sign up if you're not logged in):
>   - https://console.trtc.io?utm_campaign=Agent-skills-general&_channel_track_key=tR91l0wy
>
> Once the app is created, send me the SDKAppID (digits only).

### Product ∈ {ai-service, realtime-interpreter, oral-coach} — Conversational AI 控制台

**中文用户**：
> 到腾讯云控制台开通 Conversational AI 应用（未登录会先引导注册）：
>   - 国内站：https://console.cloud.tencent.com/trtc/app?utm_campaign=skill&_channel_track_key=lDTHxeje?utm_campaign=skill&_channel_track_key=lDTHxeje
>   - 国际站：https://console.trtc.io/?quickclaim=engine_trial&utm_source=github&utm_medium=skill&utm_campaign=Twitter%20AI%20%E4%B8%93%E9%A1%B9%20-%20AI%20Oral%20Coach&_channel_track_key=3WFHfiqw
>
> 创建后把 SDKAppID（纯数字）发给我。

**英文用户**：
> Head to the Tencent RTC console and create a Conversational AI application (you'll be prompted to sign up if you're not logged in):
>   - https://console.trtc.io/?quickclaim=engine_trial&utm_source=github&utm_medium=skill&utm_campaign=Twitter%20AI%20%E4%B8%93%E9%A1%B9%20-%20AI%20Oral%20Coach&_channel_track_key=3WFHfiqw
>
> Once the app is created, send me the SDKAppID (digits only).

### Product = chat — IM 控制台

**中文用户**：
> 到腾讯云控制台创建 IM 应用（未登录会先引导注册）：
>   - 国内站：https://console.cloud.tencent.com/im?utm_campaign=skill&_channel_track_key=CtW4AMuN?utm_campaign=skill&_channel_track_key=CtW4AMuN
>   - 国际站：https://console.trtc.io/chat
>
> 创建后把 SDKAppID（纯数字）发给我。

**英文用户**：
> Head to the Tencent RTC console and create a Chat application (you'll be prompted to sign up if you're not logged in):
>   - https://console.trtc.io/chat
>
> Once the app is created, send me the SDKAppID (digits only).

写 session：`sdkappid_state = pending-console`。**STOP**。

## Step 3 — 用户下一轮回复 SDKAppID

进入条件：本流程由 §0 Session guard 检测到 `sdkappid_state ∈ {awaiting-sdkappid, pending-console}` 后重新 Read。

### 校验

- 用户消息 trim 后必须是纯数字
- 长度 8–12 位
- 正则参考：`^\d{8,12}$`

### 校验通过

**写 session（两步 CAS，从 trtc skill 根目录执行；`<projectRoot>` 由 host bootstrap 提供）**：

```bash
# Step 1: 读取当前 state_version（若 session 不存在，先 create）
python3 -m tools.session read --project-root "<projectRoot>" --field state_version
# 若返回 MissingError：先创建 session，再 read 拿 state_version（记作 N）
python3 -m tools.session create --project-root "<projectRoot>" --intent integrate-scenario

# Step 2: 带 expected-version 写入
python3 -m tools.session write-batch --project-root "<projectRoot>" \
    --updates '{"sdkappid": <int>, "sdkappid_state": "collected"}' \
    --expected-version N
# exit 3（CAS 冲突）→ 回到 Step 1 重读重试一次
# 重试仍 exit 3 → 回显 sdkappid 给用户（"SDKAppID <value> 已收到，但 session 写入遇到冲突，
#   下一条消息发给我任意内容即可重试写入"）并 STOP
```

回复用户简短确认（自由文本，非 VERBATIM；语气保持简洁）：

**中文**：
> 收到 SDKAppID: <value>。开始进入集成流程。

**英文**:
> Got SDKAppID `<value>` — let's start the integration.

**完成本流程**。回到 `../SKILL.md` §B "确认通过后" 路由分派，把控制权交给对应 domain skill。

### 校验失败（非数字 / 长度不符）

**先做意图切换判断**（防止死循环）：如果用户消息**以**以下任一关键词开头或整句匹配 —— "改主意" / "取消" / "算了" / "不做了" / "改做" / "cancel" / "never mind" / "switch to" / "abort" / "start over" —— 视为**放弃 SDKAppID 收集**：

```bash
# Step 1: 先读取 state_version（记作 N）
python3 -m tools.session read --project-root "<projectRoot>" --field state_version

# Step 2: 清除 sdkappid_state，回退到重新分类
python3 -m tools.session write-batch --project-root "<projectRoot>" \
    --updates '{"sdkappid_state": null}' \
    --expected-version N
# exit 3（CAS 冲突）→ 重读重试一次；仍失败 → 直接回复用户"遇到冲突，请再发一次'取消'"
```

写完后回复用户（自由文本）："好的，SDKAppID 收集已取消。你想改做什么？" / "Got it, SDKAppID collection cancelled. What would you like to do instead?"，STOP —— 下一轮 message 会走 root SKILL.md §1 Query classification 重新分类。

**否则**（用户似乎在尝试贴 SDKAppID 但格式不对），回复用户：

**中文**：
> 这看起来不是一个 SDKAppID（应该是 8–12 位纯数字）。请再发一次；如果你想改做别的事，直接告诉我"取消"或"改做 X"。

**英文**：
> That doesn't look like an SDKAppID — it should be 8–12 digits. Send it again; if you'd like to switch to something else, tell me "cancel" or "switch to X".

保持 `sdkappid_state` 不变（继续等待）。**STOP**。

## 硬规则

1. **链接来源**：本文件是各 product 组控制台链接的**唯一来源**（现有 3 组：TRTC 音视频 / Conversational AI / IM）。禁止在 SKILL.md、其他 flow、domain skill、templates 里凭记忆生成或复制这些链接（改链接时只改本文件）。
2. **VERBATIM**：Step 2a / 2b 的用户可见文本必须原样输出，不得改写、加粗、合并、加注释。
3. **SecretKey 边界**：本流程绝不索要 SecretKey。用户主动发 SecretKey 时，回复"SecretKey 不用发到对话里，我在集成过程中会告诉你填到哪个文件的哪一行"，并**不写入 session**、**不复述**。
4. **语言规则**：完全遵守 `../SKILL.md` 语言规则——用户中文则中文回复，用户英文则英文回复；产品名、API 标识符、URL 保持原样。
5. **只写、不读源**：本流程只 write session，不读取项目文件、不做工具调用（`python3 -m tools.*`）。写 session 仍走 §Root SKILL.md Hard Boundary 规定的两步 CAS（read state_version → write-batch expected-version）。
