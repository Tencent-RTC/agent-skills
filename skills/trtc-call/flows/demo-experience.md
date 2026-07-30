# flows/demo-experience — AI 运行时流（demo 体验）

> **触发条件**：SKILL.md Step 3 中 `form = demo-experience` 时 Read 本文件。
>
> **Session 写入**：遵循 `flows/basic-call.md` §Session 写入规约的两步 CAS 模式。
>
> **本文件不含代码块，不生成代码。**

---

## 顺序总览

```
Phase D1  凭证获取      AskUserQuestion → 已有直接填 / 无凭证引导去控制台创建
Phase D2  运行 + 互通   AskUserQuestion 选平台 → 一次展示第一端运行 + 第二端互通步骤 → STOP 等打通
Phase D3  体验后决策    AskUserQuestion → 继续集成 / 有问题 / 先不了
```

---

## Phase 续接检测

SKILL.md 路由 `active_flow = demo-experience` 时，先检查 session 字段判断从哪里续接：

| 条件 | 跳转 |
|---|---|
| `phase_a_state = has-credentials` 且 `q_demo_platform` 非空 | 跳过 D1 + D2.1，直接进 D2.2（运行引导）|
| `phase_a_state = has-credentials` 且 `q_demo_platform` 为空 | 跳过 D1，直接进 D2.1（选平台）|
| 以上均不满足 | 从 D1 开始 |

---

## Phase D1 — 凭证获取

`AskUserQuestion` 单选：

> 运行 demo 需要你自己的腾讯云 TRTC 凭证（SDKAppID + SecretKey）。现在有吗？

| # | label | 下一步 |
|---|---|---|
| 1 | 有，我会在本地 demo 中填入 | D1.2 |
| 2 | 没有，我去控制台创建 | D1.3 |

### D1.2 已有凭证

写 session `phase_a_state = has-credentials`、`q9_secret_key = null`，进入 Phase D2。
不得要求用户在对话中发送 SDKAppID 或 SecretKey；凭证只在用户本地 demo 中配置。

### D1.3 无凭证 → 控制台引导

展示：

```
1. 注册 / 登录腾讯云账号
   国内站 → https://cloud.tencent.com/register
   国际站 → https://sc-rp.tencentcloud.com:8106/t/GF

2. 创建 TRTC 应用
   国内站 → https://console.cloud.tencent.com/trtc/app
   国际站 → https://sc-rp.tencentcloud.com:8106/t/GF
   进入应用管理 → 创建应用 → 场景选"音视频通话"

3. 记录凭证：
   - SDKAppID（应用管理页的数字 ID）
   - SecretKey（应用 → 快速上手 → 密钥管理）
```

写 session `phase_a_state = needs-onboarding-pending`，`STOP`。

用户下一 turn：
- "拿到了" → 回 D1.2；若用户主动贴出 SecretKey，不复述、不写 session，提醒其立即轮换
- "卡在第 N 步" → 答疑后回 D1.3
- "先跳过" → 写 `phase_a_state = placeholder-only`、`q8_sdk_app_id = null`、
  `q9_secret_key = null`，进 D2

---

## Phase D2 — 运行 Demo + 互通测试

### D2.1 选择 demo 平台

`AskUserQuestion` 单选：

> 你想在哪个平台上跑 demo？

| # | label | 文档链接 |
|---|---|---|
| 1 | Flutter | https://trtc.io/document/60414.md |
| 2 | iOS | https://trtc.io/document/60416.md |
| 3 | Android | https://trtc.io/document/60417.md |
| 4 | Web | https://trtc.io/document/60415.md |
| 5 | React Native | https://trtc.io/document/66931.md |

写 session `q_demo_platform = <value>`。

### D2.2 运行引导 + 互通测试

一次性展示完整步骤，用户完成后再回复：

> **第一步：在你的设备上跑 demo**
> 按文档操作（5-10 分钟）：**`<对应平台文档链接>`**
> 1. 克隆 / 下载 demo（文档内有链接）
> 2. 仅在本地按 demo 文档填入 SDKAppID 和 SecretKey，不要发送到聊天或提交到版本库
> 3. 构建运行（Flutter: `flutter pub get && flutter run`；iOS 需先 `cd ios && pod install`）
>
> **第二步：用电脑浏览器作为第二端互通**
> 打开 **https://trtc.io/demo/homepage/#/detail?scene=callkit**，选 **Call a Friend**
> 两端用同一 SDKAppID，不同的 userId 登录，互相拨号测试通话效果。

`STOP`，等用户反馈。

| 用户回复 | 动作 |
|---|---|
| "打通了" / "通了" / "可以" | 进 Phase D3 |
| 报错 / 崩溃 | 写 `troubleshoot_return_flow = demo-experience` + `active_flow = troubleshoot`，Read `flows/troubleshoot.md`，STOP |
| "文档某步卡住" / "只有一台设备" | 针对问题答疑，答完 STOP 等继续 |

---

## Phase D3 — 体验后决策

`AskUserQuestion` 单选：

> demo 跑通了，接下来怎么打算？

| # | label | 动作 |
|---|---|---|
| 1 | 满足需求，帮我集成到自己的项目里 | 见下方 §D3.1 |
| 2 | 有问题想了解一下 | 追问具体问题，答完后回本菜单 |
| 3 | 先不集成了，以后再说 | 写 `status = completed`，告知随时可回来继续，结束 |

### D3.1 继续集成

写 session `form = embed-in-app` + `active_flow = basic-call`，
Read `flows/basic-call.md` 从 Phase A 起。

**Phase A 衔接**：session `phase_a_state = has-credentials` 时，Phase A 跳过资源确认，
直接进入 Phase 1a。
