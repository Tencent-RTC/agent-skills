---
name: trtc-conference
description: >
  Guides users through building a TRTC Conference Web application step by step.
  Handles capability overview, scenario matching, integration mode selection,
  and dispatches to the appropriate playbook or slice-based topic flow. Use when
  the user wants to integrate TRTC Conference on Web — "搭建会议", "接入会议室",
  "多人视频", "语音聊天室", "build a meeting app", "integrate conference",
  "step-by-step", "帮我接入", "从零开始", "add screen sharing", "给项目加功能".
  Keywords: Conference, 会议, TUIRoom, RoomKit, UIKit, 视频会议, 语音房间,
  screen share, participant management, Web, Vue, React.
version: 0.1.0
---

# trtc-conference — Conference 集成域技能

## 前置说明

**你的角色**：协同开发者。你扫描用户项目、按 slice 最佳实践生成代码。代码写入在
`flows/onboarding.md` → topic 的 slice 循环中完成，每步通过 `python3 -m tools.apply` 静默结构门控——
用户不感知这个过程，也不要主动提起。

**调用入口**：本文件由 `trtc/SKILL.md` 在 product=conference 时 Read。  
**当前支持范围**：Conference × Web。其他平台进入本文件后应告知用户暂不支持并给出官方文档链接。

**Python tools**：执行任何 `python3 -m tools.*` 命令时，必须从当前 `trtc`
skill 根目录执行（例如先 `cd "<当前 trtc skill 目录>"`）。不要依赖客户项目根目录
存在 `tools/` 包。

**Reporting boundary**：Root/host bootstrap 统一处理本轮 Prompt、路由和 Host Stop notice；若本 Skill 被直接调用且 Host 未记录本轮，才用 stdin Prompt 入口补一次。普通失败继续业务流程；不得恢复旧 MCP 或独立 `send` 路径。`TRTC_REPORTING_NOTICE_REQUIRED_V1` 时先完成答案，由 Host Stop 展示 `runtime/continuation-notice.md`，模型不得自行附加或改写。
动态澄清问题前保留 `context --question`；固定选项仍使用标准选项 UI。Root/Host 负责路由与 notice 展示，业务 Skill 不得恢复旧 MCP 或独立 `send` 路径。

---

## Direct-Route Bootstrap

当 dispatcher 识别到 **Conference Web 的 direct walkthrough 请求**（例如用户明确说
“直接带我一步一步搭 1v1 视频会议”）时，本文件承担 topic bootstrap，并负责把会话引导到 conference topic flow。

bootstrap 规则：

- 若 session 不存在：先通过 `python3 -m tools.session create --product conference --platform web --intent integrate-scenario --project-root "<projectRoot>"` 创建会话；随后在进入 topic 前，按当前 state_version 用 `python3 -m tools.session write-batch --project-root "<projectRoot>"` 补齐最小 bootstrap 字段集（至少包含 `active_flow=topic`、`coverage_decided=false`，以及已知的 `scenario` / `active_domain_skill` / `flow_entered`）。不要手动编辑 `.trtc-session.yaml`。
- 若 session 已存在且 `active_flow = topic`：直接恢复 topic 路径。
- 若用户已明确给出 Conference Web 场景：允许跳过 capability overview，但必须把 `scenario` 写入 session，并显式写 `coverage_decided = false`，让 `flows/topic.md` 的 Step 1.5 正常接手 coverage 决策；bootstrap 不负责猜最终 coverage。
- 若 scenario 仍不明确：继续走本文件的 A2-Q0 场景确认；不要猜测。
- bootstrap 完成后，Conference Web topic 一律通过 `python3 -m tools.flow enter --phase topic --product conference --platform web` 进入 `flows/topic.md`。

Conference 以外产品暂不在这里暴露 direct topic bootstrap。

---

## 入口：读取 session 状态

读取 `{project_root}/.trtc-session.yaml`：

- **文件存在且 `status = active`**：优先看 `integration_path`（topic / medical-quickstart / official-roomkit），若缺失再兼容回退到 `active_flow`：
  - `integration_path = medical-quickstart`（或兼容态 `active_flow = medical-quickstart`）→ 续接 `playbooks/medical-quickstart.md`，STOP
  - `integration_path = official-roomkit`（或兼容态 `active_flow = official-roomkit`）→ 续接 `playbooks/official-roomkit.md`，STOP
  - `integration_path = topic` 且 `active_flow = onboarding` → 续接 `flows/onboarding.md`，STOP
  - 其他值或为空 → 记录当前 session 数据（`scenario`、`ui_mode`、`capability_overview_shown`、`project_state`、`intent`），继续向下执行，**不清空 session**
- **文件不存在或 `status = completed`**：按新会话流程向下执行

---

## intent 路由

根据 session 的 `intent` 字段决定进入哪条主线：

- **`intent = integrate-feature`**（用户要给已有项目加单个功能）：
  - 执行 A2-Qpre（若 `capability_overview_shown != true`）
  - **跳过** A2-Q0（无需选场景）、A2-Q0.5（无需选集成模式）、A2-Q0.6（无 slice loop 配置）
  - 直接进入 `flows/onboarding.md`，由 onboarding 完成功能搜索（A2-Q1）和业务决策收集（A2-Q1.5）
  - STOP（不往下执行本文件的其余部分）

- **`intent = integrate-scenario`**（用户要搭建完整场景）：
  - 继续执行 A2-Qpre → A2-Q0 → A2-Q0.5 → A2-Q0.6（如适用）→ 分派

---

## A2-Qpre — 能力概览（Conference 专属，每次会话仅展示一次）

**触发条件**：`capability_overview_shown != true`。  
已展示过（包括刷新 session 或 "再加一个功能" 循环回来）则跳过。

**数据源说明**：
- 分组标题：读 `references/execution-units.yaml`（conference 域的权威分组定义）
- slice 名称和描述：读 `../../knowledge-base/conference/web/index.yaml`（conference/web 专用索引，权威源）

**执行**：

1. 读取 `execution-units.yaml` → `scenarios.general-conference.delivery_units`，获取分组标题
2. 读取 `conference/web/index.yaml` → `slices`，获取各 slice 的 `name` 和 `description`
3. 按分组渲染信息性概览（**不是选择题**，不要用 AskUserQuestion）：

```
Conference 可以帮你搭建视频会议应用，以下是可集成的全部能力：

[会议基础链路]
  登录与鉴权 — 统一登录态、SDKAppID/UserID/UserSig 鉴权、登录失效/多端顶替处理
  房间创建、加入、离开与结束 — 会议从创建到结束的主链路

[会前准备]
  ...（按 execution-units.yaml 顺序展示所有分组）
```

4. 展示后直接继续 A2-Q0，**不另起问题**
5. **写入**：`capability_overview_shown: true`，搭车写入下一次 session 写操作，不单独触发一次 Write

---

## 场景检测（A2-Q0 前置步骤）

若 session.scenario 已由 dispatcher 写入（非 null）→ 跳过本步骤，直接进 A2-Q0。

否则，只需 Read 一个文件做医疗场景匹配：

1. Read `../../../knowledge-base/scenarios/conference/medical/1v1-video-consultation.md`

对 `trigger.intent_keywords` 做大小写不敏感子串匹配：

| 命中结果 | 路径 |
|---|---|
| 命中 `1v1-video-consultation`（且有 `template` 字段）| **4-A** |
| 未命中，但含通用会议信号 | **4-B** |
| 其余所有情况（含 webinar、medical-multidoctor、完全不命中） | **4-C** |

通用会议信号（不含医疗含义）：多人会议、视频会议、在线会议、团队会议、远程协作、会议室、语音聊天室、聊天室、语音房、会控、屏幕共享、conference、meeting、room、chat room。

**规则**：没有 `template` 字段的场景一律走 4-C，不单独确认场景名称。

---

## A2-Q0 — 场景路由

### 高置信短路（session.scenario 已写入时优先执行）

| session.scenario | 处理 |
|---|---|
| `1v1-video-consultation` | 展示确认提示，`AskUserQuestion` 单选"确认用此场景"；确认 → A2-Q0.5；Other → 重新检测 |
| `general-conference` | 展示确认提示，`AskUserQuestion` 单选"确认用通用会议场景"；确认 → A2-Q0.5；Other → 重新检测 |
| 其他 / null | 按下方场景检测结果路由 |

---

### 4-A — 1v1-video-consultation（有模板）

写入 `scenario = 1v1-video-consultation`，进 A2-Q0.5（分支 1 或 2）。展示提示时不出现任何非医疗选项。

---

### 4-B — 命中 general-conference

写入 `scenario = general-conference`，进 A2-Q0.5 分支 4。

---

### 4-C — 无模板场景 / 完全不命中

**不出现场景名称菜单，不问 UI 模式，固定走 headless。**

若 A2-Qpre 未展示过，先执行 A2-Qpre 展示全量能力概览。

然后用 `AskUserQuestion`（多选）让用户选择需要的能力单元：

> 你想集成哪些功能？（可多选）

选项来自 `knowledge-base/conference/web/index.yaml` 的全量 slices，按分组展示。

写入：
```
scenario = general-conference
coverage_decided = true
confirmed_plan = [用户选中的 slices]
ui_mode = headless
integration_path = topic
```

直接分派到 headless 路径，跳过 A2-Q0.5。

---

## A2-Q0.5 — 集成模式选择

> **注意**：本节按场景类型分支，每个分支对 RoomKit 选项的可用性有明确约束，不得跨分支混用。

### 分支 1：医疗新项目

**条件**：`scenario = 1v1-video-consultation` AND `project_state.has_trtc_dep = false`

> 你想怎么开始 1v1 视频问诊项目？

| # | 选项 | 写入 | 下一步 |
|---|------|------|--------|
| 1 | 创建完整的问诊项目（推荐）— 包含完整问诊 UI、模拟数据和配置，`pnpm install` 后即可启动 | `ui_mode = medical-template`，`integration_path = medical-quickstart` | → 分派：medical-template |
| 2 | 仅生成业务逻辑代码 — 提供会议功能的 SDK 调用层（进退房、音视频、设备控制等），UI 如何呈现由你决定；适合已有设计稿或设计系统的项目 | `ui_mode = headless`，`integration_path = topic` | → 分派：headless |

用户输入 "推荐" / "1" / "模板" / "直接复制" 等简短确认时默认映射到选项 1。

### 分支 2：医疗老项目（fail-closed，RoomKit 不适用）

**条件**：`scenario = 1v1-video-consultation` AND `project_state.has_trtc_dep = true`

> RoomKit 是通用会议 UI，不适合医疗问诊场景。本路径只提供业务逻辑代码集成。

**不出现 RoomKit 选项**，直接写 `ui_mode = headless`、`integration_path = topic`，进 A2-Q0.6 → 分派：headless。

*(TODO：此路径的完整 UI 方案待补充，见 ../internal-docs/rollout/trtc-ai-integration/TODO.md)*

### 分支 3：planned scenario（fail-closed）

**条件**：`scenario ∈ {webinar-conference, medical-multidoctor-consultation}` 等 planned 场景

**不出现 RoomKit 选项**（RoomKit 暂不支持这些场景），直接写 `ui_mode = headless`、`integration_path = topic`，加过渡语（如"研讨会场景目前只支持业务逻辑模式，功能模块由你选择"），进 A2-Q0.6 → 分派：headless。

*(TODO：planned 场景上线后补充对应选项，见 ../internal-docs/rollout/trtc-ai-integration/TODO.md)*

### 分支 4：通用会议

**条件**：`scenario = general-conference`（或 4-C 完全不命中后单独触发）

> 你想用哪种方式集成会议界面？

| # | 选项 | 写入 | 下一步 |
|---|------|------|--------|
| 1 | 使用 TRTC 通用会议 UIKit（推荐，最快）— 开箱即有完整会议界面（视频、工具栏、成员列表、聊天等），通过官方 API 调整按钮和布局 | `ui_mode = official-roomkit`，`integration_path = official-roomkit` | → 分派：official-roomkit |
| 2 | 仅生成业务逻辑代码 — 提供会议功能的 SDK 调用层（进退房、音视频、设备控制等），UI 如何呈现由你决定；适合已有设计稿或设计系统的项目 | `ui_mode = headless`，`integration_path = topic` | → 分派：headless |

用户输入 "官方" / "RoomKit" / "UIKit" / "快速接入" 等时默认映射到选项 1。

**将 `ui_mode` 搭车写入 session，不单独触发一次 Write。**

---

## 分派

### medical-template 路径

**执行约束**（不可绕过）：
- **不进入 topic**，不走状态机，不物化 execution_queue
- 完成后写 `status = completed`，`flow_state.result = template-copied`

Read `playbooks/medical-quickstart.md` 并执行。

---

### official-roomkit 路径

**执行约束**（不可绕过）：
- **不进入 topic**，不走状态机，不物化 execution_queue
- 读 `knowledge-base/slices/conference/web/official-roomkit-api.md` 和 `official-roomkit-login-ui.md`
- 一次性生成登录页 + 会议室页 + 路由配置
- 完成后写 `status = completed`，`flow_state.result = official-roomkit-done`

Read `playbooks/official-roomkit.md` 并执行。

---

### headless 路径（场景驱动）

`intent = integrate-scenario`，`ui_mode = headless`，`auto_advance_policy` 已写入。

Read `flows/onboarding.md`。

传入上下文（onboarding 从 session 读取，无需另传参数）：
- `scenario`：决定 onboarding 展示哪些能力单元
  - 具体场景（如 `1v1-video-consultation`）→ 只展示该场景的 units
  - `general-conference` 或无场景（4-C）→ 展示 general-conference 全量 units
- `ui_mode = headless`
- `auto_advance_policy`：已写入 session

---

### headless 路径（单功能模式）

`intent = integrate-feature`，由 intent 路由节直接跳转至此。

Read `flows/onboarding.md`。

onboarding 从 session 读取 `target_features`，执行功能搜索（A2-Q1）和业务决策收集（A2-Q1.5）。

---

## 硬规则

1. **不要暴露内部细节**：不对用户说 "A2-Q0.5"、"playbook"、"bypass"、"domain skill"、"topic handoff"、"execution_queue" 等内部术语。
2. **医疗 / 非医疗不混排**：医疗模板选项绝不出现在非医疗用户的菜单里；RoomKit 选项绝不出现在医疗场景或 planned 场景里。
3. **UserSig 生成规则**：按 `usersig_source` 分支（见 `references/usersig-handling.md`）：`local-dev` → bundled signing lib + `getBasicInfo(userId)`（SecretKey 只写入 `src/config/basic-info-config.ts`，不进 session）；`console` → placeholder + 控制台粘贴；`backend` → 后端 API skeleton。任何路径均不得手写 `crypto-js`/`pako` 签名器，不得在浏览器端暴露 SecretKey（`local-dev` config 文件除外，且仅限本地调试）。
4. **有候选项必须用选择框**：任何场景确认、集成模式选择、功能多选、业务决策收集，只要存在固定候选项，都必须用 `AskUserQuestion`；不得以后台记录动作替代选择框。
5. **多个独立问题不要合并成自由文本**：例如“项目状态”和“UserSig 来源”必须拆成两个连续选择框分别询问；不要一次性用普通文本列出两个问题。
6. **apply 静默**：不对用户提及 apply，不说 "apply 通过了"。
7. **用用户的语言回复**：若消息是中文则中文，英文则英文；代码标识符和包名保持原始形式。
8. **planned scenario fail-closed**：任何 `status = planned` 的场景不能静默降级，必须明确告知用户并给选项。

---

## Gate 触发时的用户文案规则

任何内部 gate 或 hook 触发时，用户只能看到自然语言。**禁止**向用户说：
- CLI 命令（`python3 -m tools.*`、`next_slice.py advance`、`tools.flow enter` 等）
- 内部字段名（`business_decisions`、`coverage_decided`、`execution_queue`、`apply_passed` 等）
- Gate 名称（"topic gate blocked"、"apply gate" 等）

**各 gate 对应的用户文案**（用 AI 的口吻说）：

| 触发情况 | 向用户说 |
|---|---|
| 写代码前业务配置未收集 | 「在开始写代码之前，还有几个关于「{模块名}」的配置问题需要确认。」 |
| Apply 结构检查未通过 | 「我来检查一下刚才的代码，稍等。」（然后静默修复，不说"apply 失败"） |
| Topic phase 未进入就写代码 | 「我们先把功能模块确认好，再开始写代码。」 |
| 当前模块未完成就跳读下一个 | 「我按照模块顺序来，先完成这一步，马上到那里。」 |
| Apply 已通过等待确认 | 「这个模块已经完成，请确认一下，然后我们继续。」 |
