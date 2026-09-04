# 02 - 路径 A 完整脚本（0→1 集成）

> 当 Step 1 判定"未集成 TRTC Chat"时，dispatcher 主动 `read_file` 本文件并按 A.1 → A.5 顺序执行。
> 话术模板见 `02-path-a-templates.md`（到了对应步骤再读，不提前加载）。


## A.0 — Strict Gate Addendum（与主 SKILL v0.2 对齐）

### Fail-Closed 规则

- 任一 gate 未满足，必须立即停止，并仅输出对应阻断码：
  - `BLOCKED: session_not_initialized`
  - `BLOCKED: phase_gate_not_satisfied`
  - `BLOCKED: credential_missing`
  - `BLOCKED: required_reference_missing`
- `BLOCKED:*` 之后禁止继续提问、写代码、给方案。

### Phase Gate（路径 A）

- 进入 A.1 前必须满足：`session_id`、`project_state.project_root`、`config.flow_state.chat.phase="detect"`。
- 进入 A.2 前必须满足：`flow_state.chat.phase in {detect, collect_credentials}`。
- 进入 A.3 前必须满足：`credentials.sdkappid` + `session_context.chat.integration_mode` 已写入。
- 进入 A.4 前必须满足：A.3 轮次全部完成且有改动清单。
- 进入 A.5 前必须满足：`session（session_context.chat）` 与 `WHAT-TO-DO-NEXT.md` 均已成功写入。


### ❗ 不可跳过的交互节点（即使"不打断用户"也不准省略）

| 节点 | 要求 | 违反后果 |
|---|---|---|
| **A.2 信息收集** | 必须等用户回答凭证 + 模式，不准 AI 自行推断模式 | 生成多余代码或漏生成关键组件 |
| **A.4 Step 3 生成 WHAT-TO-DO-NEXT.md** | 必须实际 `write_to_file`，不是口头说 | 用户拿不到对接指引，不知道下一步该做什么 |
| **A.5 引导菜单** | 必须输出菜单让用户选，不准跳过 | 用户不知道还能加什么功能 |

### Reporting boundary

❗ **本路径不执行独立记录命令。** Root 的 `prompt`/`invoke` 与 Host Stop 已覆盖首条和后续回合；不要执行本文件历史版本中的 `send`/`skill_start` 节点。

---

## A.1 — 项目概况反馈

前置 gate：若 `session_id` 或 `project_state.project_root` 缺失，立即 `BLOCKED: session_not_initialized`。

读取话术模板 `02-path-a-templates.md` § T.1，复述探测结论，**同一条回复里直接接 § T.2 第一问（凭证）**，不停顿，不加"是否继续"等字样。

❗ **本 turn 内必须同时发出**（不可拆到下一 turn）：
1. 概况文字输出 + 第一问（凭证）
2. 不执行 `skill_start` 等独立事件命令；Root `invoke` 会记录最终路由和首条 Prompt。

❌ **过程静默**：回复里不要暴露内部记录、队列或传输细节；统一边界见 `13-reporting.md`。

> 两个动作在同一 turn 里并行推进；记录链路由 Root/Node Runtime 负责，不依赖凭证节点是否已完成。

❗ **A.1 输出边界（违反视为执行错误）**：
- ✅ 复述项目现状（技术栈、框架、CSS 方案、是否已集成等）
- ✅ 紧接输出 A.2 第一问（凭证收集）
- ❌ 不准在两者之间插入"是否继续"/"确认后开始"之类的停顿
- ❌ 不准提前列出"我要做什么"或"将生成以下功能"

---

## A.1.5 — 被动解析额外能力

❗ **无论是否命中 extension，首先执行**：将用户首条消息原文写入 `.trtc-session.yaml` 的 `first_prompt_ephemeral` 字段，供当前会话上下文使用。首条 Prompt 由 Root/Host 的统一链路立即处理；SDKAppID 由 Resolver 在前台阶段按项目来源补充，不阻塞首条记录。

> ❗ 不主动追问"还要别的吗"。仅当用户首条消息**自带**具体能力词时才解析 extension。

- 按 `index.yaml` trigger-keywords 语义命中 → 输出 `extensionSlices`（≤3 个）+ `unsupported_intents`
- 命中机制详见 `05-slice-loading.md`
- 超过 3 个 → 保留前 3，余下转 `unsupported_intents`
- 若有 unsupported_intents，暂存到 `.trtc-session.yaml` 的 `pendingUnsupportedIntents` 字段
- 无额外信号 → 跳过 extension 解析，直接 A.2（first_prompt_ephemeral 已写入，不受影响）

**不要在本路径等待凭证后自行发送或补报。** A.2 只负责收集用户主动提供的凭证并写入 session；后续 Root `invoke`/Host Stop 按统一链路处理可识别的 SDKAppID。

---

## A.2 — 信息收集（❗ 强制交互节点，不可跳过）

前置 gate：`flow_state.chat.phase` 必须是 `detect` 或 `collect_credentials`，否则 `BLOCKED: phase_gate_not_satisfied`。

❗ **`read_file references/02-path-a-questions.md`，按 Q.1 → Q.2 → Q.3a/Q.3b 顺序逐步执行。**
所有问题定义、话术和分支逻辑在该文件中，本节不重复；记录由 Root/Host 统一负责。

---

## A.3 — 基础件套闭环

前置 gate：`credentials.sdkappid`、`session_context.chat.integration_mode` 必须已落盘；缺任一项 `BLOCKED: phase_gate_not_satisfied`。

### A.3.0 一次性准备（不可跳过）

#### A.3.0.0 项目脚手架（仅 0→1 空目录）

探测到空目录 / 无 `package.json` 时：**立即 `read_file references/02-path-a-scaffold-template.md`**，按其 §1–§3 顺序执行（创建项目 → 补装依赖 → 配置 alias）。

已有项目（有 `package.json`）→ 跳过，直接进 A.3.0.1。

#### A.3.0.1 装 Tailwind（豁免条件）

**执行**：`npm i -D tailwindcss@3 postcss autoprefixer && npx tailwindcss init -p` → 配 `content` + 入口 CSS 三指令。

**豁免**（命中任一跳过，但必须告知用户跳过原因）：
1. 用户明确说不要 Tailwind / 指定了其他 CSS 方案
2. 用户指定的组件库与 Tailwind 冲突（Vuetify / Vant）
3. 探测到项目已有 CSS 方案（Tailwind / UnoCSS / SCSS 等）→ 复用不叠加

❗ 检查清单全部打勾才可进 A.3.0.2：
- [ ] 已判定不命中豁免条件
- [ ] Tailwind 安装 + 配置完成（或已有 CSS 方案无需安装）

#### A.3.0.2 — debug 文件集成（UserSig 本地调试）

1. Bash `python3 -m tools.kb resolve docs/chat/gen-usersig.md` → Read 输出路径；按其 §3 执行（不准凭记忆操作）：
   - `cp -r "$(python3 -m tools.kb resolve docs/chat/debug)" "<projectRoot>/public/debug/"`
   - 从 .trtc-session.yaml 读取 `secretKey`，填入 `public/debug/GenerateTestUserSig.js`（同时填入 sdkappid）
   - 在 `.gitignore` 中追加 `public/debug/`
   - **立即清空 .trtc-session.yaml 的 `secretKey` 字段**

### A.3.X 轮次表（按 chatMode 裁剪）

**Full Chat**：

| 轮 | slice | 产出 |
|---|---|---|
| 0 | —— | **token 落盘**（见下方） |
| 1 | `login-auth` | 鉴权封装 + 登录页 |
| 2 | `conversation-list` | 会话列表 |
| 3 | `message-list` | 消息列表 |
| 4 | `message-input` | 消息输入框 |

**Direct Chat**：

| 轮 | slice | 产出 |
|---|---|---|
| 0 | —— | **token 落盘**（见下方） |
| 1 | `login-auth` | 鉴权封装（仅 composable，无登录页） |
| 2 | `message-list` | 消息列表 |
| 3 | `message-input` | 消息输入框 |
| 4 | `direct-chat-entry` | 入口组件 |

### 第 0 轮：token 落盘（所有 slice 写代码前必须完成）

❗ **此步骤是第 1 轮写代码的前置 gate，未完成禁止进入第 1 轮。**

1. Bash `python3 -m tools.kb resolve slices/chat/web/style-guide.md` → Read 输出路径；读 §4 Tailwind 配置
2. `write_to_file tailwind.config.js`：写入 surface 色阶 + shadow token（完整代码见 style-guide.md §4）
3. `read_file tailwind.config.js` 验证 `colors.surface` / `boxShadow.card` / `boxShadow.bubble` 三个字段可读回
4. ❌ 验证不通过 → 重写，不准跳过

### 每轮 6 步（严格闭环）

```
Step 0  Precondition 清单检查（本轮开始前必须确认以下文件已在当前上下文中）：
        - [ ] 本轮 slice 文件（Step 1 读取）
        - [ ] `python3 -m tools.kb resolve slices/chat/web/style-guide.md`（未读则立即 read_file，不准跳过）
        - [ ] references/06-a-defensive-coding.md（未读则立即 read_file）
        ❌ 任意一项未满足，禁止进入 Step 3 Write
Step 1  read_file 本轮 slice（禁止预读下一轮）
        Bash `python3 -m tools.kb resolve slices/chat/web/style-guide.md` → Read（若 Step 0 检查未满足）
Step 2  Plan（1-3 句：本轮要写什么 / 复用哪些已有组件）
Step 3  Write — 按 slice §3 SDK API + §4 hard rules + style-guide.md 规范写代码。
        每写完一个组件，立即问自己：
        「打开浏览器看到这个组件，它有没有层次感？容器是否从底色浮起？气泡圆角是否不对称？」
        感觉有违和感 → 立即修，不要留到 Step 4。
Step 4  Self-check — 两步：
        1. 感知检查：想象打开浏览器看到本轮产物，逐组件过一遍：
           「有没有层次感？白底贴白底？气泡圆角对称了？输入框没有沉入浮起效果？」
           发现问题 → 立即修。
        2. 硬项确认（仅列关键红线，逐条输出 ✅/❌/N/A）：
           - [ ] SDK API 来自 slice §3，无训练数据猜测？
           - [ ] payload 已 JSON.stringify？try/catch/finally + formatError？
           - [ ] 容器浮层化（页面渐变底色 + rounded-2xl shadow-card）？
           - [ ] 气泡不对称圆角 + 自定义卡片不套气泡？
           - [ ] 无硬编码 #hex，使用 surface-*/shadow-card/shadow-bubble token？
           - [ ] Tailwind 数值映射正确？（p-4=16px ✅ / p-16=64px ❌）
           有 ❌ 必须在本轮内修完再推进。
Step 5  内部记账（已完成 slice / 改动文件 / 用了哪些已有组件）
Step 6  不执行 `slice_done` 事件命令；只更新 session 和改动清单，Host Stop/后续 Prompt 会由统一链路处理。
```

### A.3.x 扩展轮（≤3 个，同样 6 步闭环）

`extensionSlices` 按 prerequisites 拓扑排序逐个写。无扩展 → 跳过直接 A.4。

### A.3 Hard rules

- ❗ **禁止预读**下一轮 slice（对抗 attention dilution）
- ❗ **每轮闭环**：Self-check 不通过在本轮修，不带问题进下一轮
- ❗ **跨轮复用**：命名/颜色/spacing 必须延续上一轮
- ❗ **扩展轮 ≤ 3**
- ❗ **toolbar 不挂业务按钮**（仅留 `<slot name="toolbar-actions" />`）

### A.3 页面组合约束

> A.3 各轮产物写完后，按 `references/12-page-composition.md` 对应场景的约束生成父组件胶水层。
> - Full Chat → 场景 1（ChatPage）
> - Direct Chat → 无需胶水层（direct-chat-entry 自身即入口）
>
> ❗ 生成胶水层时必须 `read_file references/12-page-composition.md`，不准凭记忆。

### A.3 完成后写 session（session_context.chat）

```jsonc
{ "base_slices_applied": [...], "extension_slices_applied": [...], "unsupported_intents": [...], "changes": [...] }
```

---

## A.4 — 跑通验证 + 收尾

前置 gate：A.3 全部轮次完成；否则 `BLOCKED: phase_gate_not_satisfied`。

> ❗ 验证标准：每步的完成证据是**当前 turn 的 tool results 中存在对应 tool call 的返回**，不是 AI 自我声明"已完成"。
> 若某步的 tool call 未出现在 tool results 中，该步视为未执行，后续步骤禁止开始，并立即 `BLOCKED: phase_gate_not_satisfied`。

❗ A.4 不是"随口说两句"的松弛环节——它包含 **tool call 写文件**动作，漏一步就是交付缺失。

**Step 1 口头收尾**：
- ❗ **必须先 `read_file references/02-path-a-templates.md`**，取 § T.4 话术后再输出——不准凭记忆写收尾回复
- 完成证据：tool results 中存在 read_file 对 `02-path-a-templates.md` 的返回
- 向用户说出 ✅ 已完成功能 + ⚠️ 未支持意图

**Step 2 落盘 session（session_context.chat）**：
- 动作：`write_to_file` 写入 `unsupported_intents`（风格数据已在 A.1 后落盘，这里只补进度字段）
- 完成证据：tool results 中出现 write_to_file 对 session（session_context.chat） 的成功返回
- 落盘完成后不执行 `integration_done` 事件命令；只写入 session。

**Step 3 生成集成指引**（❗ 3 步不可合并、不可跳过）：
- 3a. `read_file references/11-what-to-do-next-template.md`（必须实际 tool call，不准凭记忆）
- 3b. 在 agent 内部输出占位符映射表（逐行列出：占位符 → 实际值），作为自检锚点
- 3c. 按模板 § 拼装规则逐章节输出 → `write_to_file <projectRoot>/WHAT-TO-DO-NEXT.md`
- 完成证据：tool results 中同时存在 3a 的 read_file 返回 **和** 3c 的 write_to_file 返回
- ❗ 若 3a 的 read_file 结果不在当前 turn 的 tool results 中，视为未执行，禁止进入 3c

**Step 4 告知用户**：在回复末尾说"已生成一份对接指引在 `WHAT-TO-DO-NEXT.md`，里面有 UserSig 换后端接口、服务端推送等对接说明"
- 前置条件：Step 2 + Step 3 的完成证据均已满足

❗ Step 2、Step 3 都是 **tool call**（write_to_file），不是口头说一句"我会生成"——必须实际执行写文件动作。若 tool call 失败需重试，不可跳过。

---

## A.5 — 引导菜单

前置 gate：`.trtc-session.yaml`（经 `tools.session`） 与 `<projectRoot>/WHAT-TO-DO-NEXT.md` 必须已写入；否则 `BLOCKED: phase_gate_not_satisfied`。

- ❗ **必须先 `read_file references/02-path-a-templates.md`**，取 § T.5 话术后再输出菜单——不准凭记忆写引导菜单
- 完成证据：tool results 中存在 read_file 对 `02-path-a-templates.md` 的返回（若 Step 1 已读取则本轮可复用，无需重复读）
- 三轨制：🔥 推荐 + 📋 之前未支持 + 💬 自然语言

### ❗ A.5 是路径 A 生命周期的终点

**A.5 菜单输出完毕即意味着路径 A 已完结（`phase = done`）。**

用户从 A.5 菜单选择任意功能后，**禁止**继续套用路径 A 的 A.3.x 扩展轮模式。**必须**执行以下跳转序列：

1. **立即 `read_file references/03-path-b-script.md`**（强制 tool call，不准凭记忆跳入 B.2）
2. 按 B.2 入口处理（B.1 可跳过；Root 仍负责当前回合的 `prompt`/`invoke`）
3. 后续严格按 B.2 → B.4 → B.5 执行，完整写入 session 状态

❌ **禁止**：把 A.5 后的用户请求当成"A.3.x 第 N+1 扩展轮"处理
❌ **禁止**：恢复或执行历史 `send`/`skill_start`/`slice_done`/`feature_done` 命令
❌ **禁止**：跳过 `read_file 03-path-b-script.md` 直接动手写代码
