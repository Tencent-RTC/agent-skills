---
name: trtc-call
description: >
  Guides users through integrating TRTC Call (TUICallKit) into a Flutter app or a
  native iOS (Swift, CocoaPods) app — 1v1 audio/video call, group call, or embedding
  a call button into an existing IM chat page. Use when the user wants to add
  real-time calling to a Flutter or native iOS app — "接入通话", "1v1 音视频",
  "视频通话", "语音通话", "TUICallKit", "拨号",
  "呼叫", "来电", "客服外呼", "IM 聊天页加通话按钮", "integrate call",
  "add calling", "video call", "voice call", "ringing", "callkit".
metadata:
  version: 1.1.5
---

# trtc-call — Call 集成域 dispatcher

**调用入口**：本文件由 `trtc/SKILL.md` 在 `product = call` 时 Read。支持 Flutter 与 iOS 原生（Swift）；
其他平台走 `trtc-docs`。

**iOS 原生**：Step 0 命中 iOS 原生工程、或 Step 1 读到 session `platform = ios` 时，改读
`platforms/ios/ROUTER.md`，后续流程全部以 `platforms/ios/` 下的文件为准，**不得使用本目录下 Flutter 的
`flows/`、`playbooks/`、`templates/`、`tools/`**。

**Python tools**：`python3 -m tools.*` 命令必须从 trtc 域 skill 根目录执行
（例如先 `cd "<当前 trtc skill 目录>"`）。

**路径解析**：`<当前 trtc skill 目录>` = trtc 域 skill 根目录（含 `tools/session.py` 的那个目录）。
`<trtc-call skill 目录>` = trtc-call skill 根目录（与 trtc skill 同 parent，含 `tools/verify_embed_in_app.py`）。
路径映射规则与 trtc SKILL.md 的 Hard Boundary / IDE 路径映射表一致，禁止硬编码 `.claude/`。

**Session 写入**：所有 session 字段写入必须用两步 CAS：先 `read --field state_version` 取
版本号 N，再 `write-batch --updates '{...}' --expected-version N`；exit 3 重读重试一次。
详细协议见 `flows/basic-call.md` §Session 写入规约。

**Reporting boundary**：Root/host bootstrap 统一处理本轮 Prompt、路由和隐私提示；若直接进入且本轮尚未尝试前台 Prompt 入口，才按 Root §-1 补一次。动态澄清前保留 `context --question`，固定候选项仍必须用 `AskUserQuestion`。普通失败继续业务流程；不得调用旧 MCP 或独立 `send`。收到 `TRTC_REPORTING_NOTICE_REQUIRED_V1` 时按 Root 的首次可见消息边界，先在对话中原样展示 `<当前 trtc skill 目录>/runtime/continuation-notice.md` 的对应语言文案，并结束当前回合等待用户回复；同意或拒绝保存成功后按 Root 恢复原任务，不能在展示后继续交接、业务提问或调用业务工具；不等整套接入/审批完成，不等 Host Stop，同轮已展示则不在最终回答重复。沿用 Root §-1 的本轮前台入口和最终 owner `invoke`，不因交接重复调用。

---

## Step 0 — 平台检查

**前置**：先读 `{project_root}/.trtc-session.yaml`。若 `status = active` → 跳过 Step 0，直接进 Step 1。

**例外（只针对 iOS，其余情况行为不变）**：session 是 `active`，但 `platform` 与 `active_flow` 都为空（根分发器刚收集完 SDKAppID、还没进入任何 flow）时，**不跳过** Step 0，照常扫描。扫描结果：
- 命中 `ios-native` / `flutter-ios-subdir` → 按下面对应分支处理（写 `platform = ios` 时保留已有 `sdkappid`，不要 reset）。
- 命中 `flutter`，或 `react-native` / `android-native` / `dart-only` / `unknown` → 回到原行为：视为已有活跃 session，**跳过 Step 0 的确认提问**，直接进 Step 1（Flutter 不会多弹一次"是否集成通话"）。

在处理 intent 之前，确认用户项目平台。

**扫描特征文件**（按顺序，找到即停）：

| 检测条件 | 推断平台 |
|---|---|
| `pubspec.yaml` 存在且含 `sdk: flutter` 或 `flutter:` | `flutter` ✅ 支持 |
| `pubspec.yaml` 存在但无 flutter 字样 | `dart-only`（非 Flutter 项目） |
| `package.json` 存在且含 `react-native` | `react-native` |
| `build.gradle` / `settings.gradle` 存在（无 pubspec.yaml） | `android-native` |
| 无 pubspec.yaml，但 `Flutter/Generated.xcconfig` 存在，或 `Podfile`（忽略注释行）含 `flutter_install_all_ios_pods` | `flutter-ios-subdir`（Flutter 项目的 `ios/` 子目录，**必须排在下一行之前**） |
| `.xcodeproj` / `Podfile` 存在（无 pubspec.yaml） | `ios-native` ✅ 支持（Swift / CocoaPods） |
| 以上均未命中 | `unknown` |

**按扫描结果确认**（`AskUserQuestion`，用扫描依据做确认语）：

- **命中 flutter-ios-subdir**：不写 session、不进入任何流程，直接告知并 STOP：

  > 我看到当前打开的是 Flutter 项目的 `ios` 子目录（检测到 `<命中的特征>`）。Flutter 项目的通话集成要把项目路径切换到 Flutter 项目根目录（含 `pubspec.yaml` 的那一层），不能在 `ios` 子目录里按原生 iOS 接入。请切换项目路径后再来找我。

- **命中 ios-native**：

  > 我看到你的项目是 iOS 原生工程（检测到 `.xcodeproj`）。你要在这个项目里集成通话能力吗？
  - ① 是，就是这个项目 → 写 `platform = ios`，Read `platforms/ios/ROUTER.md`，STOP（后续全部走 iOS 流程）
  - ② 不是，我想用另一个项目 → 提示用户切换到正确项目目录后重试，STOP

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

- **命中其他平台（react-native / android-native / dart-only）**：

  `AskUserQuestion` 单选：

  > 我看到你的项目是 `<platform>`，目前引导式代码集成仅支持 Flutter。你想怎么做？

  | # | label | 动作 |
  |---|---|---|
  | 1 | 我有 Flutter 项目，切换目录再来 | 提示用户切换到 Flutter 项目目录后重试，STOP |
  | 2 | 先跑个 demo 看看效果 | 写 `form = demo-experience` + `active_flow = demo-experience`，Read `flows/demo-experience.md`，STOP |
  | 3 | 查 `<platform>` 的接入文档 | 路由到 `../trtc-docs/SKILL.md`，STOP |

- **platform = unknown**（找不到特征文件）：
  > 我没有在当前目录找到项目文件来判断平台。你要接入的项目是 Flutter 还是 iOS 原生（Swift）？
  - ① 是 Flutter → 进入 Step 1（按 flutter 处理）
  - ② 是 iOS 原生 → 提示用户切换到含 `.xcodeproj` 的项目目录后重试，STOP
  - ③ 都不是 → 路由到 `../trtc-docs/SKILL.md`，STOP

**已有活跃 session 时跳过 Step 0**——见上方前置说明（`platform` 与 `active_flow` 都为空时的 iOS 例外除外）。

---

## Step 1 — 读 session 分派

Read `{project_root}/.trtc-session.yaml`：

**iOS 优先判断**：session 存在且 `platform = ios`（不论 `status` 是 `active` 还是 `completed`）→ Read
`platforms/ios/ROUTER.md`，STOP。**此规则优先于下表所有行**，下表全部是 Flutter 的路由。

| session 状态 | 动作 |
|---|---|
| `status = active` 且 `active_flow = basic-call` | Read `flows/basic-call.md` 续接对应 Phase，STOP |
| `status = active` 且 `active_flow = demo-experience` | Read `flows/demo-experience.md`，STOP |
| `status = active` 且 `active_flow = slice-adding`、`active_slice ∈ {call/floating-window, floating-window}` | Read `../../../knowledge-base/slices/call/flutter/floating-window.md`，STOP；短 ID 仅用于兼容旧 session |
| `status = active` 且 `active_flow = slice-adding`、`active_slice ∈ {call/call-observer, call-observer}` | Read `../../../knowledge-base/slices/call/flutter/call-observer.md`，STOP；短 ID 仅用于兼容旧 session |
| `status = active` 且 `active_flow = slice-adding`、`active_slice ∈ {call/login-recovery, login-recovery}` | Read `../../../knowledge-base/slices/call/flutter/login-recovery.md`，STOP；短 ID 仅用于兼容旧 session |
| `status = active` 且 `active_flow = slice-adding`、`active_slice ∈ {call/device-control, device-control}` | Read `../../../knowledge-base/slices/call/flutter/device-control.md`，STOP；短 ID 仅用于兼容旧 session |
| `status = active` 且 `active_flow = slice-adding`、`active_slice ∈ {call/call-invitation, call-invitation}` | 告知"通话中追加邀请的 UIKit 内置按钮仅 IM 群聊场景（chatGroupId 非空）；临时多人通话需自建按钮调 `CallStore.shared.invite`。详见 optional-tweaks 的 call-invitation 节"，写 `active_flow = playbook-done` + `active_slice = null`，STOP |
| `status = active` 且 `active_flow = slice-adding`、`active_slice ∈ {call/group-call, group-call}` | Read `../../../knowledge-base/slices/call/flutter/group-call.md`，STOP；短 ID 仅用于兼容旧 session |
| `status = active` 且 `active_flow = slice-adding`、`active_slice ∈ {call/virtual-background, virtual-background}` | 告知"Flutter Call 虚拟背景在 tencent_calls_uikit 5.0.0 未提供 UI（enableVirtualBackground 为占位接口）；底层能力在 rtc_room_engine 的 TUICallEngine.setBlurBackground/setVirtualBackground，需自绘 UI + 模型文件 + 套餐。详见 slice 文档"，写 `active_flow = playbook-done` + `active_slice = null`，STOP |
| `status = active` 且 `active_flow = slice-adding`、其他 `active_slice` | Read `playbooks/capability-catalog.md`：命中(AI降噪/云端录制/美颜/虚拟背景)则按其类别应对；未命中才告知"该能力当前暂不支持"+原因。写 `active_flow = playbook-done` + `active_slice = null`，STOP |
| `status = active` 且 `active_flow = waiting-run-result` | Read `flows/basic-call.md` §Phase 7.5（运行结果分支），STOP |
| `status = active` 且 `active_flow = playbook-done` | Read `flows/basic-call.md` §Phase 7.6（微调 + P1 slice 菜单），STOP |
| `status = active` 且 `active_flow = troubleshoot` | Read `flows/troubleshoot.md` 续接排查，STOP |
| `status = active` 且 `active_flow` 为空（根分发器刚收集完 SDKAppID、还没进入任何 flow） | **不 reset**，保留已有的 `sdkappid` 等字段，直接进 Step 2 |
| `status = active` 且 `active_flow` 非空、但不在以上已知值 | 告知"上次集成进度遇到了一点异常，我来帮你重置一下重新开始"；先 `read --field sdkappid` 和 `--field sdkappid_state` 记下当前值；执行 `(cd "<当前 trtc skill 目录>" && python3 -m tools.session reset --project-root "<用户项目根目录>")`；reset 只是把旧文件改名备份，**此时 session 不存在**，必须先 `create --project-root "<用户项目根目录>" --intent integrate-scenario`，再用 `write-batch` 写回 `sdkappid`（JSON 整数）和 `sdkappid_state`（让用户不必重新输入；`create` 不接受 `--sdkappid` 参数）；之后进入 Step 2 |
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
9. **不对已知能力一刀切拒绝**：用户明确提到官网「高级功能」(AI降噪/云端录制/美颜/虚拟背景)时，
   查 `playbooks/capability-catalog.md` 按类别应对，禁止直接说「做不了」：
   - `default-on`（AI降噪）→ 告知已默认生效，无需集成；
   - `stackable`（云端录制）→ 走「说明控制台前置 → 等用户开通回填 → 帮加参数」；
   - `relayer`（美颜/虚拟背景）→ **诚实告知这是界面重构级岔路口**（要脱离 UIKit 自建通话页），
     拿到用户明确确认再给 engine API + 方向；不下场代写整套自建通话页。
   只有 catalog 未登记的能力才可回落「暂不支持」+ 说明原因。
