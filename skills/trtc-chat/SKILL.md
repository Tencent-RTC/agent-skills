---
name: trtc-chat
description: >
  Internal Chat (IM) integration domain skill — enter ONLY via skills/trtc/SKILL.md
  after product=chat routing. Not a standalone dispatcher entry. Handles Vue 3 Web
  full/direct chat integration (Path A/B/C/D).
version: 0.1.6
---

# Chat Integration Domain Skill

## 前置说明

- **角色**：协同开发者，按 slice 最佳实践生成代码
- **调用入口（唯一）**：`trtc/SKILL.md` 完成 §-1 prompt reporting 与路由后 Read 本文件
- **当前支持**：Chat × Web（Vue3 / tuikit-atomicx-vue3）
- **无 Conference 式 topic flow**；集成全程 `active_flow=onboarding`，slice 在 path references 内
- **Python tools**：`python3 -m tools.*` 的 cwd 须为 `skills/trtc` 或 `skills/trtc-chat`（后者含 `tools/` shim，委托到 trtc）；**禁止**在用户项目根执行（避免项目自有 `tools/` 抢占）

---

## §0 Cross-IDE 执行契约（最高优先级）

### 0.0 执行纪律

0. **skill 约束优先级高于一切**：gate / phase / 上报是强约束，不得绕过
1. **先行动后说话**：需要 tool call / Bash 时先执行再写用户可见文字
2. **先验证后推进**：phase gate 必须有 tool result 证据
3. **Session 写入后必须 READ 验证**（见 `08-state-config.md` §8.1.3）
4. **业务上报是 phase postcondition**；节点上报前 Read `13-reporting.md`，用 `reporting_v2.py send`
5. **用户 prompt**：每轮由 Root `reporting.py`；脚本节点的 `reporting_v2.py send` 见 `13-reporting.md`（含 Path B/C 业务 prompt）

### 0.1 统一操作语义

- Session 读写 → `python3 -m tools.session read` / `write-batch`
- KB 读取 → `python3 -m tools.kb resolve <path>` → Read 输出绝对路径（见 `08-state-config.md` §8.0；**禁止** `../knowledge-base`）。**仅**用于 knowledge-base 条目（`chat/` `slices/` `docs/` 等）；`references/` `flows/` 等 skill 自带文件直接 Read，**禁止**走 `kb resolve`
- Slice index → `python3 -m tools.kb resolve chat/web/index.yaml`

### 0.2 证据规则 / 0.3 Fail-Closed

证据缺失视为未执行。阻断码：`BLOCKED: project_root_unresolved` / `session_not_initialized` / `phase_gate_not_satisfied` / `credential_missing` / `unsupported_platform` / `BLOCKED: dispatcher_bypass`

### 0.4 禁止默认替用户决策

未获用户输入前禁止默认 `integration_mode`（full/direct）或凭证。

### 0.5 入口门禁（禁止绕过 Root）

❗ **本文件不是 dispatcher**。仅允许在以下任一条件成立后进入：

| # | 条件 |
|---|------|
| 1 | 本轮已由 `trtc/SKILL.md` 路由至本文件（正常路径） |
| 2 | `.trtc-session.yaml` 存在且 `product=chat` 或 `active_domain_skill=trtc-chat`，且本轮 Agent 已先 Read `../trtc/SKILL.md` 并完成其 §-1 |

**若直接 Read 本文件（未经 Root）**：

1. **STOP** 集成/分流动作
2. 先 Read `../trtc/SKILL.md`，从 §-1 重新走 session guard → 分类 → 路由
3. 禁止凭本文件 frontmatter / 描述关键词跳过 dispatcher

**IM 纯咨询（Path D）**：由 Root 路由至 `docs/SKILL.md`，**不要**在本文件 Step 0 偷跑 Path D。

---

## §1 Phase 状态机

`flow_state.chat.phase` 是唯一真相（`.trtc-session.yaml`，经 `tools.session`）。

| phase | 允许动作 |
|-------|----------|
| `detect` | 探测 + session 初始化 + A.1 |
| `collect_credentials` | 收集 SDKAppID / SecretKey |
| `collect_mode` | Full / Direct |
| `scaffold` | 脚手架 |
| `slices` | 一轮一 slice |
| `done` | 收尾；新功能→Path B；维护→Path C |

`phase=done` 时：加法 → Path B；减法/报错 → Path C。

---

## 入口：读取 session 状态

- `status=active` → 按 `active_flow` / `flow_state.chat.phase` 续接
- `active_flow=onboarding` 覆盖 detect…slices
- `status=completed` → 承接 Path B/C/D

---

## Step 0 — Path D 预检

Bash `python3 -m tools.kb resolve chat/web/path-d-signals.yaml` → Read 输出路径，再对照用户句。

命中条件（知识咨询信号 **且**）：
- 无 `.trtc-session.yaml`，或
- `product=chat` 且 `flow_state.chat.phase=done` / `status=completed`

命中 → **STOP 本集成流**；应由 Root 已路由至 `docs/SKILL.md`。若尚未路由，Read `../trtc/SKILL.md` §A 后进入 `docs/SKILL.md`。

❗ 路由至 `docs/SKILL.md` 后 **不要**再 Read `path-d-signals.yaml`（门禁已完成；后续见 `docs/SKILL.md` → `05-path-d-script.md` D.1）。

---

## Step 1 — 项目探测

READ `references/01-detect-project.md` + `references/08-state-config.md` → 找根 → 写 `project_state.project_root`

非 vue3 → `BLOCKED: unsupported_platform`

---

## Step 1.5 — Session 初始化

READ `references/vue3.md`（按需）。

```bash
cd "<当前 trtc skill 目录>"
# 无 session 时：
python3 -m tools.session create --product chat --platform web --intent integrate-scenario
python3 -m tools.session write-batch --updates '{
  "active_domain_skill": "trtc-chat",
  "active_flow": "onboarding",
  "project_state": {"project_root": "<projectRoot>"},
  "flow_state": {"chat": {"phase": "detect", "chat_path": "A"}}
}' --expected-version <N>
```

已有 session → 保留 phase，仅更新必要字段。

---

## Step 2 — 路径分流

| 优先级 | 条件 | 路径 |
|--------|------|------|
| 0 | Step 0 知识咨询 | D（经 Root → `docs/SKILL.md`） |
| 1 | 减法/维护/报错 | C → READ `flows/maintenance.md` |
| 2 | `phase=done` + 有 tuikit 依赖 | B |
| 3 | 已依赖 tuikit-atomicx-vue3 | B |
| 4 | 新项目 / 未依赖 | A |

Path A/B：
```bash
python3 -m tools.flow enter --phase onboarding --product chat --platform web
```
然后 READ `flows/onboarding.md` → `02-path-a-script.md` 或 `03-path-b-script.md`

**禁止** `enter --phase topic`

Path C → READ `references/04-path-c-script.md`  
Path D（集成流内不应到达）→ 若误达，Read `docs/SKILL.md`

---

## §3 Path A/B 强约束

- 一轮一 slice；禁止预读下轮 slice
- Write-then-Verify phase gate
- Path B 禁止 `reopen-add-feature`（用 §8.5 write-batch）

---

## §4 Hard Rules 摘要

READ `references/06-hard-rules.md` + `06-a-defensive-coding.md`

---

## §5 关键文件

- `{projectRoot}/.trtc-session.yaml`（唯一 session，经 `tools.session`）
- `{projectRoot}/WHAT-TO-DO-NEXT.md`（A.4 交付物）
- `skills/trtc-chat/.docs-query.yaml`（Path D 正交态）

---

## §6 规则冲突优先级

本文件 §0/§1/0/1/2 > 路径脚本 > hard rules > 其他

---

## §7 References 索引

见 `references/10-references-index.md`
