# platforms/ios/ROUTER.md — iOS 原生 Call 路由

> **调用入口**：`trtc-call/SKILL.md` 在 Step 0 命中 iOS 原生工程，或 Step 1 读到 session `platform = ios` 时 Read 本文件。
> 本文件**只做路由**，具体流程在 `flows/basic-call.md`。
>
> **本文件不是独立 skill**：没有 frontmatter，不得被当作 skill 入口单独触发。

**路径解析**：`<trtc-call skill 目录>` 同 `trtc-call/SKILL.md`；本目录 = `<trtc-call skill 目录>/platforms/ios/`。

**当前 iOS 范围**：只有 `embed-in-app` 形态的基础接入（Podfile / 权限 / 本地调试配置 / 登录 / 呼叫）。
**不支持**：demo-experience、P1 slice（悬浮窗 / 呼叫观察 / 设备控制 / 群呼等）、VoIP Push + CallKit、SwiftUI 专项适配、SPM。
用户要这些时，如实告知"iOS 暂未支持"，不得照搬 Flutter 的 slice 文档。

---

## 路由表

读 `{project_root}/.trtc-session.yaml`：

| session 状态 | 动作 |
|---|---|
| 文件不存在（`read` 报错或 exit 1/2），或 `status ∉ {active, completed}` | **文件不存在时先创建**：`(cd "<当前 trtc skill 目录>" && python3 -m tools.session create --project-root "<用户项目根目录>" --product call --platform ios --intent integrate-scenario)`；然后写 `product = call`、`platform = ios`、`form = embed-in-app`、`active_flow = basic-call`、`current_phase = phaseA`，Read `flows/basic-call.md` §Phase A，STOP |
| `status = active` 且 `active_flow` 为空（根分发器刚收集完 SDKAppID、还没进入任何 flow） | **不 reset，保留已有的 `sdkappid` 等字段**：写 `product = call`、`platform = ios`、`form = embed-in-app`、`active_flow = basic-call`、`current_phase = phaseA`，Read `flows/basic-call.md` §Phase A，STOP |
| `status = active` 且 `active_flow = basic-call` | Read `flows/basic-call.md`，按下表「续接位置」跳到 `current_phase` 对应 Phase |
| `status = active` 且 `active_flow = waiting-run-result` | Read `flows/basic-call.md` §7.5（运行结果分支），STOP |
| `status = active` 且 `active_flow = troubleshoot` | 视同 `waiting-run-result`：Read `flows/basic-call.md` §7.5，STOP（iOS 没有独立 troubleshoot flow，排查走 `playbooks/integration-reference.md` 的错误码速查） |
| `status = active` 且 `active_flow = playbook-done`，或 `status = completed` | Read `flows/basic-call.md` §Phase 8（收尾 + 微调菜单），STOP |
| `status = active` 且 `active_flow ∈ {demo-experience, slice-adding}` | 告知"iOS 的体验 demo 与追加能力（悬浮窗、群呼、设备控制等）目前还没有引导式支持，可以先看官方文档"，路由到 `../../../trtc-docs/SKILL.md`，STOP（**不改 session**，避免把没集成过的工程标成已完成） |
| `status = active` 且 `active_flow` 非空、但不在以上已知值 | 告知"上次集成进度遇到了一点异常，我来帮你重置一下重新开始"；先记下当前 `sdkappid`，执行 `(cd "<当前 trtc skill 目录>" && python3 -m tools.session reset --project-root "<用户项目根目录>")`，再按第一行处理，并把记下的 `sdkappid` 写回（让用户不必重新输入） |

> 本文件和 `flows/basic-call.md` 里所有 `tools.session` 命令都要带 `--project-root "<用户项目根目录>"`（与 `trtc/SKILL.md` 的 Session 例外一致），避免 session 被写到 skill 安装目录。
>
> **注意**：`--project-root` 现在按**精确目录**使用，不再向上寻找标记；但仍要防参数写错或旧版 `tools.session`。`create` 之后检查它输出的 `path:`，必须等于 `<用户项目根目录>/.trtc-session.yaml`；不等于时**停下**，告知用户 session 会写到别处（给出该路径），建议先在工程目录 `git init` 或创建 `Podfile` 后再来，不要继续；同一次集成内 `--project-root` 必须保持不变。

### 续接位置（`active_flow = basic-call` 时按 `current_phase`）

| `current_phase` | 续接到 |
|---|---|
| 缺省 / `phaseA` | Phase A |
| `phase1` | Phase 1 |
| `phase2` | Phase 2 |
| `phase3` | Phase 3（重跑 Phase 2 探测后再展示改动，因为用户可能已手动改过工程） |
| `phase4` | Phase 3（落地中断时重新探测并展示剩余改动，用户确认后继续；幂等步骤会被跳过） |
| `phase5` | Phase 5 |
| `phase6` | Phase 6 |
| `phase7_3` | §7.3 |
| `phase7_5` | §7.5 |

若 `phase3a_blocked` 非空，按原因续接：

| 原因 | 动作 |
|---|---|
| `no-cocoapods`、其它 probe blocker | 重跑 Phase 2 探测；障碍已消除 → 清除该字段（写空串）并进 Phase 3；仍存在 → 再次告知并 STOP |
| `user-declined-podfile`、`user-will-create-podfile` | 重跑 Phase 2 探测；Podfile 已存在 → 清除字段进 Phase 3；仍没有 → 清除字段，直接回到 Phase 3 重新征求"是否帮你创建 Podfile"（用户这次回来就是想继续，不要再 STOP） |
| `backend-usersig-integration-deferred`（`phase1a_blocked`） | 用户回来说要继续 → 清除该字段，回 Phase 1 重新问 Q1 |

---

## 意图

iOS 目前只处理"接入 / 集成通话"类意图。用户问的是 API、错误码、文档类问题（没有要改项目的意思），路由到
`../../../trtc-docs/SKILL.md`；排障类问题（带报错码或日志）先查 `playbooks/integration-reference.md` 的错误码速查。

---

## 不得做的事

- 把 Flutter 的 `flows/basic-call.md`、`playbooks/`、`templates/` 用于 iOS 原生工程。
- 在没有读 `playbooks/integration-reference.md` 的情况下凭记忆回答 iOS 的 API、错误码、版本、权限问题。
- 要求用户在对话里发送 SecretKey。
