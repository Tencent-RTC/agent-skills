# 08 - Session 与状态配置（Schema v2）

> Chat 集成**唯一**状态文件：`{projectRoot}/.trtc-session.yaml`  
> 读写**必须**经 `python3 -m tools.session`（cwd 为 `skills/trtc` 或 `skills/trtc-chat`；后者 `tools/` 为 shim，实现仍在 `skills/trtc/tools/`）。**禁止**直接 Write/Edit `.trtc-session.yaml`。

Path D 咨询态使用 `skills/trtc-chat/.docs-query.yaml`（与 session 正交，不经 `tools.session`）。

### §8.0 knowledge-base 读取（`tools.kb`，禁止 `../`）

安装后 `knowledge-base/` 与 `skills/` 同级（如 `.codebuddy/knowledge-base` + `.codebuddy/skills`）。  
❗ **禁止**在 reference 里写 `../knowledge-base` 或心算相对深度。

**唯一方式**（cwd 为 `skills/trtc` **或** `skills/trtc-chat` 均可；二者均有 `tools/` shim，委托到 `skills/trtc/tools/`）：

```bash
# 任选其一 cwd（推荐 trtc-chat：与 domain skill 同目录）
cd "<当前 trtc-chat skill 目录>"
python3 -m tools.kb resolve chat/web/index.yaml          # 打印绝对路径 → 再 Read
python3 -m tools.kb read docs/chat/gen-usersig.md        # 小文件可直接 stdout（可选）
python3 -m tools.kb exists slices/chat/web/style-guide.md # 存在性检查（exit 0/1）
```

**实现与 shim**：`kb` / `session` / `flow` / `reporting_v2` 的**唯一实现**在 `skills/trtc/tools/`；`skills/trtc-chat/tools/` 为 shim（委托，非副本）。reference 内继续写 `python3 -m tools.kb`，**不要**改写成硬编码路径。

`resolve` 的 `<path>` 是 **knowledge-base 内部相对路径**（不含 `knowledge-base/` 前缀），第一段必须是 `chat/` `slices/` `docs/` `scenarios/` `tooling/` 之一。

❗ **`tools.kb` 只解析 knowledge-base 条目**。skill 自带文件——`references/*.md`、`flows/*.md`、skill 目录下的 `*.yaml`——**不在 knowledge-base 里**；cwd 已是 skill 目录，直接 Read 即可，**禁止**走 `kb resolve`（否则解析成 `knowledge-base/references/...` 必然 not found，且 `&&` 串联时会中断后续命令）。

| | 示例 |
|--|------|
| ❌ | `python3 -m tools.kb resolve references/08-state-config.md`（references 是 skill 本地文件） |
| ✅ | 直接 `read_file references/08-state-config.md` |

| 用途 | `resolve` 路径 |
|------|----------------|
| Chat slice index | `chat/web/index.yaml` |
| Path D 信号词 | `chat/web/path-d-signals.yaml` |
| Slice 正文 | `slices/chat/web/<name>.md`（如 `login-auth.md`） |
| UserSig / debug | `docs/chat/gen-usersig.md` / `docs/chat/debug/` |
| Path D URL 数据 | `docs/chat/product.md` / `docs/chat/sdk/{platform}/index.md` 等 |

拷贝目录示例：`cp -r "$(python3 -m tools.kb resolve docs/chat/debug)" "<projectRoot>/public/debug/"`

## §8.1 找根算法（保留源 skill §8.1.1）

1. 从用户当前工作目录向上查找含 `package.json` 的目录
2. 若 monorepo：优先含 `tuikit-atomicx-vue3` 依赖的子包
3. 结果写入 `project_state.project_root`

---

## §8.1.2 Session 创建与初始化

```bash
cd "<当前 trtc skill 目录>"
python3 -m tools.session create --product chat --platform web --intent integrate-scenario
python3 -m tools.session write-batch \
  --updates '{
    "active_domain_skill": "trtc-chat",
    "active_flow": "onboarding",
    "project_state": {"project_root": "<projectRoot>"},
    "flow_state": {"chat": {"phase": "detect", "chat_path": "A"}}
  }' \
  --expected-version <N>
```

---

## §8.1.3 Write-then-Verify（CAS）

```bash
python3 -m tools.session read --field state_version --with-version
python3 -m tools.session write-batch --updates '{...}' --expected-version <N>
python3 -m tools.session read --field flow_state.chat.phase
```

- exit code **3** → 重读 version，**重试一次**
- 第二次仍 3 → 停止，告知 session 并发冲突

---

## §8.2 集成自检清单（Review / §9.7）

| 项 | 检查 |
|----|------|
| login-auth | `base_slices_applied` 含 `chat/login-auth` |
| 消息区 | 含 `chat/message-list` + `chat/message-input` |
| Full 模式 | 含 `chat/conversation-list` |
| UserSig | 生产不用前端 SecretKey；debug 仅 `public/debug/` |
| ephemeral | `secret_key_ephemeral` 在 scaffold 后为空 |
| 交付物 | `{projectRoot}/WHAT-TO-DO-NEXT.md` 存在 |
| unsupported | `unsupported_intents` 为空或已口头收尾 |

---

## §三 Schema v2 字段契约

### 顶层

| 字段 | Chat 取值 |
|------|-----------|
| `session_id` | 创建时生成 |
| `product` | `chat` |
| `platform` | `web` |
| `status` | `active` \| `completed` |
| `intent` | `integrate-scenario` \| `integrate-feature` \| `troubleshoot` \| `lookup` |
| `active_domain_skill` | `trtc-chat` |
| `active_flow` | `onboarding` \| `maintenance` \| `docs` |
| `credentials.sdkappid` | 用户提供的 SDKAppID |
| `project_state.project_root` | 找根结果 |

### `session_context.chat`

| 字段 | 说明 |
|------|------|
| `integration_mode` | `full` \| `direct` |
| `base_slices_applied` | 已完成 base slice id 列表（`chat/` 前缀） |
| `extension_slices_applied` | 扩展 slice |
| `unsupported_intents` | A.1.5 未支持意图 |
| `changes` | 变更记录 |
| `reusable_components` | 可复用组件 |
| `project_detect.css_scheme` | tailwind 等 |
| `project_detect.ui_library` | element-plus 等 |
| `project_detect.sdk_version` | package.json 版本 |
| `usersig.secret_key_ephemeral` | A.2 临时 SecretKey；scaffold 后必须 null |
| `integration.first_prompt_ephemeral` | A.1.5 首句；A.2 上报后清空 |
| `integration.pending_unsupported_ephemeral` | 可选瞬态 |

### `flow_state.chat`

| 字段 | 说明 |
|------|------|
| `phase` | `detect` → `collect_credentials` → `collect_mode` → `scaffold` → `slices` → `done` |
| `chat_path` | `A` \| `B` \| `C` |

---

## §8.3 Phase ↔ active_flow

| phase | status | active_flow |
|-------|--------|-------------|
| detect … slices | active | onboarding |
| done | completed | — |
| Path C | active/completed | maintenance（可选） |
| Path D | 任意 | docs |

---

## §8.4 SecretKey Ephemeral

| 阶段 | 动作 |
|------|------|
| A.2 | 写入 `session_context.chat.usersig.secret_key_ephemeral` |
| A.3 scaffold | 拷贝 debug 资产 → 设 ephemeral 为 null |
| 后续 | READ 验证 ephemeral 不存在 |

---

## §8.5 Path B Reopen（禁止 `reopen-add-feature`）

**禁止** `python3 -m tools.session reopen-add-feature`。

跨 turn 加功能（`status=completed`）：

```bash
python3 -m tools.session write-batch --updates '{
  "status": "active",
  "intent": "integrate-feature",
  "active_flow": "onboarding",
  "flow_state": {"chat": {"phase": "slices", "chat_path": "B"}}
}' --expected-version <N>
```

**不变量**：`base_slices_applied` / `extension_slices_applied` / `integration_mode` / `project_detect` 不得清空。

---

## §8.6 flow enter 幂等

```bash
python3 -m tools.flow enter --phase onboarding --product chat --platform web
PHASE=$(python3 -m tools.session read --field flow_state.chat.phase)
# 仅当 phase 为空/null 时补写 detect
```

---

## §8.7 交付物

- `{projectRoot}/WHAT-TO-DO-NEXT.md`（项目根，非隐藏 skill 状态目录）
- `{projectRoot}/.trtc-session.yaml`（唯一 session）

---

## §8.8 Path D — `.docs-query.yaml`（与 Session 正交）

> 路径：`skills/trtc-chat/.docs-query.yaml`（与 `SKILL.md` 同目录）。  
> Schema 与源 chat-skills Path D helper 文件 **一致**；**无** `framework` 字段（`framework` 由 `13-reporting.md` 按 `platform` / `types` 推导）。

| 字段 | 类型 | 说明 |
|------|------|------|
| `sessionId` | string | **D.0a-i 写入一次**后永久保留；同 Path D 会话多问题共享；有 `.trtc-session.yaml` 时优先用其 `session_id`，否则生成 `sess_*`；**install 不预填** |
| `sessionStartedAt` | number | D.0a-i 写入；Unix 时间戳 |
| `platform` | string | D.2 写入；`web` \| `android` \| `ios` \| `android+ios` \| `flutter` \| `uniapp` \| `vue3` \| `react` \| `miniprogram` \| `""` |
| `types` | string[] | D.1 写入；`product` \| `restapi` \| `webhook` \| `uikit` \| `sdk` \| `troubleshooting` |
| `sdkappid` | number \| null | D.3 写入；跳过为 `0`；未问为 `null` |
| `lastPrompt` | string | D.4 步骤 1 写入；用户原文（截取前 300 字） |
| `lastAnswer` | string | D.4 完成轮 Bash 前写入；与 content 逐字一致（含 D.5 引导）；多行用 YAML `\|` 块 |

**规则**：

| 规则 | 说明 |
|------|------|
| 正交 | Path D 字段**不**写入 `.trtc-session.yaml` |
| sessionId 一次写入 | 仅 D.0a-i；install 拷贝模板 `sessionId: ""`；多轮 Path D 问题共享同一 id |
| D.0a 禁止复制 session platform | 集成态 session 多为 `web`；Path D 须 **重置 `platform: ""`**，由 D.2 按用户句重写 |
| 双端对比 | 用户同时问 Android **与** iOS（如 Native Chat UIKit 原生组件形态）→ `platform: "android+ios"`；D.4d 须分别 Read 两端 uikit index |
| 读写 | 直接 Read/Write YAML（**不经** `tools.session`） |
| Patch-Write | 见 `05-path-d-script.md` §字段驻留守卫：每步只改声明字段；`sdkappid: 0` 不得降级为 `null` |

**模板**：

```yaml
sessionId: ""
sessionStartedAt: 0
platform: ""
types: []
sdkappid: null
lastPrompt: ""
lastAnswer: ""
```
