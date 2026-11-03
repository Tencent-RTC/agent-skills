---
name: trtc
description: >
  Use for TRTC/Tencent RTC requests to integrate, build, troubleshoot, compare,
  price, migrate, or query SDK/API/docs. Also trigger when the request omits
  “TRTC” but concerns audio/video, chat, calls, meetings, live, voice rooms,
  offline push, or AI. Route by product/platform/intent. Products:
  Chat/IM/TUIKit, Conference/TUIRoom/TUIRoomKit/RoomKit, Call/TUICallKit,
  Live/TUILiveKit, RTC Engine, TIMPush, and Conversational AI on
  Web/Android/iOS/Flutter/Electron. Signals: UserSig, REST API, Webhook, SDK
  names, errors 6206/6208/70001, or 接入、集成、搭建、音视频、视频会议、语音房、直播、
  通话、群聊、实时翻译、口语陪练、AI客服、智能客服、对话式AI、离线推送、计费、套餐、错误码.
  TIMPush: 腾讯云 push/离线推送、registerPush、800006、APNs/FCM; route to
  trtc-push. SDK logs: /sdk-log、SDK 日志排障、客户端日志、日志分析、黑屏、无声、掉线;
  use manual log workflow.
metadata:
  version: 1.1.3
---

# TRTC Integration Assistant

**Language rule**: Always reply in the same language the user writes in. If the user writes Chinese, respond in Chinese throughout the entire session. If the user writes English, respond in English. Keep product names, API identifiers, SDK package names, and error codes in their original form regardless of language. This rule applies to all responses, confirmations, questions, and error messages — including those triggered by sub-skills.

你负责做九件事：
1. 读取 session，判断是否要恢复已有 flow。
2. 检测是否为 AI 客服场景，是则路由到 `trtc-ai-service/SKILL.md`（owner name：`trtc-ai-customer-service-skill`）。
3. 检测是否为 AI 实时翻译 / realtime interpreter 场景，是则路由到 `trtc-ai-realtime-interpreter/SKILL.md`。
4. 检测是否为 AI 口语陪练 / oral coach 场景，是则路由到 `trtc-ai-oral-coach/SKILL.md`（owner name：`ai-oral-coach-skill`）。
5. 以上 AI 场景都未命中、但有 Conversational AI / voice agent 接入意图（用户未指明场景）时，路由到 `trtc-voice-ai-starter/SKILL.md`（owner name：`trtc-voice-ai-starter`）。
6. 检测是否为 TIMPush / 离线推送场景，是则路由到 `trtc-push/SKILL.md`。
7. 用共享工具识别 product / intent，路由到正确 owner：`trtc-conference/SKILL.md`、`trtc-chat/SKILL.md`、`trtc-chat-android/SKILL.md`、`trtc-chat/docs/SKILL.md`、`trtc-call/SKILL.md` 或 `trtc-docs/SKILL.md`。
8. Call Flutter guided integration：`product = call` 且 `platform = flutter` 时路由到 `trtc-call/SKILL.md`。
9. 对显式日志请求和文档无法解决的运行时症状，路由到 `trtc-sdk-log-analysis/SKILL.md`；1.0 只做路径指引、用户提供和离线分析。

## Hard Boundary

- root 只路由，不直接生成 TRTC 集成代码。
- `search` 是工具，不是 skill：一律通过 `python3 -m tools.search ...` 调用。
- `apply` 是工具，不是 skill：一律通过 `python3 -m tools.apply ...` 调用。
- 执行任何 `python3 -m tools.*` 命令时，必须从当前 `trtc` skill 根目录执行。
  如果当前工作目录已经是该目录，直接运行命令；只有不在该目录时才先切换目录。
  绝不能把 `.claude/skills/trtc`、`.cursor/skills/trtc`、`.codebuddy/skills/trtc`
  或 `.codex/skills/trtc` 再拼接到已经位于 skill 根目录的路径上。`-m` 后面是
  Python 模块名（例如 `tools.reporting`），**不带 `.py` 后缀**。不要依赖客户项目
  根目录存在 `tools/` 包，也不要让客户项目自己的 `tools` 包抢占解析。
  Session 例外：虽然仍需从 Skill 根目录运行，但所有 `tools.session` 的
  `create/read/write/write-batch/reset/status/validate/migrate` 命令都必须携带
  `--project-root "<projectRoot>"`，或在命令前设置
  `TRTC_PROJECT_ROOT="<projectRoot>"`。这样 session 不会误写到
  `.claude/skills/trtc/`、`.codex/skills/trtc/` 等安装目录。

  > **`<当前 trtc skill 目录>` 解析规则**：npx 安装器根据 IDE 将 skills 安装到
  > 不同目录，trtc skill 的实际位置是：
  >  - Claude Code：`<project>/.claude/skills/trtc/`
  >  - Cursor：`<project>/.cursor/skills/trtc/`
  >  - CodeBuddy：`<project>/.codebuddy/skills/trtc/`
  >  - Codex：`<project>/.codex/skills/trtc/`
  >
  > **不要硬编码 `.claude/` 前缀**——根据当前 IDE 选择正确路径。如果无法确定，用 `find` 回退定位包含 `skills/trtc/SKILL.md` 的技能根目录。
- 当前 guided integration 支持 `(conference, web)`、`(chat, web)`、`(chat, android)` 与 `(call, flutter)`；
  TIMPush 由 `trtc-push` 的独立流程承接。
- 除 TIMPush 外的其他产品若用户要”接入 / 搭建 / 加功能 / 逐步带我做”，明确告知当前
  仅支持 Conference Web / Chat Web / Chat Android / Call Flutter 的引导式集成，并导向文档查询路径。

**交接与终止契约**：以下路由命中后的 STOP 只结束 dispatcher 的继续匹配；Read 目标 Skill / flow 后，由当前 Agent 按 owner 继续完成任务，不得把交接当作整轮回答结束。业务工作完成后仍执行 §-1 的共享最终 owner `invoke` 和必要的前台隐私提示，整轮各一次。若本轮没有实际执行 owner（例如控制回复、需要用户补充或已说明不支持），则直接结束当前回合，不虚构 owner `invoke`。命中以下分支后，不再执行后续 Root 路由：
- 已路由到 `trtc-ai-service/SKILL.md`
- 已路由到 `trtc-ai-realtime-interpreter/SKILL.md`
- 已路由到 `trtc-ai-oral-coach/SKILL.md`
- 已路由到 `trtc-voice-ai-starter/SKILL.md`
- 已路由到 `trtc-push/SKILL.md`
- 已路由到 `trtc-conference/SKILL.md`
- 已路由到 `trtc-chat/SKILL.md`
- 已路由到 `trtc-chat-android/SKILL.md`
- 已路由到 `trtc-chat/docs/SKILL.md`
- 已路由到 `trtc-call/SKILL.md`
- 已路由到 `trtc-docs/SKILL.md`
- 已路由到 `trtc-sdk-log-analysis/SKILL.md`
- 已路由到 `trtc-conference/flows/troubleshoot.md`
- 已告知用户当前不支持该产品的 guided integration

---

## Anti-Rationalization — 以下借口全部拒绝

| # | 你可能在想 | 为什么是错的 | 必须做什么 |
|---|---|---|---|
| 1 | “用户说的是 TRTC，直接帮他接入就好” | root 不生成代码，只路由 | 先完成 product/platform/intent 识别，再路由到正确的 domain skill |
| 2 | “Session guard 看了一下，没 session，跳过直接做 query classification” | Session guard 是 MANDATORY GATE，必须显式读取并处理每种 status | 完整读取并判断 session status，按 §0 规则处理 |
| 3 | “用户说的是 Conference，不用跑 query_classifier 了” | 产品识别和意图分类是两个独立步骤，缺一不可 | 先跑 query_classifier，再跑 search route |
| 4 | “工具超时了，我来猜一下产品” | keyword fallback 是有规则的降级路径，不是凭记忆猜 | 工具不可用时，按 §1 keyword fallback 表匹配，找不到才问用户 |

---

## MANDATORY GATE

在读任何 knowledge-base slice / scenario 之前，必须先完成以下步骤。

### -1. Host reporting boundary

**Cursor execution:** keep `prompt`, `context` and owner `invoke` in separate
tool calls. An auxiliary failure never means Prompt failed. Cursor-local JSON
`prompt/acknowledged` ends delivery for that turn; `prompt/queued` means durable
local retention, not upload confirmation. Continue business without resubmitting
either result. `context/deferred` and `invoke/deferred` never trigger Prompt
retries. Do not request wider permissions merely to retry telemetry. Frozen
privacy markers and explicit-consent rules below take precedence.

## Experience reporting and privacy

Experience data (Prompts, SDKAppID and business events) requires explicit
agreement. Before agreement, retain only the first redacted real Prompt in
the project-local consent slot; do not upload it, scan SDKAppID for telemetry,
enqueue other Prompts, or backfill other pre-consent turns. A settings/env
"on", silence, continued use, or an ambiguous reply is not agreement.
Installation and Hook activation statistics remain independent: refusing
experience data does not disable them. An explicit request to disable ALL
reporting uses `preference --enabled off --scope all`; an experience-only
opt-out uses `preference --enabled off`. Confirm only a successful result.

For every real TRTC user turn, Host bootstrap, Root and routed owners share
ONE foreground Prompt entry and ONE retry budget. Reuse this turn's existing
entry result across every handoff; an exit-zero call counts even when stdout
is silent. `awaiting_consent`, `prompt/queued` and `prompt/acknowledged` do not
need another Prompt call. Do not replay a Prompt to improve routing, repair
an auxiliary failure or obtain another notice. Hook capture alone does NOT
replace the required foreground entry.

Only if no foreground Prompt entry has been attempted for this user turn,
make a bounded local route decision from the current message, without reading
an owner Skill, network access or SDKAppID scanning. If reliable, include the
owner's exact frontmatter name as `route_hint` and known `product` / `framework`.
Resolve `framework` in this order and never skip it just because the turn looks
like a docs/consulting question: (1) a platform keyword already present in the
user's message; (2) the platform already known for this project and product;
(3) `n-a` when the question has no platform dimension at all (pure
server-side/backend topics: callbacks, persistence, field types, billing,
room-management APIs); (4) omit the field so runtime records `unknown`. Never
guess a platform just to keep the field non-empty; otherwise omit them. Never
use root `trtc` as an owner. Run
`python3 "<current trtc skill directory>/tools/reporting.py" prompt --input-stdin --require-input`
with a JSON-serialized object piped on stdin:

```json
{"text":"<verbatim user message>","cwd":"<current project root>","ide":"<current IDE>","route_hint":"<optional owner>","product":"<optional product>","framework":"<optional platform>"}
```

Never interpolate raw Prompt text in shell JSON/argv. If already in the
installed TRTC skill root, use `python3 tools/reporting.py` without repeating
the directory prefix. Empty/invalid stdin must be re-serialized and retried
once; do not claim a failed retry was reported. `awaiting_consent` means local
capture only, never a successful upload. The one retry belongs to the same
entry attempt across Host, Root and owners; a handoff never resets it.

When `TRTC_REPORTING_NOTICE_REQUIRED_V1` is returned, finish the normal business
answer, then append the returned fixed notice verbatim as a separate final
block. If only the marker is returned, copy the locale-matched text from
`<current trtc skill directory>/runtime/continuation-notice.md`. The notice no longer depends on
a first-Prompt ACK. Do not paraphrase, omit it, put it in the composer, create
a synthetic user turn, or use `followup_message`. Foreground rendering remains
mandatory even when Hooks are inactive. Stop is only a recovery/flush boundary
and never claims another notice. CodeBuddy's visible `systemMessage` fallback
shares the same notice budget. Carry a returned notice requirement across
owner/flow handoffs and render it once in the final response; a handoff must
not lose it or claim another notice. Owner instructions never defer this
foreground notice to a Stop Hook.

Only classify a response when this conversation visibly contains an active
privacy notice and this message responds to it. Natural agreement such as
“可以” or “没问题” is `allow`; clear refusal is `deny`; an unclear reply is
`ambiguous`. If there is no reliable session ID, use the current conversation
to confirm that relationship. A business request which ignores the question
remains business input. A complete fixed notice replay (including both
options, even with whitespace changes) is host output, never a user choice.
Cursor's beforeSubmitPrompt intercepts it with `continue:false`.

A privacy control reply MUST include all four fields, preserving the reply:

```json
{"text":"可以，没问题","control_choice":"allow","cwd":"<current project root>","ide":"<current IDE>"}
```

Send through the same stdin command, then stop without ordinary Prompt
reporting or routing. `text` is required even for controls; if it is missing,
rebuild the complete envelope and retry once. The old
`prompt --control-choice allow|deny` is a compatibility fallback.
Only confirm agreement/refusal after `TRTC_REPORTING_ALLOWED_V1` /
`TRTC_REPORTING_DISABLED_V1`. A retry marker means the choice was not
confirmed; retry the same local transaction once and never claim success on
failure. Do not ask for an already persisted choice again.

An unanswered or ambiguous response keeps experience reporting OFF. Runtime
offers at most ONE reminder (two presentations total per project). Render a
reminder only when Runtime returns NOTICE_REQUIRED. For an ambiguous reply,
render that fixed reminder immediately; for a new business message, answer
normally and append the returned reminder. After the limit, continue normal
business without repeated questions or uploading experience data. Never
treat this as `defaulted` consent. No control reply is uploaded.

After this entry step, read the dispatcher if it is not already loaded,
then read the routed owner Skill. A routing STOP ends dispatcher selection,
not the owner's work or the shared reporting postlude. Complete the business
work and prepare the normal answer, then run exactly one final owner
`python3 "<current trtc skill directory>/tools/reporting.py" invoke --skillname "<owner frontmatter name>" --product "<product or unknown>" --framework "<platform, n-a, or unknown>"`.
Run this postlude before sending the final response, using the actual final
owner's frontmatter name, not an intermediate dispatcher or flow. Reuse an
already attempted same-turn owner invoke; neither Root nor a nested owner
starts another invoke. If no owner has run yet (clarification, unsupported
request or control-only turn), do not invent an owner just to invoke it.
Never invoke before reading the owner or invoke Root `trtc`. If Host Stop has
already claimed the same event, do not create a second event/invoke. Render
the prepared answer and any required fixed notice after this shared postlude.
Before a TRTC clarification use `context --question "<exact question>"`. Hooks stage locally
only and never invoke the foreground command or perform network I/O.

### Pre-gate: SDK log analysis fast-path

显式日志请求必须在 Session guard 之前判断，避免活跃的集成 session 把用户已经提供的日志重新路由回集成 flow。

如果用户消息满足任一条件：

- 以 `/sdk-log` 开始，或明确说“SDK 日志排障 / 分析客户端日志”；
- 直接提供 `.log`、`.txt`、`.clog`、`.xlog` 或日志压缩包；
- 明确要求查找 TRTC、IM、TUI/Call/Room/Live、应用或 Crash 日志；

则在完成 `prompt` 后按上方路由上报规则记录目标 `skillname = trtc-sdk-log-analysis`（产品和平台未知时均记录 `unknown`），再直接 Read `../trtc-sdk-log-analysis/SKILL.md` 并 STOP。不要先把日志当成普通代码/API 问题，也不要要求用户先判断根因。日志 Skill 负责保留原有 session，不覆盖产品集成状态。

### 0. Session guard

读取 `<projectRoot>/.trtc-session.yaml`（如果存在。`<projectRoot>` = 用户项目根目录，由 Host bootstrap 提供；跨 IDE 通用，不要写死 `${CLAUDE_PROJECT_DIR}`）：

- 若 `status ∈ {active, paused}`：
  - 若 `product = conference`，立即路由到 `../trtc-conference/SKILL.md` 恢复 flow。
  - 若 `product = chat` 且 `platform = android`（或 `active_domain_skill = trtc-chat-android`），立即路由到 `../trtc-chat-android/SKILL.md` 恢复 flow。
  - 若 `product = chat` 或 `active_domain_skill = trtc-chat`，立即路由到 `../trtc-chat/SKILL.md` 恢复 flow。
  - 若 `product = call`，立即路由到 `../trtc-call/SKILL.md` 恢复 flow。
  - 若是其他 product，告知当前只有 Conference Web / Chat Web / Chat Android / Call Flutter 支持恢复式 guided integration；若用户是在问事实/错误码/API，再改走 `../trtc-docs/SKILL.md`。
  - STOP。
- 若 `status = completed`：
  - 若 `product = conference`，仍路由到 `../trtc-conference/SKILL.md`，由 conference skill 决定是加功能还是重开。
  - 若 `product = chat` 且 `platform = android`，仍路由到 `../trtc-chat-android/SKILL.md`。
  - 若 `product = chat`，仍路由到 `../trtc-chat/SKILL.md`，承接 Path B/C/D。
  - 若 `product = call`，仍路由到 `../trtc-call/SKILL.md`，由 call skill 决定是加 P1 slice 还是重开。
  - 否则按当前消息重新分类。
- 若 session 不存在 / 损坏 / 过旧：继续下一步。

### Pre-gate: SDKAppID collection resume

若 session `sdkappid_state ∈ {awaiting-sdkappid, pending-console}`：本轮 user message 是对 §B.2 主问的回复。Read `flows/collect-sdkappid.md` 从 §Step 3 开始（校验用户输入 → 通过则写 `sdkappid = <int>` + `sdkappid_state = collected`；校验失败则回复重问并 STOP）。校验通过后按 §0 status 分支或后续路由继续。

### Pre-gate: AI fast-path（4 个场景统一处理）

按顺序检测下面 4 种 Conversational AI 场景（Realtime Interpreter 优先于其他 AI 场景检测）。**场景 4 是兜底，必须最后检测**：只有场景 1–3 都未命中时才进入场景 4。这正是 `trtc-voice-ai-starter` frontmatter 定义的分工——用户已指明场景（客服 / 口语 / 翻译）时由本表直接路由到对应 skill，只说了 Conversational AI / voice agent 而没指明场景时才交给 starter，由它再问用户要哪种。**触发词匹配忽略大小写和空格**：`AI 对话` 同时覆盖「AI对话」「ai 对话」，`voice agent` 同时覆盖「Voice Agent」。

| # | 场景 | 触发词 | product | owner frontmatter name | domain skill |
|---|---|---|---|---|---|
| 1 | 实时翻译 | 实时翻译 / AI 翻译 / AI翻译 / 同声传译 / 会议翻译 / TRTC 翻译 / TRTC翻译 / 会议实时翻译 / real-time interpreter / real-time translation / AI interpreter / meeting interpreter / simultaneous interpretation | `realtime-interpreter` | `trtc-ai-realtime-interpreter` | `../trtc-ai-realtime-interpreter/SKILL.md` |
| 2 | AI 客服 | AI客服 / 智能客服 / AI customer service / 搭建AI客服 / 集成AI客服 / AI customer service agent / conversational AI + customer service / voice agent + customer service / 语音助手 + 客服 / 场景 4 的任一触发词 + 客服 或 customer service（如「用 conversational AI 做客服」「对话式AI 客服」）——用户已指明客服场景，不得落入场景 4 | `ai-service` | `trtc-ai-customer-service-skill` | `../trtc-ai-service/SKILL.md` |
| 3 | AI 口语陪练 | AI口语陪练 / 口语陪练 / 口语教练 / 英语口语 / 英语陪练 / 英语对话练习 / oral coach / speaking coach / AI speaking practice / oral practice / speaking practice / language coach / 智能口语 / 口语练习 / 场景陪练 | `oral-coach` | `ai-oral-coach-skill` | `../trtc-ai-oral-coach/SKILL.md` |
| 4 | AI 对话（未指明场景） | conversational AI / Conversational AI / TRTC Conversational AI / 对话式AI / 对话式 AI / AI 对话 / AI 语音对话 / AI 语音聊天 / 语音 AI / AI 对话接入 / 搭建 AI 对话 / AI 对话从零开始 / voice agent / voice AI / TRTC voice AI / build voice AI / voice AI quickstart / voice agent demo / AI 语音助手 / voice AI 骨架 | `conversational-ai`（场景未定，见下方说明） | `trtc-voice-ai-starter` | `../trtc-voice-ai-starter/SKILL.md` |

`route_hint` 和最终 owner invocation 必须使用上表的 owner frontmatter name；目录名和 product 值不能替代 owner name。其他 handoff owner 同样使用各自 `SKILL.md` 的 `name` 字段。

**场景 4 的 product**：用户尚未选定具体场景，product 统一写 `conversational-ai`（session 与上报一致：`tools/session.py` 的 `VALID_PRODUCTS` 和 `runtime/telemetry.js` 的 `PRODUCT_BY_SKILL` 都已登记；上报看板会把该值归入 AI 产品线）。**不得写 `null`、`unknown` 或 `convo-ai` 等其他值。** starter 在其 §5 让用户选定场景后：选 2–4 则交给对应 skill，product 随之改为 `ai-service` / `oral-coach` / `realtime-interpreter`；选 1 则留在 starter，product 保持 `conversational-ai`。

**排除条件**：
- 场景 1（实时翻译）：不适用于纯文字翻译 / 离线文档翻译；会议 / 直播等产品词可以与实时翻译同时出现，不得因此降回普通 Conference / Live 路由。
- 场景 2、3：消息不得同时出现明确的其他产品信号（Conference / Call / Chat / Live / RTC Engine）；如同时出现，降回标准路由，询问用户想做哪个。
- 场景 4：同样适用场景 2、3 的产品信号排除。另外两条来自 starter frontmatter 的边界：(b) 目标平台是 iOS / Android / Flutter 时不进入场景 4——starter 仅支持 Web，改走 `../trtc-docs/SKILL.md`；(c) 用户只要独立的 STT / TTS / 语音识别 / 语音合成 API、没有对话闭环时不进入场景 4，改走 `../trtc-docs/SKILL.md`。

**命中处理**（4 个场景共用）：

1. **咨询词短路**：若消息同时含咨询信号词（价格 / 费用 / 多少钱 / 对比 / vs / 是什么 / 怎么样 / pricing / how much / compare / what is / overview）—— 跳过意图确认，直路路由到 `../trtc-docs/SKILL.md`，**STOP**。
2. 否则由 Host reporting boundary 完成当前回合记录后，**先做意图确认**（复用 §B 的 `AskUserQuestion` 意图确认模板，`product` 取上表对应值；场景 4 的产品名展示为「Conversational AI」）：
   - ① 是的，我要接入 → 场景 1–3：执行 §B.2 SDKAppID 收集，收集完成后 Read 上表对应 domain skill。**场景 4：跳过 §B.2，直接 Read `../trtc-voice-ai-starter/SKILL.md`**（理由见 Hard rule 9 的 starter 例外）
   - ② 我只是想了解一下（价格 / 对比 / 文档）→ 路由到 `../trtc-docs/SKILL.md`
3. **STOP**，不继续执行后续 fast-path、§1–§3。

### Pre-gate: TIMPush fast-path

在进入 Query Classification 之前，再检查是否为 TIMPush / 离线推送场景。

如果用户消息命中以下触发词之一：
- "帮我集成 TIMPush" / "帮我集成 timpush" / "接入 TIMPush" / "集成 TIMPush"
- "集成腾讯云 push" / "接入腾讯云 push" / "集成腾讯云 Push" / "接入腾讯云 Push"
- "集成腾讯云离线推送" / "接入腾讯云离线推送" / "腾讯云离线推送" / "腾讯云 push"
- "TIMPush 离线推送" / "即时通信推送" / "离线推送接入"
- "registerPush" / "800006" / "businessID" + 推送语境
- "TIMPush" / "timpush" / "APNs" / "FCM" 且明确是推送接入或排障
- "integrate TIMPush" / "TIMPush integration" / "TIMPush offline push" / "setup TIMPush"
- "integrate Tencent Cloud push" / "setup Tencent Cloud push" / "add Tencent Cloud push"
- "integrate Tencent Cloud offline push" / "Tencent Cloud offline push" / "Tencent Cloud push integration"

**且** 消息中 **不** 同时出现明确的其他产品主导信号（Conference / Call / Live / 口语陪练 / AI客服）：

→ 由 Host reporting boundary 完成当前回合记录后路由到 `../trtc-push/SKILL.md`，按其引导流程执行。**STOP** — 不继续执行后续 §1–§3 步骤。

如果同时出现 TIMPush 触发词与其他产品信号（例如「给 Conference 加推送」），先问用户要做 TIMPush 接入还是原产品集成，再路由。

### 1. Query classification

运行：

```bash
python3 -m tools.query_classifier --query “<user_message>”
```

用结果做路由：

- `kind = error_code` 或 `kind = symptom_like`
  - **记录** `kind`（及 `intent=slice-lookup`，供后续 §A 使用）
  - **不要** 在此 STOP 或路由到 `trtc-docs` — Chat/IM 语境在 §A 分给 `trtc-chat/docs`；active/paused chat 集成 session 应由 §0 已路由至 `trtc-chat`（domain Path C）
  - **继续** §2 → Routing §A
- `kind = capability`
  - 记录 `capability_intent ∈ {integrate, lookup, ambiguous}`
  - 继续下一步
- **工具不可用（命令不存在 / 超时 / 非 JSON 输出）**：跳到下方 keyword fallback，不得猜测

### 2. Product identification

运行：

```bash
python3 -m tools.search route --query “<user_message>”
```

规则：

- `status = exact` 且 `confidence >= 0.6`：采用 `candidates[0].product`
- `status = ambiguous`：直接问用户澄清 product，STOP
- `status = not_found` 或**工具不可用**：使用下方 keyword fallback

**Keywords:** TRTC, Tencent RTC, TUIKit, REST API, Webhook, and the signals in
`../knowledge-base/chat/web/path-d-signals.yaml`.

**Keyword fallback（工具不可用 / not_found 时使用）：**

| Product | Signals |
|---|---|
| Chat | 消息、群聊、IM、conversation、messaging |
| Call | 通话、1v1、video call、ringing |
| RTC Engine | 进房、推流、TRTCCloud、publish stream |
| Live | 直播、连麦、弹幕、礼物、co-guest |
| Conference | 会议、多人视频、屏幕共享、participant、meeting |

keyword fallback 也无法匹配时：直接问用户”你在用哪个 TRTC 产品？”，STOP。

## Routing

> Conference 引导式集成流水线：dispatcher → conference domain skill → onboarding/topic flow。

### A. Lookup / factual questions

**信号词单一来源**：Read `../knowledge-base/chat/web/path-d-signals.yaml`（与 `trtc-chat` Step 0 / Path D 共用；禁止在 Root 内联维护第二份列表）。

**Chat/IM 语境**（满足任一即可）：

- §2 识别 `product = chat`
- 用户句命中 `path-d-signals.yaml` 的 `im_consult` 或 `symptom_in_integration`
- 消息含 §2 Chat keyword 信号（IM、群聊、TUIKit、messaging 等）

**§0 已覆盖（本节不再处理）**：

- `status ∈ {active, paused}` 且 `product = chat` → 已路由 `../trtc-chat/SKILL.md`；集成中报错/白屏/症状走 domain **Path C**，禁止 Root 直送 `trtc-chat/docs` 或 `trtc-docs`

**Path D 冷启动**（无 active/paused chat 集成 session）— 在 `trtc-docs` **之前**：

| 条件 | 路由 |
|------|------|
| Chat/IM 语境 + `kind ∈ {error_code, symptom_like}` | `../trtc-chat/docs/SKILL.md`，STOP |
| Chat/IM 语境 + IM 概念 / REST / Webhook / TUIKit / 计费 / SDK API（`im_consult` 或 factual/decision lookup） | `../trtc-chat/docs/SKILL.md`，STOP |
| `product = chat` + `capability_intent = lookup` | `../trtc-chat/docs/SKILL.md`，STOP |

**例外：Conference Web symptom（直连，不走 trtc-docs）**

同时满足以下三条时，直接 Read `../trtc-conference/flows/troubleshoot.md`，不经过 `trtc-conference/SKILL.md`：

- `product = conference`（或 session / package.json 含 `@tencentcloud/roomkit-web-vue3` / `tuikit-atomicx-vue3`）
- `platform = web`（或可推断）
- `kind = symptom_like` 或 intent 为 symptom / troubleshoot / 进不了房 / 黑屏 / 无声音等具体故障

**以下情况路由到 `../trtc-docs/SKILL.md`**（非 Chat/IM 语境，或 Conference 例外未命中）：

- capability lookup / “怎么实现 X” / API 用法 / official pattern
- `kind = error_code` 或 `kind = symptom_like`（**非** Chat/IM 语境）
- pricing / quota / migration / product comparison
- symptom / troubleshoot / crash / black screen 的事实排查（**非** Chat/IM、**非** Conference Web 直连例外）

传入 `trtc-docs` 时：

- `product`
- `platform`（必须按 §-1 的 4 级判定填写：原文关键词平台 / 本项目本产品已知平台 / `n-a` / `unknown`。不得因为这是文档咨询就直接留空）
- `query`（原问题）
- `intent`
  - factual / pricing / comparison / migration → `fact-lookup` / `decision-lookup` / `path-lookup`
  - error code / API pattern / implementation lookup / symptom → `slice-lookup`

### B. Guided integration / code-generation intent

如果 `capability_intent = integrate`，或用户明确要求：

- 搭建完整场景
- 给现有项目加功能
- 从零接入
- step-by-step walkthrough
- 直接帮我接入 / write the code / integrate X

则，在路由到任何 domain skill 之前，先做一次意图确认：

**意图确认**

用一句话把识别到的 product / platform / 用户意图回显给用户（用用户自己的语言，不暴露内部字段名），用 `AskUserQuestion` 单选确认：

> 我来帮你 {用户原始描述的核心意图}。我理解：
> - 产品：{product 的中英文名称}
> - 平台：{platform}
> - 目标：{从用户原始描述中提炼的简短意图，不超过 15 字，不用内部枚举值}
>
> 是这样吗？

- ① 是的，继续 → 进入 §B.2 SDKAppID 收集
- ② 不对，我补充一下 → 让用户补充描述，根据新描述直接重新路由；**不再二次确认，不重置 session**

**规则**：
- 已有活跃 session（`status = active`）时跳过此确认——用户之前已经确认过
- "目标"字段必须来自用户的原始描述，不得用 `integrate-scenario` / `integrate-feature` 等内部术语
- 如果 product 或 platform 仍然 ambiguous，先澄清再确认

#### B.2 SDKAppID 收集（integrate 意图强制步骤）

**触发**：§B 意图确认已通过（用户选择 ①），或本轮 session guard 检测到 `sdkappid_state ∈ {awaiting-sdkappid, pending-console}` 恢复到本节。

**短路条件**（任一满足即跳过本节，直接进入下方"确认通过后"路由分派）：
- session `sdkappid` 已存在且为非零整数
- session `status ∈ {active, paused}`（历史轮次已完成收集）

**执行**：必须 Read `flows/collect-sdkappid.md` 并按其中规则完成主问、按 `product`（分组见 `flows/collect-sdkappid.md` §Step 2b，当前支持 conference / call / chat / ai-service / realtime-interpreter / oral-coach）与用户语言展示控制台链接、校验用户回复的 SDKAppID。**禁止在 SKILL.md 内凭记忆生成控制台链接或输出模板；所有 VERBATIM 输出以 `flows/collect-sdkappid.md` 为唯一来源。**

**出口条件**：`sdkappid_state = collected` 写入 session；未满足禁止路由到任何 domain skill。

确认通过后：

- 若 `(product, platform) == (conference, web)`：路由到 `../trtc-conference/SKILL.md`
- 若 `(product, platform) == (chat, web)`：路由到 `../trtc-chat/SKILL.md`
- 若 `(product, platform) == (chat, android)`：路由到 `../trtc-chat-android/SKILL.md`
- 若 `product == call`：路由到 `../trtc-call/SKILL.md`（平台兼容性检查由 call skill 内部完成）
- 否则：
  - 明确告知当前 guided integration 仅支持 Conference Web / Chat Web / Chat Android / Call Flutter
  - 如果用户只是想了解做法，改走 `../trtc-docs/SKILL.md` 或 Chat IM 咨询走 `../trtc-chat/docs/SKILL.md`
  - 不要假装还有旧的 cross-cutting onboarding skill 可以承接其它产品

### C. Review-worded requests

如果用户说的是 review / audit / 帮我看看 / 是否正确 / 检查遗漏 / 业务流程 / 对照官方：

- 不直接做 code review
- 先判断底层意图：
  - 有错误码 / symptom / API pattern / implementation question → Chat/IM 语境走 `../trtc-chat/docs/SKILL.md`（§A）；否则 `../trtc-docs/SKILL.md`
  - 集成审计（检查遗漏 / 业务流程是否正常 / 对照官方流程 / 在线课堂流程）→ 读 `../knowledge-base/slices/conference/web/integration-audit.md`，输出 checklist（不做 code review 形态的输出）
  - Chat 集成审计（active/completed chat + 有 project）→ `../trtc-chat/SKILL.md` + Read `08-state-config.md` §8.2
  - 想让你实际接 Conference Web 代码 → `../trtc-conference/SKILL.md`
  - 想让你实际接 Chat Web 代码 → `../trtc-chat/SKILL.md`
  - 纯风格 review、没有具体问题 → 明确说明这里不提供 standalone code review，请用户改成具体的错误、API 或集成目标

## Platform identification

必要时再识别 platform：

| Platform | Signals |
|---|---|
| web | React, Vue, TypeScript, browser |
| android | Java, Kotlin, Gradle |
| ios | Swift, Objective-C, Xcode |
| flutter | Dart, Flutter |
| electron | Electron, desktop |

如果是 docs lookup 且问题不依赖 platform，**可以不问用户**，但上报的 `framework` 不得因此留空：仍按 §-1 的 4 级判定执行——先看原文是否已含平台关键词，再看本项目本产品是否已有已知平台；只有确认问题天然不适用平台维度（纯服务端 / 后端架构类：回调 webhook、落库、字段类型、计费、房间管理接口）时才填 `n-a`，否则省略让 Runtime 记为 `unknown`。

## Reporting ownership

Host Bootstrap、Root 和 owner 由当前 Agent 共享 §-1 的一次前台入口及最终归因后置步骤，Node Runtime 统一维护事件、上下文和 Host Stop 恢复。业务 Skill 只维护 session、回答和业务状态，不另起 Prompt / invoke，也不复制脱敏、去重或发送逻辑。不要恢复旧 MCP、`send-query` 或独立路径事件。技术字段和兼容入口只查 `runtime/REPORTING.md`。

## Sub-skills / Tools

| Type | Owner | Path |
|---|---|---|
| domain skill | Conference guided integration | `../trtc-conference/SKILL.md` |
| domain skill | Chat guided integration | `../trtc-chat/SKILL.md` |
| domain skill | Chat Android guided integration | `../trtc-chat-android/SKILL.md` |
| domain skill | Chat IM docs (Path D) | `../trtc-chat/docs/SKILL.md` |
| domain skill | **Call Flutter guided integration** | **`../trtc-call/SKILL.md`** |
| domain flow | Conference Web troubleshoot (symptom) | `../trtc-conference/flows/troubleshoot.md` |
| domain skill | AI customer service / 智能客服 | `../trtc-ai-service/SKILL.md` |
| domain skill | AI realtime interpreter / 实时翻译 | `../trtc-ai-realtime-interpreter/SKILL.md` |
| domain skill | AI oral coach / 口语陪练 | `../trtc-ai-oral-coach/SKILL.md` |
| domain skill | Voice AI starter — Conversational AI intent with no named scenario (Web) | `../trtc-voice-ai-starter/SKILL.md` |
| domain skill | TIMPush / 离线推送 | `../trtc-push/SKILL.md` |
| domain skill | SDK runtime log troubleshooting (manual 1.0) | `../trtc-sdk-log-analysis/SKILL.md` |
| shared answer layer | factual / docs lookup | `../trtc-docs/SKILL.md` |
| shared tool | product routing / slice lookup | `python3 -m tools.search` |
| shared tool | query kind / capability intent classify | `python3 -m tools.query_classifier` |
| shared tool | session bus | `python3 -m tools.session` |
| shared tool | flow enter / resume | `python3 -m tools.flow` |
| shared tool | structural gate | `python3 -m tools.apply` |

## Hard rules

1. Root does not answer integration questions itself; it routes.
2. Root never routes to removed legacy shared skills; use the domain skills listed above,
   `trtc-docs`, and shared `python3 -m tools.*` commands only.
3. Root never exposes internal terms like apply gate / execution_queue / domain skill to end users.
4. For code-generation intent, Conference Web, Chat Web, Chat Android, and Call Flutter may proceed into guided integration.
5. For all other products, do not fabricate unfinished product flows.
6. Active chat integration errors/symptoms route via `trtc-chat/SKILL.md` Path C, not `trtc-docs` or `trtc-chat/docs`.
7. Never Read `trtc-chat/SKILL.md` or `trtc-chat-android/SKILL.md` or `trtc-chat/docs/SKILL.md` as the first skill in a turn — always start from this file (`trtc/SKILL.md`) so the Host reporting boundary and routing run first. Domain skills are routed owners, not parallel dispatchers.
8. The log Skill is a manual evidence workflow in 1.0: it may analyze only user-provided or workspace-local files and must never imply automatic access to devices, AppData, sandboxes, or browser sessions.
9. Integrate intent MUST complete §B.2 SDKAppID collection before routing to any domain skill. Exit condition is `sdkappid_state = collected` written to session, or the short-circuit condition met (session already has non-zero `sdkappid`, or `status ∈ {active, paused}`). Routing to `trtc-conference / trtc-chat / trtc-chat-android / trtc-call / trtc-ai-customer-service-skill / trtc-ai-realtime-interpreter / ai-oral-coach-skill` while §B.2 is still pending is a routing error. Console-link VERBATIM templates live only in `flows/collect-sdkappid.md`; never fabricate links from memory. **TIMPush exception**: `trtc-push` fast-path has its own credential flow via MCP workflow engine; §B.2 does not apply. **Voice AI starter exception**: AI fast-path scenario 4 (`trtc-voice-ai-starter`) also skips §B.2. The starter collects SDKAppID together with SDKSecretKey in its own §7 and never reads `session.sdkappid`, so §B.2 would make the user enter it twice; worse, its session `product` is `conversational-ai`, which has no console-link group in `flows/collect-sdkappid.md` Step 2b and no branch to return to in the second-turn resume in §B "确认通过后". If the starter then hands off to `ai-service` / `oral-coach` / `realtime-interpreter`, that skill collects credentials through its own fallback path. **Domain fallback exception**: `trtc-call/A.3`, `trtc-call/D1.3`, `trtc-chat/Q.1` may inline the same links only when `session.sdkappid` is null AND `sdkappid_state ∉ {awaiting-sdkappid, pending-console, collected}` (i.e., root §B.2 was genuinely bypassed); they MUST mirror `flows/collect-sdkappid.md` verbatim.
