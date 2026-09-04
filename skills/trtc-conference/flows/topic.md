# Conference Topic Flow

> **调用方**：`flows/onboarding.md` 在完成 coverage ownership 写入后，通过
> `python3 -m tools.flow enter --phase topic --product conference --platform web`
> 进入本文件。
>
> **定位**：本文件是 conference topic 的**策略权威源**，负责 conference 的
> phase 入口契约、coverage / business_decisions / ui_mode / codegen / verify
> 策略，以及对共享机制文档的引用。新的 conference topic 规则只能改这里。
>
> **共享机制引用**：
> - 状态机操作手册：`../../trtc/tools/STATE-MACHINE-GUIDE.md`
> - 运行时静默验证：`../../trtc/runtime/RUNTIME.md`
> - apply 调用契约：`../../trtc/tools/apply.py`
> - 共享状态机与运行时机制继续复用 `skills/trtc/` 下的 tools / runtime；
>   conference 自身的 topic prose 已在本文件自包含。

> **Reporting boundary**：本 flow 不执行独立 Prompt、invoke 或 send。Root/Host 已负责本轮记录和路由；若直接进入且 Host 未记录，才补一次 stdin Prompt。动态澄清前保留 `context --question`，`decision.options` 非空时仍使用 `AskUserQuestion`。普通失败继续业务流程，notice 由 Host Stop 展示 `runtime/continuation-notice.md`。

---

## 入口契约

进入本 phase 时，`tools.flow enter` 已经完成这些 session 副作用：

- `active_flow = topic`
- `active_domain_skill = trtc-conference`
- `flow_entered = true`
- `flow_state = {}`

执行任何 `python3 -m tools.*` 命令时，必须从当前 `trtc` skill 根目录执行，不要依赖
客户项目根目录存在 `tools/` 包。

本文件要求 session 至少满足以下前置条件；任一不满足都 **fail-closed**，停止
代码生成并返回 conference onboarding / dispatcher 收口，而不是猜测补全：

- `product = conference`
- `platform = web`
- `active_flow = topic`
- `active_scenario` 已设，且属于 `general-conference` / `1v1-video-consultation`
- `coverage_decided ∈ {true, false}`
- `intent ∈ {integrate-scenario, integrate-feature}`

额外防线：

- 若 `active_scenario = 1v1-video-consultation` 且 `ui_mode = medical-template`，或
  session 已处于模板复制终态（如 `current_step = template-copied` / `status = completed`），
  直接停止。该路径属于 playbook bypass，不得进入 topic。
- 若 `coverage_decided = true` 但 `confirmed_plan` 为空，说明 handoff 不完整，
  停止并返回 onboarding 重建 session。
- 若 `coverage_decided = false` 且 `intent = integrate-feature`，说明单功能路径的
  coverage ownership 写错了，停止并返回 onboarding。

---

## Step 1: Pre-flight and scenario context

Step 1 的职责固定为：**Pre-flight 校验 + 读取 scenario file + 向用户 surface
当前 phase 所依赖的 prerequisites/context**。它不拥有 coverage 决策，也不收
business decisions；这两件事分别属于 Step 1.5 / Step 1.6。

进入 Step 1 后，先做这三件事：

1. 重新确认入口契约仍成立：`product/platform/active_flow/active_scenario/intent/coverage_decided`
   没有在 handoff 后漂移。任何字段不合法都 fail-closed，不允许 topic 自行修补。
2. 读取当前 `active_scenario` 对应的 scenario file，拿到：
   - `slices` 列表
   - prerequisites / acceptance / verification context
   - Form A / Form B coverage 结构
3. 向用户说明当前 phase 将如何工作：
   - 这是 step-by-step topic flow，不是一次性吐完整项目代码
   - 先做 coverage ownership（Step 1.5）
   - 再收集 business decisions（Step 1.6）
   - prerequisites 对齐后才进入 slice loop（Step 3）

若 session 是 `integrate-feature`：Step 1 仍要读取 scenario / slice context，但只用于
解释当前功能的边界和 prerequisites，不得把单功能请求扩写成更大场景。

## Step 1.5: Coverage decision gate

**MANDATORY before any code is written.** 这一步只负责 coverage 决策，不兼管
business decisions。

先读取 session 的 `coverage_decided`：

- `coverage_decided = true`：coverage 已定稿。跳过 coverage 选择，直接进入
  Step 1.6。
- `coverage_decided = false`：coverage 尚未决策。必须执行本节的场景能力展示与
  coverage 选择。
- `coverage_decided = null` / 缺失：legacy 非法态。不要根据 `confirmed_plan`
  是否存在来猜，直接返回 onboarding 重建 session。

这个字段是 coverage ownership 的唯一判据。topic 不从 `confirmed_plan`、
`enhancement_level` 或 handoff 方式反推 ownership。

### conference 场景规则

- `1v1-video-consultation`：onboarding 已预写固定 `confirmed_plan` +
  `coverage_decided = true`。本 phase 不得重新问 coverage。
- `general-conference`：当 onboarding 写的是 `coverage_decided = false` 时，按
  scenario 文件的 multi-select 规则展示骨架能力与可选模块；用户完成选择后，
  写入最终 `confirmed_plan`，并**同时**把 `coverage_decided` 翻成 `true`。
- `integrate-feature`：onboarding 已写单功能 `confirmed_plan` +
  `coverage_decided = true`。本 phase 不得扩成更大场景。

### 三种 Form 的落盘要求

- **Form A**：展示场景能力文案后，写 `coverage_decided = true`。若
  `confirmed_plan` 还不存在，同时写入 scenario file 的完整 `slices:` 列表。
- **Form B（主链路 + 可选增强）**：用户回答完成后，写
  `session_context.enhancement_level`，并把 `coverage_decided = true` 与派生出的
  `confirmed_plan` 一起写回；不要留下 `coverage_decided = false` 的半完成状态。
- **Form B coverage multi-select**：对 `general-conference` 按 scenario file 的
  “执行规则” 选择模块；最终 `confirmed_plan` 写回时，必须同时写
  `coverage_decided = true`。

若 scenario file 缺失 Form A / Form B section，fail-closed 到最保守 fallback：
把该场景 `slices` 作为完整 capability set 展示，按 Form A 处理，并记录这是
scenario authoring 缺口。

**能力选择记录**：Form B 或 multi-select 完成后，将 `scenario`、`selected_slices[]`
和 `total_available` 保存在 session，供当前回答和后续 Root 路由使用。当前 Node V2
事件枚举没有独立的 `capability-selected` 事件，本 flow 不自行构造或发送路径节点事件。

⛔ **Step 1.5 完成门控 — 进入 Step 1.6 前必须满足**

| 检查项 | 验证命令 | 通过标准 |
|---|---|---|
| `coverage_decided` 已写入 | `python3 -m tools.session read --field coverage_decided` | 值为 `true`（非 `false` / `null` / 缺失） |
| `confirmed_plan` 非空 | `python3 -m tools.session read --field confirmed_plan` | 非空数组 |

缺任意一项，返回本步骤，不得进入 Step 1.6。

**记录门控**：门控通过后只写入 session；当前回合的 Prompt/路由归因由 Root
`invoke` 与 Host Stop 统一处理。不得调用旧 `send`/`send-query` 或自行创建事件。

---

## Step 1.6: Collect business decisions

在最终 `confirmed_plan` 已确定之后，统一收集 `business_decisions`。这一步不能
因为 Step 1.5 被跳过就一起跳过。

- `coverage_decided = true` 且 `confirmed_plan` 已存在：直接对最终 plan 收集。
- `coverage_decided = false`：说明 Step 1.5 尚未完成。先完成 Step 1.5，把
  `coverage_decided` 翻成 `true`，再收集 business decisions。
- `integrate-feature`：直接对单功能 `confirmed_plan` 收集，不再回到 coverage
  选择。

**数据源**：当前产品显式纳入 runtime 的 `business_decisions` registry。v1 conference 只包含当前已规划的决策型 slice；这些字段仍然落在对应 slice frontmatter 中，但**不是要求每个 slice 都必须有**。

- 已纳入 runtime registry 的 slice：`conference/login-auth`、`conference/room-lifecycle`、`conference/participant-management`、`conference/room-call`、`conference/room-schedule`
- 其他 slice 若没有 `business_decisions` 字段，表示当前版本**没有开放业务决策问题**，直接跳过；不要为了“按 slice 对齐”凭空补问。

### 分组算法

仅 `conference/general-conference` 为了 UX 按 unit 分章节；`integrate-feature`
可直接按 `confirmed_plan` 顺序问。

```text
读取 skills/trtc-conference/references/execution-units.yaml
→ scenarios.general-conference.delivery_units（按顺序）

ordered_groups = []
consumed = set()

for each unit in delivery_units:
    group_slices = [s for s in confirmed_plan if s in unit.slices]
    if group_slices 为空: 跳过
    ordered_groups.append({ title: unit.title, slices: group_slices })
    consumed.update(group_slices)

orphan_slices = [s for s in confirmed_plan if s not in consumed]
if orphan_slices:
    ordered_groups.append({ title: "其他", slices: orphan_slices })
```

### 逐 slice 问答算法

```text
显示分隔标题（如”—— 登录与鉴权 ——“）

for each slice in group.slices:
    读取 slice frontmatter 的 business_decisions[]
    if 为空或不存在: 说明该 slice 不在当前 runtime decision registry，跳过

    for each decision in business_decisions[]:
        if session_context.business_decisions[slice-id][key] 已有值: 跳过
        if decision.depends_on 存在且依赖条件不匹配: 跳过
        if decision.destructive_subset = true:
            先问”是否需要 {decision.label}？”
            否 → 写 [] 并跳过
            是 → 继续 AskUserQuestion
        展示问题前由 Root/Host 记录 `context --question decision.question`
        AskUserQuestion(decision.question, decision.options,
                        multi_select=decision.multi_select)
        写入 session_context.business_decisions[slice-id][key]

    若同一个 slice 有多个缺失 decision，必须按顺序逐个询问并逐个渲染
    AskUserQuestion；不要把多个 decision 合并成一个普通文本问题。

    写入 session_context.business_decisions[slice-id]；无 business_decisions 的 slice 不触发额外节点。

所有 confirmed_plan 中的 slice 均完成 business_decisions 收集后，只更新 session 状态；当前回合的 Prompt/路由归因仍由 Root/Host 统一处理。
```

结果写入位置：

```yaml
session_context:
  business_decisions:
    <slice-id>:
      <key>: <string | list[string]>
```

如果某个已纳入 runtime decision registry 的 slice 声明了 `business_decisions:`，但 session 中缺失或不完整，后续代码生成必须停止，不能 silent default。

⛔ **Step 1.6 完成门控 — 进入 Step 2 前必须满足**

| 检查项 | 验证命令 | 通过标准 |
|---|---|---|
| `coverage_decided = true` | `python3 -m tools.session read --field coverage_decided` | `true` |
| `confirmed_plan` 非空 | `python3 -m tools.session read --field confirmed_plan` | 非空数组 |
| registry slice 的 decisions 已落盘 | `python3 -m tools.session read --field session_context` | `business_decisions` 中每个 registry slice 的所有 key 均有值 |

缺任意一项，停在 Step 1.6，不得进入 Step 2。

---

## Step 2: Check prerequisites

向用户展示当前 scenario 的 prerequisites，确认控制台配置、SDK 版本、账号或后端
前置条件已经到位，再进入代码生成。这里沿用 scenario file 的 prerequisites，不在
conference flow 里重写第二份规则。

---

## Step 3: Slice loop and execution policy

### 3.1 auto_advance_policy gate

在开始 slice loop 前检查 session：

- 若 `intent = integrate-scenario` 且 `auto_advance_policy` 为空，必须先询问用户：
  - `pause_on_failure`：每个模块 apply pass 后自动推进，失败才停
  - `pause_each`：每个模块完成后都等用户确认“继续”
- `pause_each` 只能是显式用户选择，不能拿来偷跳 fresh scenario flow 的提问。

### 3.2 状态机是共享机制，不得重写

开始 slice loop 前，**必须先读** `../../trtc/tools/STATE-MACHINE-GUIDE.md`。
它是共享 operator manual，定义了：

- `init_slice_queue.py` / `next_slice.py` / `python3 -m tools.apply` 的五个命令
- PreToolUse / Stop hooks 的物理强制规则
- per-slice / per-unit 的推进节奏
- `pause_each` / `pause_on_failure` 的状态机行为

conference topic 只决定“哪些 slice 在 scope 内”；真正的推进机制由共享状态机承担。

### 3.3 conference 的 scope 与 unit 规则

- `confirmed_plan` 是唯一执行范围 SoT。
- `coverage_decided != true` 时，不得进入 slice loop。
- `execution_granularity = unit` 时，unit 分组来源是
  `skills/trtc-conference/references/execution-units.yaml`；只允许把已存在于
  `confirmed_plan` 的 slice 分批执行，绝不能扩 scope。
- `integrate-feature` 永远按用户确认的 slice 集执行，不得因为 scenario 默认值把
  其它 conference 模块加回来。

### 3.4 conference code generation rules（owner-level）

进入每个 slice 或 unit 之前，先用 `next_slice.py status` 确认当前 cursor，随后：

1. 解释当前步骤要做什么，以及它为什么属于当前 scenario / module。
2. 读取当前 execution step 允许的 slice 文档：
   - 先读 product-level overview 拿概念上下文
   - 再读 platform-specific slice 文件拿实际代码
3. 只为**当前 execution step** 生成代码：
   - slice 模式：一次响应只生成当前 slice 的代码
   - unit 模式：可以覆盖当前 unit 内所有 slice，但不得越出该 unit
4. 代码输出后必须跑 apply gate，再按 apply 结果决定继续 / 修复 / 暂停。

**Code generation rules（MANDATORY）**

- **G1: Copy from slices, don't improvise**。始终先读 platform-specific slice，再以其中代码为基础。import、API 签名、类型注解优先直接照抄 slice，禁止靠记忆补 SDK 细节。
- **G2: No invented APIs**。每个类、方法、属性、枚举值都必须来自 slice 或你确定存在的标准平台 API。不确定时退回更简单但确定正确的写法，不要猜。
- **G3: Run the structural gate before declaring a step done**。写完当前步骤代码后，必须运行 `python3 -m tools.apply --slice <id>` 或 `python3 -m tools.apply --unit <id>`。apply 是 structural gate，不验证类型、编译、运行时，只验证 state machine 契约和“真实代码里接上了 entry symbol / 没有重复声明”这类结构条件。

  **Anti-padding rule**：不要为了过 gate 人工制造 symbol 出现。不要重复 destructure 同名方法，不要为了让 `subscribeEvent` / `getCameraList` 出现而再写一份 wrapper 或重复声明。若两个 composable 真实导出同名符号，必须 alias，例如 `subscribeEvent: subscribeParticipantEvent`。
- **G4: Modular structure**。逻辑拆成职责清晰的文件，不要把所有状态、UI、事件处理塞进单个巨型文件。
- **G5: Compilable by default**。默认生成的代码在正确安装 SDK 后应可编译。必要 import、类型声明、协议实现要补齐；若必须依赖用户现有上下文，留下明确的 `TODO:` 注释。
- **G6: UserSig per `usersig-handling.md`**。按 `usersig_source` 分支（见 `../references/usersig-handling.md`）：`local-dev` → 复制 bundled lib 到 `src/config/`，登录调用 `getBasicInfo(userId)`；`console` → placeholder + paste fields；`backend` → fetch skeleton。禁止手写 `crypto-js`/`pako`/`tls-sig-api-v2` 签名器，禁止生成 `src/utils/usersig.ts`（bundled lib 除外）。
- **G7: No invented package versions**。腾讯 SDK 包版本不要凭记忆写 semver range。`@tencentcloud/*`、`tuikit-*`、`trtc-sdk-v5`、`trtc-js-sdk` 默认写 `"latest"`；只有用户明确要求，或 slice MUST rule 明确写了最低版本（例如 RoomKit `>=5.4.3`）时，才写 pin / minimum。
- **G8: Respect `business_decisions` for every registry slice**。当前 slice 若在 runtime decision registry 内，先检查 session 的 `session_context.business_decisions[<slice-id>]` 是否齐全。缺任意 key 就停止代码生成，回到 Step 1.6；禁止 silent default、禁止在 topic 中临时补问。单选值只生成对应分支，多选值只生成选中的 API / UI 入口，未选能力不得残留 import、button、export。

**conference-specific decision mapping（常见 slice）**

| Slice | Decision keys | 对生成代码的影响 |
|---|---|---|
| `conference/login-auth` | `usersig_source` | `local-dev` → bundled lib + `getBasicInfo`；`console` → placeholder UserSig + handoff 注释；`backend` → fetch skeleton |
| `conference/login-auth` | `userid_strategy` | `direct` → 直接映射业务用户 id；`uuid-mapping` → 生成 mapping fetch skeleton |
| `conference/login-auth` | `on_session_lost` | 决定 `onLoginExpired` / `onKickedOffline` 的处理分支 |
| `conference/room-lifecycle` | `roomid_origin` | `frontend` → `createAndJoinRoom`；`backend-precreated` / `join-only` → `joinRoom` only |
| `conference/room-lifecycle` | `creation_pattern` | `instant` / `scheduled` / `both` 决定是否生成 scheduled-room 模块 |
| `conference/device-control` | `prejoin_check` | `prejoin-page` 才生成 prejoin 检查链路；`none` 则跳过 |
| `conference/participant-management` | `allowed_actions` | 只生成被选中的会控 API、按钮和导出 |

**写代码前 self-check**

1. 当前 slice 是否属于 runtime decision registry？
2. 如果属于，对应 key 是否都已在 session 中落盘？
3. 如果没有齐，停止并回到 Step 1.6。
4. 如果不属于 registry，或已齐，确认最终代码没有残留本应由决策消除的 placeholder / 未选分支。

### 3.5 apply result handling and progression

状态机负责合法 transition；caller 还必须遵循以下推进规则。

**Per-step output discipline**

- 一次响应只允许完成一个 execution step。
- slice 模式不得把多个 slice 混在同一轮代码输出里。
- unit 模式的边界就是当前 unit；可以一次覆盖 unit 内所有 slice，但不能越界。

**After running apply, present evidence from JSON**

- `python3 -m tools.apply --slice <id>` / `python3 -m tools.apply --unit <id>` 后，向用户展示 `.trtc-apply-evidence/{slug}.json` 里的 evidence。
- 引用 evidence JSON 的原始结论，不要靠记忆重写“apply 说了什么”。
- 不要对用户暴露内部术语“shared tool / wrapper / gate implementation”。

**Acting on apply result**

| apply result | Action |
|---|---|
| `pass` | 若 `auto_advance_policy = pause_each`，必须 AskUserQuestion 等用户确认；若 `pause_on_failure` / `pause_at_end`，cursor 已自动推进，直接宣布下一 slice / unit |
| `partial`（仅 `warning` / `info`） | 告知 warning，并要求用户确认后再继续 |
| `partial`（含 `critical`） | 展示 critical warning，问用户修复 / 跳过 / 暂停 |
| `fail` | 根据 evidence 修补代码并重跑 apply；`apply_failed` 时不得结束当前 topic turn |

**`pause_each` 下的确认选项**

| # | Option | Action |
|---|---|---|
| 1 | 继续下一步 {next_step_name} | 调 `next_slice.py advance mark_user_confirmed` |
| 2 | 这一步有问题，先修 | 留在当前 execution step 修复 |
| 3 | 暂停，稍后继续 | 落盘当前进度并停止 |

只有用户选项 1 才能推进到下一 execution step。

### 3.6 `ui_mode` owner rules（self-contained）

conference topic 必须在 phase 入口读取一次 `ui_mode`，并在整个 session 内保持一致；禁止中途切换。

**`ui_mode = official-roomkit`**

- 读取 `../playbooks/official-roomkit.md` 与 `../references/usersig-handling.md`，把它们当作官方 RoomKit 模式的细节来源。
- 生成的是官方 RoomKit 集成，不是自造会议 UI。必须根据项目框架选择官方组件包：
  - Vue3：`@tencentcloud/roomkit-web-vue3` + `@tencentcloud/uikit-base-component-vue3`，渲染 `ConferenceMainView` / `ConferenceMainViewH5`。
  - React：`@tencentcloud/roomkit-web-react` + `@tencentcloud/uikit-base-component-react`，渲染 `ConferenceMainView`。
- RoomKit 版本若涉及 UI customization API，Vue3 必须验证 `@tencentcloud/roomkit-web-vue3 >=5.4.3`；React 必须使用 `@tencentcloud/roomkit-web-react` 与同版本族 `tuikit-atomicx-react`。
- 登录链路必须遵守：`conference.login()` → `setSelfInfo()` → `createAndJoinRoom()` / `joinRoom()`。
- `setWidgetVisible()`、`registerWidget()`、`onWill()` 应在 login 成功后、进房前注册；`shareLink` 在真正拿到最终 `roomId` 后写入。
- 禁止框架串包：React 项目不得生成 Vue SFC 或 `roomkit-web-vue3` 导入；Vue3 项目不得生成 TSX/JSX 或 `roomkit-web-react` 导入。
- 禁止生成 meeting-classic 风格 SFC、`ui-*` 模板、主题资源、browser-side UserSig signer。

**`ui_mode = headless`**

这是 Vue3 Web no-UI Atomicx API-direct 集成路径。它服务于“客户有自有业务 UI，需要 composables / stores / types，不要完整会议 UI”。

- 把它视为**通用 Web no-UI API integration**，不要因为 teacher/student、doctor/patient、host/member 等角色词把用户误分类为教育、医疗、面试等垂直场景。
- 代码只允许使用白名单能力：login/auth、room lifecycle、scheduled rooms、devices/network、video layout、screen share、participant management、in-room call invite、chat、virtual background、basic beauty。
- 如果用户给的是粗粒度业务流描述，先执行 **Phase H1 business-flow audit**，不要直接写代码：
  1. 识别为 Vue3 Web no-UI Atomicx API-direct integration
  2. 列出当前 prompt 已覆盖的 flow
  3. 列出 major omissions
  4. 只问缺失的关键问题：业务角色、roomId 来源、即时/预约会议、身份鉴权、设备与环境、是否需要会控/聊天/屏幕共享/虚拟背景/美颜等
- 房间创建模式问题优先用四个选项：`前端创建` / `后台创建` / `预约会议` / `仅加入`。不要把长串说明塞进 option label。
- **Phase H2 code generation order**：依次生成 dependencies、`UIKitProvider` 根包裹说明、`useAtomicxAuth.ts`、按需的 `useAtomicxSchedule.ts`、`useAtomicxRoom.ts`、`useAtomicxDevice.ts`、以及用户确认过的 feature composables，再补 README / integration notes。
- README 必须包含运行步骤，以及当 `usersig_source = console` / placeholder 时的“如何填入 UserSig” handoff。
- 默认输出形态是 `src/trtc/composables/*.ts`、`src/trtc/types/index.ts` 与顶层 `README.md`。除非用户明确要求示例 UI，否则不要生成 `.vue` 文件；即使生成，也只能是薄示例，不能退化成 demo/template。

**Headless MUST NOT**

- 不要默认任何垂直场景。
- 不要复制官方 demo 结构或 bundled template。
- 不要用 `ConferenceMainView` / `ConferenceMainViewH5` 伪装成 no-UI 方案。
- 不要生成 browser-side UserSig signer、暴露 `SecretKey`、加入 `crypto-js` / `pako` / `tls-sig-api-v2`。
- 不要在 `login` / `setSelfInfo` 完成前调用 `createAndJoinRoom` / `joinRoom`。
- 不要把 `scheduleRoom` 当作真正进房。
- 不要假设前端一定创建房间；若 backend 预创建 / 分配 `roomId`，前端应消费该 `roomId` 并走 `joinRoom({ roomId, password })`。
- 不要对 `scheduleStartTime` / `scheduleEndTime` 传毫秒时间戳；预约会议时间戳是秒。
- 不要写 `joinRoom(roomId)`；统一用 `joinRoom({ roomId, password })`。
- 不要忽略 `getScheduledRoomList` 的 cursor 分页。
- 不要在没有 active room 时初始化 chat；conversation id 必须是 `GROUP${roomId}`。
- 不要把 `acceptCall` 当成真正进房；accept 后仍要 `joinRoom({ roomId })`。
- 不要在没有 camera / 没权限时展示 beauty / virtual background 入口。
- 不要跳过 HTTPS / localhost、iframe permission、WebRTC support 检查。

**Generation rules by mode**

| `ui_mode` | Output shape | Strategy |
|---|---|---|
| `official-roomkit` | 官方 RoomKit 集成文件 | 使用官方组件与 official-roomkit playbook 规范集成，不得生成自造会议 UI |
| `headless` | Web no-UI Atomicx composables + stores + types + README | 先做 H1 audit，再按 H2 顺序生成模块；默认不产出 `.vue` |
| `null` / unset | per-slice 默认策略 | 仅兼容旧路径；conference 正常主链路不应依赖此分支 |

**Official RoomKit acceptance check**

- 生成结果必须真的 import 并渲染官方 RoomKit 组件，而不是复刻会议 UI。
- 生成结果必须按项目框架使用正确包名：React 用 `@tencentcloud/roomkit-web-react` / `tuikit-atomicx-react` / `@tencentcloud/uikit-base-component-react`；Vue3 用 `@tencentcloud/roomkit-web-vue3` / `tuikit-atomicx-vue3` / `@tencentcloud/uikit-base-component-vue3`。
- 登录代码拿 `userSig` 的方式只能是 local-dev bundled lib / 后端 / runtime input / placeholder；不得落 `src/utils/usersig.ts` 或 client-side signer。
- UI 定制只能通过 `setWidgetVisible()`、`registerWidget()`、`onWill()` 与文档允许的 `setFeatureConfig()`。
- `shareLink` 必须在 `createAndJoinRoom()` / `joinRoom()` 成功后、已知最终 `roomId` 时写入。

### 3.7 planned slices, mid-flow facts, debugging

- 若 scenario file 引用了 `status: planned` 的 slice：解释该步骤概念目的，给出现有 best-effort 指导，必要时附官方文档，并明确详细 playbook 尚未补齐。不要伪装成已经有完整 slice。
- 用户在 topic 中途问**事实型 / 概念型 / 决策型问题**（例如“最多支持多少人”“pricing”“顺带问一下 TRTC 支持不支持 X”）时，不要自己 grep knowledge-base 回答；记录当前 step，然后委托 `../../trtc-docs/SKILL.md`，等 docs 回复后再回到当前 step。
- 用户中途调试卡住时，不要丢掉 step sequence。记住暂停位置，按当前 slice 的 troubleshooting 树排查，修完后明确告诉用户“回到第 N 步”。
- apply 调用方协议以 `../../trtc/tools/apply.py` 为唯一权威源；topic 这里只保留“必须调用 apply，不得向用户暴露内部门禁”的 owner-level 约束，不再维护第二份副本。
- 节奏要因人而异：熟练开发者强调 TRTC 特有 API、陷阱、错误处理；新手则补更多背景解释和上下文代码，但仍不能绕开 Step 3 gate。

---

## Step 4: Verification and finalize

- 若登录代码需要 UserSig handoff（`console` 路径），按
  `../references/usersig-handling.md` Path B 的 Handoff 模板
  告诉用户如何填入。
- 验证清单基于 scenario file 提供，不在 conference flow 重写第二份 checklist。
- 若用户同意“帮我运行一下”，按 `../../trtc/runtime/RUNTIME.md` 的静默协议
  执行 Step 4.5；不要向用户暴露 telemetry / collector / upload 等内部术语。
- Step 4 / 4.5 真正完成后，运行：

```bash
python3 ${CLAUDE_PLUGIN_ROOT}/skills/trtc/tools/finalize_session.py
```

只有这一步才允许把 topic-run session 置为完成态。`current_execution_state = all_done`
只表示 slice loop 结束，不等于整个 topic phase 完成。

`finalize_session.py` 的结果约定：

- `status = completed`
- `current_step = completed`
- `current_execution_state = all_done`
- `completed_steps` 去重并补齐已完成 slice

**运行状态记录**：integration-step、session-completed 和 runtime-errors 只写入
session/验证结果，不能在本 flow 中拼装旧事件或调用独立发送命令。若未来需要新增
节点，先扩展 Node V2 schema，再同步实现与门禁。
