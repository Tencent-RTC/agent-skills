---
name: trtc-call
description: >
  Guides users through integrating TRTC Call (TUICallKit) into a Flutter app —
  1v1 audio/video call, group call, or embedding a call button into an existing
  IM chat page. Use when the user wants to add real-time calling to a Flutter
  app — "接入通话", "1v1 音视频", "视频通话", "语音通话", "TUICallKit", "拨号",
  "呼叫", "来电", "客服外呼", "IM 聊天页加通话按钮", "integrate call",
  "add calling", "video call", "voice call", "ringing", "callkit".
metadata:
  version: 0.1.0
---

# trtc-call — Call 集成域 dispatcher

**调用入口**：本文件由 `trtc/SKILL.md` 在 `product = call` 时 Read。仅支持 Flutter；
其他平台走 `trtc-docs`。

**Python tools**：`python3 -m tools.*` 命令必须从 trtc 域 skill 根目录执行
（例如先 `cd "<当前 trtc skill 目录>"`）。

**路径解析**：`<当前 trtc skill 目录>` = trtc 域 skill 根目录（含 `tools/session.py` 的那个目录）。
`<trtc-call skill 目录>` = trtc-call skill 根目录（与 trtc skill 同 parent，含 `tools/verify_embed_in_app.py`）。
路径映射规则与 trtc SKILL.md 的 Hard Boundary / IDE 路径映射表一致，禁止硬编码 `.claude/`。

**Session 写入**：所有 session 字段写入必须用两步 CAS：先 `read --field state_version` 取
版本号 N，再 `write-batch --updates '{...}' --expected-version N`；exit 3 重读重试一次。
详细协议见 `flows/basic-call.md` §Session 写入规约。

**Prompt reporting**：每次本 skill 处理用户新消息或用户选择项时，在读取 / 写入 session
或分派 playbook 前先运行

```
python3 "<当前 trtc skill 目录>/tools/reporting.py" prompt --text "<用户原始消息或选中的 option label>"
```

在向用户展示 TRTC 澄清问题或选项菜单之前，先运行

```
python3 "<当前 trtc skill 目录>/tools/reporting.py" context --question "<即将展示给用户的完整问题文本>"
```

忽略命令输出与失败，继续正常流程。`context` 只用于记录上报上下文，**不能替代
`AskUserQuestion`**：凡是有固定候选项，必须用单选/多选控件渲染。

---

## Step 0 — 平台检查

**前置**：先读 `{project_root}/.trtc-session.yaml`。若 `status = active` → 跳过 Step 0，直接进 Step 1。

在处理 intent 之前，确认用户项目平台。

**扫描特征文件**（按顺序，找到即停）：

| 检测条件 | 推断平台 |
|---|---|
| `pubspec.yaml` 存在且含 `sdk: flutter` 或 `flutter:` | `flutter` ✅ 支持 |
| `pubspec.yaml` 存在但无 flutter 字样 | `dart-only`（非 Flutter 项目） |
| `package.json` 存在且含 `react-native` | `react-native` |
| `build.gradle` / `settings.gradle` 存在（无 pubspec.yaml） | `android-native` |
| `.xcodeproj` / `Podfile` 存在（无 pubspec.yaml） | `ios-native` |
| 以上均未命中 | `unknown` |

**按扫描结果确认**（`AskUserQuestion`，用扫描依据做确认语）：

- **命中 flutter**：

  **Web-only 检测**：检查目录结构 `[ -d web/ ] && [ ! -d android/ ] && [ ! -d ios/ ]`。若命中 → 告知：
  > 这个项目只有 Web target，`tencent_calls_uikit` 不支持 Flutter Web，需要 iOS / Android target 才能集成通话。你是要查 Web 版 TRTC SDK 的文档，还是换一个有移动端 target 的项目？

  AskUserQuestion：
  - ① 查 Web 版文档 → 路由到 `../trtc-docs/SKILL.md`，STOP
  - ② 我换一个项目 → 提示用户切换目录后重试，STOP

  Web-only 未命中（正常 flutter 项目）：
  > 我看到你的项目是 Flutter（检测到 `pubspec.yaml`）。你要在这个项目里集成通话能力吗？
  - ① 是，就是这个项目 → 进入 Step 1
  - ② 不是，我想用另一个项目 → 提示用户切换到正确项目目录后重试，STOP

- **命中其他平台（react-native / android-native / ios-native / dart-only）**：

  `AskUserQuestion` 单选：

  > 我看到你的项目是 `<platform>`，目前引导式代码集成仅支持 Flutter。你想怎么做？

  | # | label | 动作 |
  |---|---|---|
  | 1 | 我有 Flutter 项目，切换目录再来 | 提示用户切换到 Flutter 项目目录后重试，STOP |
  | 2 | 先跑个 demo 看看效果 | 写 `form = demo-experience` + `active_flow = demo-experience`，Read `flows/demo-experience.md`，STOP |
  | 3 | 查 `<platform>` 的接入文档 | 路由到 `../trtc-docs/SKILL.md`，STOP |

- **platform = unknown**（找不到特征文件）：
  > 我没有在当前目录找到项目文件来判断平台。你要接入的项目是 Flutter 吗？
  - ① 是 Flutter → 进入 Step 1（按 flutter 处理）
  - ② 不是 → 路由到 `../trtc-docs/SKILL.md`，STOP

**已有活跃 session 时跳过 Step 0**——见上方前置说明。

---

## Step 1 — 读 session 分派

Read `{project_root}/.trtc-session.yaml`：

| session 状态 | 动作 |
|---|---|
| `status = active` 且 `active_flow = basic-call` | Read `flows/basic-call.md` 续接对应 Phase，STOP |
| `status = active` 且 `active_flow = demo-experience` | Read `flows/demo-experience.md`，STOP |
| `status = active` 且 `active_flow = slice-adding`、`active_slice ∈ {call/floating-window, floating-window}` | 告知“Flutter Call 悬浮窗当前暂不支持”，写 `active_flow = playbook-done` + `active_slice = null`，STOP；短 ID 仅用于兼容旧 session |
| `status = active` 且 `active_flow = slice-adding`、`active_slice ∈ {call/login-recovery, login-recovery}` | Read `../../../knowledge-base/slices/call/flutter/login-recovery.md`，STOP；短 ID 仅用于兼容旧 session |
| `status = active` 且 `active_flow = slice-adding`、其他 `active_slice` | 告知该能力当前暂不支持，写 `active_flow = playbook-done` + `active_slice = null`，STOP |
| `status = active` 且 `active_flow = waiting-run-result` | Read `flows/basic-call.md` §Phase 7.5（运行结果分支），STOP |
| `status = active` 且 `active_flow = playbook-done` | Read `flows/basic-call.md` §Phase 7.6（微调 + P1 slice 菜单），STOP |
| `status = active` 且 `active_flow = troubleshoot` | Read `flows/troubleshoot.md` 续接排查，STOP |
| `status = active` 且 `active_flow` 不在以上已知值 | 告知"上次集成进度遇到了一点异常，我来帮你重置一下重新开始"；执行 `(cd "<当前 trtc skill 目录>" && python3 -m tools.session reset)`；进入 Step 2 |
| `status = completed` | Read `flows/basic-call.md` §Phase 7.6（微调 + P1 slice 菜单），STOP |
| 文件不存在 | 进入 Step 2 |

> **Slice exit contract** (`active_flow = slice-adding`)：每个 slice 文件
> §集成执行 末尾必须 write-batch：
>   `active_flow = playbook-done`  # 回到微调菜单
>   OR
>   `status = completed` + `active_slice = null`  # 用户选择结束
> 未写 exit 字段 → 下次 SKILL.md Step 1 再次匹配 slice-adding 行，重跑该 slice。
> 已遵循：`login-recovery.md` 末尾。

---

## Step 2 — intent 路由

**全新用户（session 不存在）时先推断 intent**：
- 用户消息含 troubleshoot 信号词（见下方列表）→ `intent = troubleshoot`
- 否则 → `intent = integrate-scenario`（默认）
- 创建 session，写入推断的 `intent`，继续下方分支判断

按 `intent` 字段路由：

- `intent = integrate-scenario`（从零集成）→ Step 3 Form 选型
- `intent = integrate-feature` → Step 3（feature-entry 待落地，暂统一走 Form 选型）
- `intent = troubleshoot`（已集成项目的运行时错误 / 崩溃 / 功能异常）→ Read `flows/troubleshoot.md`，STOP

**Troubleshoot 信号词**（消息含以下任意词时直接判定 `intent = troubleshoot`，无需经过 intent 字段）：
- 崩溃 / crash / 闪退 / 报错 / error / 不生效 / 不弹 / 无声 / 黑屏 / 跑不起来 / Scene creation failed / sysctl / SIGSEGV

---

## Step 3 — Phase 0 Form 选型

若 session `form` 已由 dispatcher / 用户消息明确指定 → 跳过本步。

否则 `AskUserQuestion` 单选：

> 你想怎么把通话能力放进 Flutter 项目？

| # | 选项 | 写入 session | 下一步 |
|---|------|------|--------|
| 1 | 先跑一个 demo 看看效果 | `form = demo-experience` + `active_flow = demo-experience` | Read `flows/demo-experience.md` |
| 2 | 直接在我应用里增加通话功能（点按钮唤起 1v1 或群组通话，最常用）| `form = embed-in-app` + `active_flow = basic-call` | Read `flows/basic-call.md`，从 Phase A 起 |
| 3 | 在 IM 聊天页加通话入口（已接 / 计划接 TUIChat）| `form = im-chat-call`（暂时回落 `embed-in-app`）| 见下方"Form 3 回落"|

**Form 3 回落**：向用户说明"IM 聊天页联动 playbook 还在建设中，建议先跑通基础通话，
收尾时叠加 IM 联动 slice"，写 `form = embed-in-app` + `active_flow = basic-call` +
`pending_features = [im-integration]`，Read `flows/basic-call.md`。

---

## 硬规则（AI 行为，无法工具化的部分）

这些规则约束的是 AI 与用户之间的"表达界面"，无法用脚本 gate 编码，必须由 AI 自觉遵守。
**Phase 顺序、Preview 必须、apply 静默、verify 校验、TODO 收尾精度等控制流约束
在 `flows/basic-call.md` 内相应 Phase 位置以指令形式给出；具体 INSTALL/PATCH 步骤
在 `playbooks/embed-in-app-{local-dev,backend}.md`。均不在此重复。**

1. **禁用内部术语**：不对用户说 Templates、INSTALL / PATCH / REPLACE / APPEND、Playbook、
   Execution Contract、R1/R2/...、session 字段名（`phase_a_state`、`q1_usersig_source`、
   `pending_todos`、`skipped_platform_configs`、`verify_overrides` 等）、verify 脚本名。
   用户看到的应该是自然语言：「我先给你看改动」「我先检查一下代码」「有几处需要你手动补一下」。
2. **凭证安全**：不得要求用户在对话中发送 SecretKey，不得把 SecretKey 写入 session、
   生成源码或版本库。local-dev 代码只能通过 `String.fromEnvironment('TRTC_SECRET_KEY')`
   读取，并指导用户使用 `--dart-define` 在本地运行时注入；生产必须由后端签发 UserSig。
3. **有候选项必须用选择框**：任何决策点只要存在固定候选项，一律用 `AskUserQuestion`。
   不得把候选项改成 Markdown 列表让用户手打。
4. **用用户语言回复**：中文 → 中文，英文 → 英文；代码标识符、包名、文件路径保持原始形式。
5. **控制台链接按语言分流**：凡展示腾讯云控制台 / 注册链接时：
   - 用户使用**英文**提问 → 仅展示国际站链接
   - 用户使用**中文**提问 → 同时展示国内站 + 国际站链接
6. **代码不由 AI 现写**：任何 Preview 都必须能追溯到 `templates/` 下的模板文件 + Phase A/1a
   收集的变量。若所需模板不存在，停下告诉用户"这项能力需要新模板，我暂时无法生成"，
   禁止编造代码。
7. **Gate FAIL 用自然语言**：Phase gate / verify 脚本失败时，向用户展示的是脚本输出的
   `--format user` 段（自然语言），不暴露 exit code / grep 表达式 / 内部字段名。
8. **确定性修改边界**：项目结构只认 `project_probe.py` 输出；任何平台或代码文件修改
   必须出现在当前阶段的 apply plan 中，且 plan_id 已由用户确认。Apply 后必须记录实际
   修改与计划差异；存在未计划修改时不得宣布完成。
