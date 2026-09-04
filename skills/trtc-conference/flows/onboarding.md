# Conference Onboarding Flow

> **调用方**：`trtc-conference/SKILL.md` 在 headless 路径下 Read 本文件。
>
> **职责**：
> - `integrate-scenario`：写 coverage_decided；仅 1v1 路径同时写 confirmed_plan 全集 → 移交 topic（`integration_path = topic`）
> - `integrate-feature`：功能搜索（写 confirmed_plan + coverage_decided=true）→ 移交 topic（`integration_path = topic`）
>
> **支持范围**：Conference Web onboarding 已支持 Vue3 与 React 项目。官方 RoomKit 路径会在
> 后续 playbook/topic 阶段根据项目 `package.json` 或用户明确选择生成对应框架代码：
> React 使用 `@tencentcloud/roomkit-web-react` / `tuikit-atomicx-react`，Vue3 使用
> `@tencentcloud/roomkit-web-vue3` / `tuikit-atomicx-vue3`。onboarding 只负责场景与能力覆盖决策，
> 不得把 React 项目降级为“不支持”或强制改成 Vue3。
>
> **Session 副作用**：进入时执行
> ```bash
> python3 -m tools.flow enter --phase onboarding --product conference --platform web [--scenario <id>]
> ```
> 这会写入 `active_flow = onboarding` 并清空 `flow_state`。

> **Reporting boundary**：本 flow 不执行独立 Prompt、invoke 或 send。Root/Host 已负责本轮记录和路由；若直接进入且 Host 未记录，才补一次 stdin Prompt。动态澄清前保留 `context --question`，固定候选项仍使用 `AskUserQuestion`。普通失败继续业务流程，notice 由 Host Stop 展示 `runtime/continuation-notice.md`。

## Session 写协议

本文件内所有 session 写入都必须走 `tools.session` CLI，不得直接编辑 `.trtc-session.yaml`。
执行 `python3 -m tools.*` 时必须从当前 `trtc` skill 根目录执行，不要依赖客户项目根目录
存在 `tools/` 包。

统一写法：

```bash
# 1. 先读取当前版本号
python3 -m tools.session read --field state_version --with-version
# 返回示例：
# state_version: 12

# 2. 把上一步读到的版本号替换到 <N>，再执行 write / write-batch
python3 -m tools.session write-batch \
  --updates '{"coverage_decided": true}' \
  --expected-version <N>
```

规则：
- `read --field state_version --with-version` 后，用返回的最新 `state_version` 替换命令里的 `<N>`；不要把 `<N>` 当字面值。
- 若 `write` / `write-batch` 返回 **exit code 3**（CAS 冲突），立即重新执行一次 `read --field state_version --with-version` 取最新版本，然后按同一 payload **重试一次**。
- 第二次仍返回 **exit code 3** 时，停止自动写入并告知用户当前 session 被并发修改，需要先收敛到单一操作链路。
- `write-batch` 的 `--updates` 必须是合法 JSON object；推荐外层单引号、内层双引号，避免转义错误。
- `reset` 是破坏性操作。执行前必须先用自然语言明确告知用户“即将清空当前 session 并重新开始”，再运行命令。

---

## 入口检查

**integrate-feature 路径专属**：若 session `status = completed`，先检查执行队列状态：

- 若 `execution_queue` 存在且 `current_execution_state = all_done`：
  **自动**执行以下命令，把已完成的 topic session 归一化为新的 add-feature 会话（对用户不可见，不要提及"执行队列"或"清理"等内部细节）：
  ```bash
  python3 -m tools.session reopen-add-feature
  ```
  该命令会统一把 `status` 切回 `active`、进入 `active_flow = onboarding`，并清空上一轮 topic 的 `execution_queue/current_execution_* / completed_steps / confirmed_plan` 等执行态字段。完成后继续本文件的 integrate-feature 路径。

- 若 `execution_queue` 不存在或 `current_execution_state` 不是 `all_done`：
  直接问用户：

  > 上次的集成已经完成了。你是想：
  > ① 继续在这个项目里加新功能
  > ② 开始一个新的集成

  - 选 ① → 继续本文件
  - 选 ② → 先明确告知用户“即将清空当前 session 并重新开始”，然后执行：
    ```bash
    python3 -m tools.session reset
    ```
    完成后由 dispatcher 重新评估当前会话上下文；必要时先 `tools.session create` 重建 session，再重新走 `trtc-conference/SKILL.md` 入口

---

## 路径一：integrate-scenario

### Step 1：确定 coverage ownership

读取 session 的 `active_scenario`，找到对应的场景文件：
- `1v1-video-consultation` → `../../../knowledge-base/scenarios/conference/medical/1v1-video-consultation.md`
- `general-conference` → `../../../knowledge-base/scenarios/conference/base/general-conference.md`
- 其他场景 → `../../../knowledge-base/scenarios/conference/` 下对应路径

读取场景文件 frontmatter 的 `slices` 字段，并按场景类型通过 `tools.session write-batch` 写入 coverage ownership：

```yaml
coverage_decided: true | false
confirmed_plan:
  - conference/login-auth
  - conference/room-lifecycle
  # ...仅在 coverage 已定时写入
```

**规则**：
- **1v1-video-consultation**：slice 集合固定，无可选项。写入：
  ```bash
  # 1. 读取当前版本
  python3 -m tools.session read --field state_version --with-version

  # 2. 用上一步读到的 <N> 执行写入
  python3 -m tools.session write-batch \
    --updates '{"coverage_decided": true, "confirmed_plan": <场景文件 slices 全集 JSON array>}' \
    --expected-version <N>
  ```
  然后直接移交 topic。topic 不再重复问 coverage，但仍需继续业务决策收集。
- **general-conference**：onboarding **不写 confirmed_plan**，只写：
  ```bash
  # 1. 读取当前版本
  python3 -m tools.session read --field state_version --with-version

  # 2. 用上一步读到的 <N> 执行写入
  python3 -m tools.session write-batch \
    --updates '{"active_scenario": "general-conference", "coverage_decided": false}' \
    --expected-version <N>
  ```
  骨架 vs 可选模块的 coverage 选择由 topic Step 1.5 负责；topic 选完后再写 confirmed_plan。
- **无 active_scenario**（4-C 路径）：先通过 `tools.session write-batch` 写入：
  ```bash
  # 1. 读取当前版本
  python3 -m tools.session read --field state_version --with-version

  # 2. 用上一步读到的 <N> 执行写入
  python3 -m tools.session write-batch \
    --updates '{"active_scenario": "general-conference", "coverage_decided": false}' \
    --expected-version <N>
  ```
  这表示本轮按通用会议场景处理，但 coverage 尚未决策，topic Step 1.5 必须执行。

`coverage_decided` 是 coverage ownership 的唯一显式标记：
- `true` → confirmed_plan 已经定稿，topic Step 1.5 不得重新问 coverage
- `false` → coverage 尚未决策，topic Step 1.5 必须先完成 coverage 选择
- `null` / 缺失 → legacy 非法态；topic 必须 fail-closed，而不是根据 confirmed_plan 猜

---

### Step 2：移交 topic

coverage ownership 写完后，执行：

```bash
python3 -m tools.flow enter --phase topic --product conference --platform web
```

这会将 `active_flow` 更新为 `topic`，并把 conference topic phase 权威源
`skills/trtc-conference/flows/topic.md` 加载到上下文。后续按该文件继续，不要回到 onboarding 覆盖 topic phase 的 owner-level 规则。

topic 侧职责：
- Step 1.5 只负责 coverage 决策（仅当 `coverage_decided = false`）
- Step 1.6 统一负责 business_decisions 收集（无论 `coverage_decided` 是 true 还是 false）

可选：若 `coverage_decided = true` 且 `confirmed_plan` 超过 5 个 slice，展示简短摘要：

> 好的，接下来按以下顺序集成 {N} 个功能模块：
> {按 delivery_unit 分组的 confirmed_plan 列表}

---

## topic Step 1.6 约定（conference handoff 契约）

当 topic 拿到最终 `confirmed_plan` 后，必须执行统一的 business_decisions 收集；onboarding 不再负责这一步。具体算法、分组规则、`depends_on` / `destructive_subset` / `multi_select` 的处理方式，以 `topic.md` 的 Step 1.6 为准。

---

## 路径二：integrate-feature

### Step 1：功能搜索

读取 session 的 `target_features`：

- **已有值**（dispatcher Stage 0 已推断）：展示推断结果，AskUserQuestion 单选确认或修改
- **为空**：让用户描述想加的功能，调用 `python3 -m tools.search slices --product conference --query "<用户描述>" --platform web`

处理 search 返回（契约来自 `python3 -m tools.search slices` 的 JSON 返回）：

| 返回状态 | 处理 |
|---------|------|
| `matched`，1 个候选 | 直接用该 slice，告知用户（如"找到了：屏幕分享"）|
| `matched`，多个候选 | 展示各候选的标题和描述，让用户选择 |
| `no_match` | 告知 KB 无匹配，改用 `../../trtc-docs/SKILL.md` |
| `no_slice` | 同 `no_match`，告知该产品 KB 暂无 slice，改用 docs |
| `status_planned` | 展示 index 层描述，告知内容尚未完成；提供两个 fallback：① 改用最近似的已有 slice，② 改用 docs |
| `ambiguous_product` | 展示 `ambiguous_candidates`，问用户确认是哪个产品，带确认结果重新调用 search |

确认 slice 后通过 `tools.session write-batch` 写入：

```bash
# 1. 读取当前版本
python3 -m tools.session read --field state_version --with-version

# 2. 用上一步读到的 <N> 执行写入
python3 -m tools.session write-batch \
  --updates '{"coverage_decided": true, "confirmed_plan": ["<用户确认后的 slice>"]}' \
  --expected-version <N>
```

### Step 2：移交 topic

同路径一的 Step 2。integrate-feature 的 business_decisions 也由 topic Step 1.6 统一收集；由于此时 `coverage_decided = true`，topic Step 1.5 不会再问 coverage。
