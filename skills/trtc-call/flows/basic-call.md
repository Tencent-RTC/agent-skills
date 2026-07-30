# flows/basic-call — AI 运行时流

> **触发条件**：`SKILL.md` Step 3 中 `form = embed-in-app` 时 Read 本文件。
>
> **本文件性质**：AI 运行时 orchestration。用 `AskUserQuestion` / `Read` / `Edit` /
> `Bash` 等工具，按 Phase 顺序推进，STOP 点明确。
>
> **代码来源永远是 `templates/`，指令来源永远是 `playbooks/embed-in-app-<q1>.md`**。
> 本文件不含代码块，不生成代码。

---

## Session 写入规约

**本 flow 所有 session 写入**必须用以下两步 CAS 模式；不得直接编辑 `.trtc-session.yaml`。

**Step 1** — 读当前版本号（每次写之前）：
```bash
(cd "<当前 trtc skill 目录>" && python3 -m tools.session read --field state_version)
# 输出示例: state_version: 3  → 记为 N
```

**Step 2** — 批量写入（单字段也用 write-batch）：
```bash
(cd "<当前 trtc skill 目录>" && python3 -m tools.session write-batch \
  --updates '{"field1": "value1", "field2": "value2"}' \
  --expected-version N)
# exit 0 → 成功
# exit 3 (CONFLICT) → 重回 Step 1 重读，重试一次
# exit 3 再次失败 → 等待约 300ms，第三次重试
# exit 3 第三次仍失败 → AskUserQuestion：
#   ① 帮我重置 session 从头开始（当前进度会丢失）→ 执行 tools.session reset，路由回 SKILL.md Step 1 重新分派（旧变量已失效，不可继续带入）
#   ② 我先手动检查一下 → STOP
# exit 1 (ERROR) → 参数有误，停下排查，不重试
```

**凡本 flow 注释「写 session X = Y」均指上述 write-batch 操作**。  
同一个 Phase 里的多个字段合并成一次 write-batch 调用（一次读版本，一次写），不分多次串行。

---

## 顺序总览

```
Phase A   腾讯云资源前置             AskUserQuestion 3 选 1 + 分支追问
Phase 1a  枚举问卷                    AskUserQuestion（Q1 UserSig 来源 + Q3 媒体类型）
Phase 1b  自动透传                    无问，直接进 Phase 1c
Phase 1c  确定性项目扫描              project probe → platform apply plan
Phase 2a  平台配置分工告知            展示四段 + STOP 等"改完了"
Phase 2b  平台配置 diff Preview       仅展示 platform plan 中 planned 操作 → 确认 → apply → audit
Phase 3a  项目扫描汇报                重跑 probe → code apply plan → 展示结构化结果
Phase 3b  代码 diff Preview           仅展示 code plan 中 planned 操作 → STOP 等"改"
Phase 4   Check gate                  AskUserQuestion 4 选 1
Phase 5   Apply                       仅执行已确认 code plan → audit → 逐文件汇报
Phase 6   Verify                      grep + flutter analyze → 结果自然语言汇报
Phase 7.1 pending_todos               TODO 明细 + skipped 平台文件清单
Phase 7.2 CallButton 放置             扫描候选页 → AskUserQuestion → PATCH 目标文件
Phase 7.3 认证生命周期接入            优先接状态流；否则覆盖登录 / 注册 / 恢复 / 退出；STOP
Phase 7.4 跑起来                      3 步展示 + STOP 等运行结果
Phase 7.5 运行结果分支                跑通 → §7.6；报错 → troubleshoot；先不跑 → §7.6
Phase 7.6 微调 + P1 slice 菜单        等用户选择；完成后 status=completed
```

**顺序硬门**：Phase N 完成前禁止进入 Phase N+1。跨 phase 落盘 = bug。

---

## Phase A — TRTC 资源前置检查

**目的**：确认用户是否已有 TRTC 应用资源。只确认是否具备，不在对话、session 或源码中
收集 SecretKey；local-dev 运行时通过 `--dart-define` 注入。

**短路检测**：若 session `phase_a_state = has-credentials`，或历史 session 已有
`q8_sdk_app_id`（非 null 非 0），直接写 `phase_a_state = has-credentials`，清空
`q9_secret_key`，跳过 A.1–A.4，进入 Phase 1a。

### A.1 主问

`AskUserQuestion` 单选：

> TRTC 集成需要一对凭证：SDKAppID + SecretKey。你现在有 TRTC 应用凭证吗？

| # | label | value | 下一步 |
|---|---|---|---|
| 1 | 已有 —— 稍后在本地运行时注入 | `has-credentials` | A.2 |
| 2 | 还没有 —— 我需要先注册 + 创建应用 | `needs-onboarding` | A.3 |
| 3 | 暂时用占位 —— 保留 TODO | `placeholder-only` | A.4 |

写入 session `phase_a_state = <value>`。

### A.2 分支：已有

写 `phase_a_state = has-credentials`、`q9_secret_key = null`，进入 Phase 1a。不得追问
SDKAppID 或 SecretKey 的具体值；Phase 7 再给出本地 `--dart-define` 运行命令。

### A.3 分支：还没有

展示注册引导：

```
1. 注册 / 登录腾讯云账号
   国内站 → https://cloud.tencent.com/register
   国际站 → https://sc-rp.tencentcloud.com:8106/t/GF

2. 创建 TRTC 应用
   国内站 → https://console.cloud.tencent.com/trtc/app
   国际站 → https://sc-rp.tencentcloud.com:8106/t/GF
   进入应用管理 → 创建应用 → 场景选"音视频通话"

3. 记录凭证：
   - SDKAppID（应用管理页的数字 ID）
   - SecretKey（应用 → 快速上手 → 密钥管理）
```

写 `phase_a_state = needs-onboarding-pending`，`STOP`。

用户下一 turn 回复分支：
- "我拿到了" → 回 A.1
- "卡在第 N 步" → 答疑子分支，完成后回 A.1
- "暂时不注册了" → 走 A.4

### A.4 分支：占位

写 session：
```
phase_a_state = placeholder-only
q8_sdk_app_id = null
q9_secret_key = null
pending_todos += {
  field: "TRTC local-dev runtime config",
  location: "flutter run --dart-define",
  source: "https://sc-rp.tencentcloud.com:8106/t/GF",
  default: "TRTC_SDK_APP_ID=0, TRTC_SECRET_KEY=''"
}
```

告知：

> 好，我先用占位值生成代码。跑起来通话之前你必须完成注册 + 创建应用 + 回填这两个值。
> Phase 7 收尾时会再次列出提示。

进入 Phase 1a。

### Phase A 出口条件

未写入有效 `phase_a_state` 之前禁止进入 Phase 1a。合法出口：`has-credentials` / `placeholder-only`。
`needs-onboarding-pending` 不算出口，需循环回 A.1。

---

## Phase 1a — 枚举问卷

**触发条件**：Phase A 已到有效出口。

一次性 `AskUserQuestion` 发出所有必问 —— 多题一 turn，禁止逐题分 turn。

**Q1 — UserSig 来源**

> 你的项目目前处于哪个阶段？这决定 UserSig（鉴权凭证）的生成方式。

| # | label | value |
|---|---|---|
| 1 | 本地调试 —— 在客户端用 SDKAppID + SecretKey 自动签名，最快跑起来 | `local-dev` |
| 2 | 生产环境 —— 先按官方文档完成服务端 UserSig（当前版本仅提供指引） | `backend` |

写 `q1_usersig_source = <value>`。

**Q1 后处理**：

- q1 = backend 且 `pending_todos` 里存在 `TRTC local-dev runtime config` 项 →
  **移除**该 pending（backend 场景不在客户端注入凭证）。
- q1 = backend → 立即 Read `playbooks/embed-in-app-backend.md`，执行官方文档 handoff，
  写 `phase1a_blocked = backend-usersig-integration-deferred` 后 `STOP`。当前版本禁止继续
  project probe、apply plan 或任何项目修改。

**Q3 — 媒体类型**

> 通话支持哪种媒体形式？

| # | label | value |
|---|---|---|
| 1 | 仅语音 | `audio` |
| 2 | 仅视频 | `video` |
| 3 | 语音和视频都支持 | `both` |

写 `q3_media_type = <value>`。

### Phase 1a 出口条件

local-dev 必须写入 `q1_usersig_source` + `q3_media_type` 两个字段。未收齐禁止进入 Phase 1b。
backend 在完成上述 handoff 后停止，不适用本出口条件。

---

## Phase 1b — 自动透传

`phase_1b_state = skipped`，不向用户展示任何 prompt。直接进入 Phase 1c。

*(basic call 阶段无自由文本追问；SDKAppID/SecretKey 已在 Phase A 收，登录路由归 Phase 3a
主动识别，Q5/Q10 已迁 P1 slice `call/login-recovery`。见 `call-integration/user-input.md`)*

---

## Phase 1c — 确定性 Project Probe 与平台 Apply Plan

在任何项目文件落盘前运行只读扫描：

```bash
python3 "<trtc-call skill 目录>/tools/project_probe.py" \
  --project-root "<用户项目根目录>" \
  --output "<用户项目根目录>/.trtc-call/project-profile.json"
```

必须直接读取 JSON 中的 `app_entry`、`state_management`、`service_directories`、
`platform_config`、`call_entry_candidates`、`existing_call` 和 `blockers`；禁止再由 AI
自行 grep 后凭感觉生成另一份项目结构判断。

- `blockers` 非空：将每条 `message` 转成自然语言告诉用户，写
  `phase3a_blocked = <message>`，`STOP`。禁止进入任何 apply。
- `blockers` 为空：创建平台阶段计划：

```bash
python3 "<trtc-call skill 目录>/tools/apply_plan.py" create \
  --project-root "<用户项目根目录>" \
  --variant "<q1_usersig_source>" \
  --media-type "<q3_media_type>" \
  --phase platform \
  --profile "<用户项目根目录>/.trtc-call/project-profile.json" \
  --output "<用户项目根目录>/.trtc-call/platform-apply-plan.json"
```

写 session：
- `project_profile_path = .trtc-call/project-profile.json`
- `project_profile_id = <profile_id>`
- `platform_apply_plan_path = .trtc-call/platform-apply-plan.json`
- `platform_apply_plan_id = <plan_id>`

进入 Phase 2a。

---

## Phase 2a — 平台配置分工告知

**目的**：TUICallKit 有几处 native 配置 AI 改不了（Xcode pbxproj、Podfile 平台版本）。
先告知用户分工，避免 AI 悄悄改动 → 用户 build 报错。

按 `q3_media_type` 分支裁剪展示内容。**`q3 = audio` 时不列相机权限 + 相机 Usage
Description**。

展示四段：

**① Why**

> 我要嵌入通话，需要几处 native 平台配置。有些我能自动改，有些建议你手动改
> ——先跟你说清楚哪些你需要自己动，避免我改了你没发现。

**② AI 能自动改（Phase 2b Preview 再确认）**

按 `q3` 列举：
- `ios/Runner/Info.plist`：追加 `NSMicrophoneUsageDescription`
  - [q3 ∈ {video, both}] 追加 `NSCameraUsageDescription`
- `android/app/src/main/AndroidManifest.xml`：追加 `RECORD_AUDIO` + `INTERNET` 权限
  - [q3 ∈ {video, both}] 追加 `CAMERA` 权限
- `android/app/build.gradle`：确保 `minSdkVersion ≥ 21` + `multiDexEnabled true`

**③ 建议你手动改（AI 会指路，不代改）**

- **`ios/Runner.xcodeproj/project.pbxproj`**（`IPHONEOS_DEPLOYMENT_TARGET` 须 `≥ 14.0`，已有更高版本保持不变）
  - 理由：pbxproj 是 Xcode 专有格式，AI 改容易破坏解析，图形界面 3 秒完成
  - 步骤：打开 `ios/Runner.xcworkspace` → 选 Runner → Build Settings → 搜 "deployment" → **确认全部至少为 14.0**；低于 14.0 才提升，已有更高版本不降级
- **`ios/Podfile`**：确保 `platform :ios` 至少为 `14.0`，已有更高版本保持不变；禁止用 `post_install` 强制覆盖所有 Pods 的 deployment target
  - 完整文本见 `playbooks/integration-reference.md §iOS 配置`（单一来源）
- **改完 Podfile 后必须 `cd ios && pod install`**

**④ 问用户改完了吗**

> 上面②这几处我等下会给你看 diff 再动手；③这几处你先改，改完了告诉我，或者告诉我
> "跳过 X 文件" / "先看看现状"。

`STOP` 等用户回复。

### Phase 2a 分支

| 用户回复 | 动作 |
|---|---|
| "改完了" / "继续" / "跳过" | 进入 Phase 2b |
| "跳过 Podfile" / "跳过 pbxproj" | 写 `skipped_platform_configs += <file>`，进入 Phase 2b |
| "我不知道怎么改" | 进入指导子分支（讲步骤，讲完回 Phase 2a 等回复）|
| "先看看现状" | Read 目标文件 → 报告差异清单 → 回 Phase 2a 等回复 |

未收到明确"继续"信号前禁止进入 Phase 2b。

---

## Phase 2b — 平台配置 diff Preview + apply

读取 `.trtc-call/platform-apply-plan.json`，只处理 `operations[]` 中
`phase = "platform"` 且 `status = "planned"` 的操作。按 `q1_usersig_source` 决定
读取哪份 playbook，以 plan 的 operation id/target 为准提取具体 snippet：
- `q1 = local-dev` → Read `playbooks/embed-in-app-local-dev.md`
- `q1 = backend` 不得进入本阶段；应已在 Phase 1a handoff 后停止

一次性展示每个平台文件的 unified diff（内容来自 `templates/snippets/{android,ios}/*` 文件）。
plan 中 `already-satisfied` / `skipped-by-user` 的操作不展示、不执行。

展示后 `AskUserQuestion`：

> 平台配置这几处 diff 你确认了吗？

| # | label | value |
|---|---|---|
| 1 | 改 | `apply` |
| 2 | 我先自己改，跳过这几处 | `manual-skip` |
| 3 | 有几处不想改 | `partial-skip`（追问具体哪几处）|
| 4 | 取消 | `abort`（回 Phase 2a）|

写 `phase2b_decision = <value>`。

- `apply`：不加 skip 参数，进入下方“重新生成并确认计划”
- `manual-skip`：写 `skipped_platform_configs += <all>`，重新生成 platform plan 时为每个
  目标文件追加 `--skip-platform-file <path>`
- `partial-skip`：`AskUserQuestion` 多选：

  > 哪几个文件你不想让我改？（一个不选 = 全改，等同于"改"）

  | # | 文件 |
  |---|---|
  | 1 | `ios/Runner/Info.plist` |
  | 2 | `android/app/src/main/AndroidManifest.xml` |
  | 3 | `android/app/build.gradle` |

  选中 0 项 → 视同 `apply`，直接落。  
  写 `skipped_platform_configs += <选中项>`，重新生成 platform plan 时为每个选中文件
  追加 `--skip-platform-file <path>`
- `abort`：回 Phase 2a

### 2b.1 重新生成并确认平台计划

按最终 skip 决策重新运行 Phase 1c 的 `apply_plan.py create --phase platform`，保留相同
profile/variant/media-type，并追加所有 `--skip-platform-file`。旧 plan_id 立即失效，
session 更新为新 plan_id。

若新计划仍有 `status = "planned"` 的操作，用户刚才对 diff 的明确选择即作为本阶段确认，
立即运行：

```bash
python3 "<trtc-call skill 目录>/tools/apply_plan.py" approve \
  --plan "<用户项目根目录>/.trtc-call/platform-apply-plan.json" \
  --approved-by user
```

**硬门禁：`approve` 成功必须发生在任何 Edit / Write 之前。** 在
`confirmation.status = "approved"` 且 `approved_plan_id = plan_id` 之前，禁止修改任一
planned target。若误写导致 approve 失败，必须先把所有误写目标恢复到该 plan 的 baseline，
再从 Phase 1c 重新 probe → create → Preview → approve；禁止在误写后的项目上重新 probe，
禁止把原本的 planned 操作转换成 `already-satisfied` / `no-op` 后继续。

approve 失败表示项目在 Preview 后发生变化；必须重跑 Phase 1c 和 Preview，禁止继续写文件。
确认成功后，只执行 plan 中 `planned` 的平台操作并逐文件汇报 `[X/Y] <path> ✔`。

落盘后立即记录实际变化：

```bash
python3 "<trtc-call skill 目录>/tools/apply_plan.py" record \
  --plan "<用户项目根目录>/.trtc-call/platform-apply-plan.json" \
  --output "<用户项目根目录>/.trtc-call/platform-apply-result.json"
```

- `status = matched` → 写 `platform_apply_result_id = <result_id>`，进入 Phase 3a。
- `status = no-op` → 表示该阶段没有 planned 操作且项目未变化；只记录“无需修改”，不得
  表述为执行 apply 后匹配。
- `status = diverged` → 根据 `unplanned` / `planned_but_unchanged` 修正或回滚，重新生成计划；
  未恢复 matched 前禁止进入 Phase 3a。
- 新计划无 planned 操作 → 不调用 approve，直接 record；项目无变化时应为 `no-op`。

---

## Phase 3a — 项目扫描汇报

**目的**：平台阶段结束后重新建立基线，确定 App、路由和代码阶段的精确修改目标。
**不问用户手抄 App 类名 / 路由方案，也不允许 AI 自行推断替代 probe。**

展示时加一句前置说明：
> 我先扫描一下你的项目结构，确认改动方式。

重新运行 `project_probe.py`，覆盖 `.trtc-call/project-profile.json`。随后创建代码阶段计划：

```bash
python3 "<trtc-call skill 目录>/tools/apply_plan.py" create \
  --project-root "<用户项目根目录>" \
  --variant "<q1_usersig_source>" \
  --media-type "<q3_media_type>" \
  --phase code \
  --profile "<用户项目根目录>/.trtc-call/project-profile.json" \
  --output "<用户项目根目录>/.trtc-call/code-apply-plan.json"
```

写 session `project_profile_id`、`code_apply_plan_path` 和 `code_apply_plan_id`。
profile 或 plan 的 `blockers` 非空时 fail-fast，展示自然语言 `message` 并 `STOP`。

从 profile JSON 汇报以下信息（不猜）：

1. 顶层 App Widget 类名 / 类型（StatelessWidget / StatefulWidget） / 已有构造函数参数
2. MaterialApp 变体（MaterialApp / MaterialApp.router / CupertinoApp / 其他） +
   已有 `localizationsDelegates` / `supportedLocales` / `navigatorObservers` 项
3. 路由方案（Navigator 命名路由 / GoRouter / AutoRoute / 自建）
4. **登录路由推断**（按优先级）：
   - `routes:` 里命中 `/login` / `/auth` / `/signin` 等常见模式 → 用该路由
   - 只有一个非首页命名路由 → 展示该路由让用户确认
   - GoRouter / AutoRoute → 不问路由名（basic call 阶段用不到）
   - 都识别不到 → **fallback 追问**：用户手输登录路由名（默认 `/login`）
5. 现有 TRTC 集成状态（`existing_call.status` → none / detected）
6. 状态管理、service 目录和 Call 入口候选（分别来自 `state_management`、
   `service_directories`、`call_entry_candidates`）

**重复执行门禁**：现有状态为 `detected` 时，先运行
`verify_embed_in_app.py --variant <q1> --skip-analyze`：
- 无 FAIL → 写 `phase3a_already_integrated = true`，跳过 Phase 3b–5，直接进 Phase 6
- 有 FAIL → 写 `phase3a_already_integrated = false`，Phase 3b 只展示缺失项，已存在的 import、
  字段、constructor 参数、delegate、observer 和依赖全部跳过
- GoRouter 中 `TUICallKit.navigatorObserver` 已存在一次即视为完成，禁止再次追加

按以下矩阵读取并写 `project_scan.app_entry_variant`：

| 扫描结果 | app_entry_variant | 自动处理 |
|---|---|---|
| `MaterialApp(...)` | `material-app` | 支持：App 内合并 delegates + observers |
| `CupertinoApp(...)` | `cupertino-app` | 支持：App 内合并 delegates + observers |
| `MaterialApp.router` + 唯一 `GoRouter(...)` 定义 | `material-router-go-router` | 支持：App 合并 delegates，GoRouter 合并 observers |
| `MaterialApp.router` + AutoRoute / 自建 RouterConfig | `unsupported-router` | 不自动 patch |
| `CupertinoApp.router` | `unsupported-router` | 不自动 patch |
| 无法唯一定位 App / Router 定义 | `unknown-app-entry` | 不自动 patch |

GoRouter 分支同时写 `project_scan.go_router_config_file = <path>`。
写 `project_scan.<field> = <value>` 全部字段。

展示汇报：

> 扫描到的项目现状：
> - App Widget: `<class_name>` (`<widget_type>`)
> - MaterialApp: `<variant>` (已有 delegates: [`<list>`])
> - 路由: `<scheme>`
> - 自动接入方式: `<App 内注入 / GoRouter 注入 / 需要手动适配>`
> - 登录路由推断: `<推断值 + 依据>`
> - 现有 TRTC 集成: `<none / detected>`
>
> 有问题吗？（回复"没问题"进下一步；或指出哪里不对）

`STOP` 等回复。

分支：
- "没问题" / "继续" → 进入 Phase 3b
- 指出错误 → 修正 session 对应字段后重问
- fallback 登录路由追问 → 写 `q7_login_route = <value>`

**Fail-fast**（对齐 D5）：若 profile 发现用户 main.dart 没抽 App 类、App 构造函数用
位置参数、`app_entry_variant ∈ {unsupported-router, unknown-app-entry}`，或没有受支持的
MaterialApp / CupertinoApp —— 立即告知具体障碍和安全原因，写 session
`phase3a_blocked = <reason>`，`STOP`。禁止把 `navigatorObservers` 添加到
`MaterialApp.router` / `CupertinoApp.router`。

> **Resume 检测**：`active_flow = basic-call` 且 `phase3a_blocked != null` 时，跳过 Phase A–3a 前段，直接重跑 Phase 3a probe；若障碍已修复则清除 `phase3a_blocked`，继续进 Phase 3b；若仍存在则再次告知 + STOP。

---

## Phase 3b — 代码 diff Preview（一次性）

**目的**：把 Phase 5 将要落盘的所有文件的完整 diff 一次性展示。**禁止分批**。

读取 `.trtc-call/code-apply-plan.json`。只展示并执行 `operations[]` 中
`phase = "code"` 且 `status = "planned"` 的操作；`already-satisfied`、
`skipped-by-user` 和 `manual-review` 不得伪装成将要修改的内容。

按 `q1_usersig_source` 决定读哪份 playbook 的**代码段**：
- `q1 = local-dev` → Read `playbooks/embed-in-app-local-dev.md`（标准 App 最多 14 步；GoRouter 最多 16 步）
- `q1 = backend` 不得进入本阶段；当前版本不生成生产 apply plan

对 plan 中每个 `action = install`：Read operation 的 `source` → 生成"新建文件"形态 diff，
**并在文件 diff 标题前加一行用途说明**：

| 文件 | 用途说明 |
|---|---|
| `lib/trtc_call/trtc_call_bootstrap.dart` | TRTC 集成入口，替换 `runApp()` 并向 MaterialApp 注入本地化和路由 observer |
| `lib/trtc_call/call_service.dart` | 用可替换 adapter 封装 SDK 登录和发起通话；生产走 TUICallKit，测试可注入 Fake |
| `lib/trtc_call/call_button.dart` | 可复用 child/icon/style、支持业务 onError 的通话按钮组件 |
| `lib/debug/generate_test_user_sig.dart` | 本地调试专用：用 SDKAppID + SecretKey 在客户端生成临时 UserSig（仅 q1=local-dev）|

对 plan 中每个 PATCH：Read 对应 `templates/snippets/**` snippet 内容 + Phase 3a profile →
生成 unified diff 展示插入位置与内容。

对每个 APPEND：类似，展示追加内容。

**凭证脱敏**（对齐 SKILL.md 硬规则 2）：SecretKey 在 diff 里显示为 `前4****后4`
（例：`3f9f****87fd`），全值只写入实际落盘文件（Phase 5 REPLACE 时）。

展示头部注明：
- 总共 T 个文件（T = planned operation 的唯一 target 数量，禁止使用固定估算）
- 若有 `pending_todos` → 明确说明"这几个 TODO 我用占位值先生成，Phase 7 收尾时会
  再列一次让你填"

`STOP`，进入 Phase 4。

---

## Phase 4 — Check gate

`AskUserQuestion`：

> 上面这 T 个文件的改动 diff 你都过了吗？

| # | label | value | 下一步 |
|---|---|---|---|
| 1 | 改 | `apply-all` | Phase 5 |
| 2 | 只落 X 文件、跳过其他 | `partial-apply` | 追问具体哪些 |
| 3 | 回到 Phase 3 修改内容 | `revise` | 回 Phase 3b（可能连带回 Phase 3a）|
| 4 | 全部取消 | `abort` | 结束本 turn |

写 `phase4_decision = <value>`（+ `phase4_skips` 若 partial）。

未收到 `apply-all` / `partial-apply` 明确回复前禁止调用 `Write` / `Edit`。

- `apply-all`：直接确认当前 `.trtc-call/code-apply-plan.json`。
- `partial-apply`：把用户跳过的 operation id 逐个作为 `--skip-operation <id>`，重新运行
  Phase 3a 的 `apply_plan.py create --phase code`；更新 session 中 plan_id 后再确认。
- `revise`：旧 code plan 作废，回 Phase 3a 重跑 probe + create，不得只改 JSON。

确认命令：

```bash
python3 "<trtc-call skill 目录>/tools/apply_plan.py" approve \
  --plan "<用户项目根目录>/.trtc-call/code-apply-plan.json" \
  --approved-by user
```

approve 失败表示 Preview 后项目或 plan 已变化；必须重跑 Phase 3a–4。只有
`confirmation.status = "approved"` 且 `approved_plan_id = plan_id` 才能进入 Phase 5。

---

## Phase 5 — Apply

**执行策略**：Read 已确认的 `.trtc-call/code-apply-plan.json`，按其中 `status = planned`
的 operation 顺序映射回 q1 playbook 执行；plan 未列出的步骤禁止执行。每步落盘后一次
confirm。

按 `phase4_decision` / `phase4_skips` 严格裁剪。

汇报格式（对齐 SKILL.md 硬规则）：`[N/T] <path> ✔`

`T` = 本次 apply 的总步骤数（每个 INSTALL / PATCH / REPLACE / APPEND 各一条，同一文件多次 PATCH 则多行）；`N` = 当前已完成步骤序号。

**动词到 tool 映射**：
- `INSTALL <src> → <dest>` = `Read <src>` + `Write <dest>` 内容
- `PATCH <target> @ anchor` = `Read <template_snippet>` + `Edit <target>` 在锚点插入/替换
- `REPLACE <target> <placeholder> → <value>` = `Edit <target>` 逐个替换
- `APPEND <target> WITH <snippet>` = 先 `Bash grep` 目标文件确认 snippet 中每个顶层 key 不存在；不存在才 `Read <snippet>` + `Edit <target>` 追加；已存在则跳过该 key 并告知用户"已有 `<key>`，跳过"

**PATCH 定位锚点规则**（严格遵守 playbook 里"步骤补充说明"段）：
- `runApp(...)` 替换：仅处理 `runApp(MyApp())` / `runApp(const MyApp())` 两种形态
- MyApp 构造函数：只处理命名参数形态，位置参数直接 fail-fast
- 标准 App：已有 `localizationsDelegates` / `navigatorObservers` → spread 合并；已有 `supportedLocales` → 保留
- MaterialApp.router + GoRouter：MaterialApp 只合并 delegates；observer 只合并到已确认的 GoRouter 定义
- 每个新增 import、delegate、observer 写入前先检查目标是否已存在；重复执行必须跳过，不得重复追加

落盘完成后：

```bash
cd <project_root> && flutter pub get
```

若失败 → 展示错误 → 询问用户是否重试。

依赖安装完成后立即记录计划与实际修改差异：

```bash
python3 "<trtc-call skill 目录>/tools/apply_plan.py" record \
  --plan "<用户项目根目录>/.trtc-call/code-apply-plan.json" \
  --output "<用户项目根目录>/.trtc-call/code-apply-result.json"
```

- `status = matched` → 写 `code_apply_result_id = <result_id>`，继续 Phase 6。
- `status = no-op` → 只代表 code 阶段无需修改；进入重复集成 verifier，不得宣称已完成
  一次重复 apply。
- `status = diverged` → 根据 `changes.unplanned`、`planned_but_unchanged` 和
  `missing_planned` 修正；重新 probe/create/Preview/confirm 后才能继续。
- 禁止把未计划文件的修改仅口头说明后忽略。

告知：

> 全部落盘完成。我来跑一下代码检查。

进入 Phase 6。

---

## Phase 6 — Verify

调用 `tools/verify_embed_in_app.py` 统一执行：

```bash
python3 "<trtc-call skill 目录>/tools/verify_embed_in_app.py" \
  --project-root "<用户项目根目录>" \
  --variant <q1_usersig_source>          \
  --session "<用户项目根目录>/.trtc-session.yaml" \
  --format json
```

- `--variant` = session 里的 `q1_usersig_source`（`local-dev` 或 `backend`）
- 脚本内部包含文件存在检查 / 关键 API grep / pubspec 依赖验证 / 占位符检测 /
  `flutter analyze` / 平台配置跳过 WARN，无需手动逐条 grep

### 6.1 结果处理

读脚本的 JSON 输出（`summary.fail` / `summary.warn` / `results[]`）：

- `summary.fail == 0` 且 `summary.warn == 0` → 全部 PASS，告知用户
  「基础通话代码已就绪，跑了一遍检查没问题。」→ 进入 Phase 7

- `summary.fail == 0` 且 `summary.warn > 0` → PASS+WARN，告知用户警告条目后进 Phase 7

- `summary.fail > 0` →

  1. 遍历 `results[]`，筛出 `status == "FAIL"` 的条目，取每条的 `title` 字段
  2. 将这些 title 拼成一句话（如："main.dart 缺 TrtcCallBootstrap.run 调用；pubspec.yaml 缺 tencent_calls_uikit 依赖"）
  3. 用该句话替换下方问题里的 `<失败项描述>`，展示 `AskUserQuestion`（**不向用户暴露 JSON、check_id、grep 表达式**）：

  > 有几处需要修一下：`<失败项描述>`。要我修还是先跳过？

| # | label | 动作 |
|---|---|---|
| 1 | 修一下 | AI 尝试修（可能回 Phase 3b 重跑 Preview / Apply） |
| 2 | 跳过这条，继续 | 写 `verify_overrides += <check_id>`，进 Phase 7 |
| 3 | 我自己看看 | 写 `current_phase = phase6`，STOP 等用户 |

**硬门**：`summary.fail > 0` 时禁止自动进入 Phase 7，必须等用户明确选择选项 1 / 2 / 3。

> **Resume 检测**：SKILL.md 路由 `active_flow = basic-call` 时，检查 `current_phase` 字段：
> - `current_phase = phase6` → 跳过 Phase A–5，直接重跑 Phase 6 verify；完成后清除 `current_phase`
> - `current_phase = phase7_3` → 跳过 Phase A–7.2，直接进 §7.3；完成后清除 `current_phase`

### 6.2 脚本不可用时 fallback

以下情况统一处理：写 `verify_overrides += ["verify-unavailable"]`，告知用户「自动检查跑不了，先手动 `flutter analyze` 确认没有报错」，进入 Phase 7。

- 脚本文件不存在 / `python3` 不可用 → 执行失败
- 脚本 exit code = 2 → 脚本内部错误（常见：`--project-root` 路径不存在）
- 脚本 exit code 为其他未定义值 → 未知错误

---

## Phase 7 — Wrap-up

### 7.1 pending_todos 明细

若 session `pending_todos` 非空，逐条展示：

```
📋 你需要后填的 TODO（Phase A 你跳过了这些，现在得填才能跑）：

  1. SDKAppID + SecretKey  [仅 q1=local-dev]
     获取：腾讯云控制台 → 实时音视频（TRTC）→ 应用管理 → 创建/选择应用
     运行：
       flutter run \
         --dart-define=TRTC_SDK_APP_ID=<你的 SDKAppID> \
         --dart-define=TRTC_SECRET_KEY=<你的 SecretKey>
     ⚠️ 仅本地调试，不可上线；生产必须由后端签发 UserSig
```

`skipped_platform_configs` 非空则一并列出：「以下平台文件你跳过了，跑之前需要自己配好：`<清单>`」。

---

### 7.2 CallButton 放置

**目的**：Phase 5 只安装了 `lib/trtc_call/call_button.dart` 组件，本步把它放进用户界面，
否则没有入口发起通话。

**步骤**：

**① 扫描候选页面**

```bash
find <project_root>/lib -name "*.dart" \
  ! -path "*/trtc_call/*" \
  ! -name "*_test.dart"
```

按以下启发式排序（高→低）：
- 文件名含 `home` / `contact` / `chat` / `conversation` / `message` / `user` → 高优先
- 文件名含 `login` / `auth` / `splash` / `onboard` → 排除

对排名靠前的 ≤3 个文件各 Read 一次，确认含 `Scaffold` 后纳入候选。

**② 推荐 + 确认**

`AskUserQuestion` 单选：

> 我找到以下位置可以加通话按钮，选哪里？

| # | label | description |
|---|---|---|
| 候选 1 | `<file_path>` | `<一句话描述，如"首页，含 Scaffold + AppBar">` |
| 候选 2 | `<file_path>` | （若有）|
| 候选 3 | `<file_path>` | （若有）|
| N | 我来指定另一个文件 | 自行输入路径 |

**③ 计算 import 相对路径**

目标文件到 `lib/trtc_call/call_button.dart` 的相对路径。例：
- 目标 = `lib/pages/home_page.dart` → import `'../trtc_call/call_button.dart'`
- 目标 = `lib/home_page.dart` → import `'trtc_call/call_button.dart'`
- 目标 = `lib/pages/chat/detail.dart` → import `'../../trtc_call/call_button.dart'`

**④ 按 `q3_media_type` 选用法示例**（从 `templates/lib/trtc_call/call_button.dart` §用法 读取）：

- `audio` → 单个 `CallButton(mediaType: CallMediaType.audio, icon: Icons.call, ...)`
- `video` → 单个 `CallButton(mediaType: CallMediaType.video, icon: Icons.videocam, ...)`
- `both` → `Row` 包含 audio + video 两个 `CallButton`

`onGetUserId: () async => 'TODO_target_user_id'` 作为占位符。
若目标位置已有按钮视觉，优先复用其 icon/style；业务已有错误展示逻辑时传 `onError`，
不要额外引入页面、状态管理或设计系统。

**⑤ anchor pre-scan + 选插入位置**

先 Read `<target_file>`，检测可用锚点：
- `has_appbar` = 含 `AppBar(` 或 `appBar:`
- `has_appbar_actions` = 上述 AppBar 内已含 `actions:` 数组
- `has_fab` = 含 `floatingActionButton:`
- `has_listtile` = 含 `ListTile(`

`AskUserQuestion` 单选（按检测结果展示可用选项，永不超过 4）：

| # | label | 可用条件 | ⑥ diff 生成规则 |
|---|---|---|---|
| 1 | AppBar 右侧（actions）| `has_appbar = true` | `has_appbar_actions = true` → 追加到现有数组；否则 → 新建 `actions:` 参数 |
| 2 | FloatingActionButton | 始终可用（前提：候选页有 Scaffold，§7.2 ①已保证）| `has_fab = true` → 替换或包 Column 追加；否则 → 新建 `floatingActionButton:` 参数 |
| 3 | 列表项尾部（trailing）| `has_listtile = true` | 定位最靠近页面末尾的 ListTile，替换或追加 `trailing:` |
| 4 | 我来指定具体位置 | 始终显示 | 追问后 AI Read 定位 |

选项 1 / 3 不可用时不展示；选项 2 / 4 始终展示。最大展示数 = 4，天然满足 `maxItems`。

选"我来指定"后追问：
> 你希望按钮加在哪里？（说文字描述，我来 Read 文件找到对应代码位置后给你确认）

AI Read 文件找到用户描述的位置，展示该位置上下文，确认后进 ⑥。

**⑥ mini-Preview + 确认**

展示将要改动的 unified diff（import 行 + widget 插入位置），然后 `AskUserQuestion`：

> 我计划这样加通话按钮，确认吗？

| # | label | 动作 |
|---|---|---|
| 1 | 改 | 执行 Edit，汇报 `已在 <target_file> 加入通话按钮 ✔` |
| 2 | 调整位置 | 追问插入点，重新生成 diff，回到本步 |
| 3 | 我自己加 | 跳过 Edit，告知 CallButton 用法示例位置（`templates/lib/trtc_call/call_button.dart` §用法），继续 §7.3 |

**⑦ 追加 pending_todo**（仅选项 1 / 2 执行后）：

写 session `pending_todos += {field: "target_user_id", location: "<target_file>:<行号>", note: "把 TODO_target_user_id 替换为实际对方 userId"}`

---

### 7.3 认证生命周期接入

**触发**：Phase 7.2 CallButton 放置完成后自动进入。  
**STOP 硬门**：四种场景未全部覆盖、且用户未明确选择 manual 前，禁止进 §7.4。

必须覆盖：首次登录、注册后登录、App 重启后的会话恢复、退出与账号切换。

**代码单一来源**：

| 用途 | 模板 |
|---|---|
| 串行处理重复登录、恢复、退出、切号 | `templates/lib/trtc_call/call_auth_lifecycle.dart` |
| local-dev UserSig provider | `templates/snippets/auth-lifecycle/create-local-dev.dart` |
| backend UserSig | 当前版本仅执行 `playbooks/embed-in-app-backend.md` 官方文档 handoff，不进入本阶段 |
| 同步登录态 | `templates/snippets/auth-lifecycle/sync-user.dart` |
| userId 规范化 | `templates/snippets/auth-lifecycle/sanitize-user-id.dart` |

禁止在多个回调里散落 `loginWithSig()` / `logout()`；所有入口都调用同一个
`CallAuthLifecycle.syncUser()`。

---

#### ① 生命周期扫描

扫描 `lib/**/*.dart`，排除 `lib/trtc_call/**` 与 `*_test.dart`。按类别分别保留最多
3 个候选，禁止全局截断为一个候选：

| 类别 | 信号 |
|---|---|
| 统一认证状态流 | `onAuthStateChange`、`authStateChanges()`、`userChanges()`、`sessionStream`、`authState` |
| 登录成功 | `login`、`signIn`、`loginSuccess`、`handleAuth` |
| 注册后登录 | `register`、`signUp`、`createUser`，并确认成功后是否直接产生 session |
| 会话恢复 | `currentSession`、`currentUser`、`restoreSession`、`initialSession`、启动 auth guard |
| 退出登录 | `signOut`、`logout`、清 token / session 的方法 |

对每个命中 Read 完整函数或 listener body，记录 `<file>:<line>`、类别、nullable
userId 表达式、是否覆盖 initial session、是否能区分 signed-in / signed-out、是否 async。

优先选择同时发出初始状态、登录状态和退出状态的 listener（`unified-listener`）。
找不到时使用 `multi-hook`，分别选择登录 / 注册 / 恢复 / 退出目标。注册最终必经已选
登录方法时可记为 `covered-by-login`，但必须有 Read 到的调用证据。

已有代码短路必须同时满足：存在 `CallAuthLifecycle`、所有入口均调用 `syncUser()`、
覆盖表四项全为 true。满足时写 `phase7_3_auth_decision = already-done` 和四项
`phase7_3_auth_coverage = true` 后进 §7.4；只发现一个 `loginWithSig()` 不得短路。

---

#### ② 策略确认

若存在合格统一 listener，`AskUserQuestion`：

> 我找到一个统一的登录状态监听，可以同时处理登录、注册后的登录、重启恢复和退出。按这个位置接入吗？

| # | label | 动作 |
|---|---|---|
| 1 | 用统一状态监听（推荐） | 选 `unified-listener` + top candidate |
| 2 | 看其他状态监听 | 展示其余 ≤2 个候选 |
| 3 | 分别接入各个登录 / 退出方法 | 选 `multi-hook` |
| 4 | 我自己处理 | 进 ⑤ manual |

若无合格统一 listener，直接进入 `multi-hook`，按“登录 → 注册 → 恢复 → 退出”顺序，
每类各用一次 `AskUserQuestion` 选择候选或“我来指定”。缺少任一必需类别时转 ⑤，
不得把缺口当成已完成。

写 session：

```yaml
phase7_3_auth_decision: assist-insert
phase7_3_auth_strategy: unified-listener | multi-hook
phase7_3_auth_targets:
  unified: <file:line> | null
  login: <file:line> | null
  registration: <file:line> | covered-by-login | null
  restore: <file:line> | covered-by-unified | null
  logout: <file:line> | covered-by-unified | null
```

---

#### ③ 收集接入表达式

对每个选中目标，从已 Read 的完整上下文提取“当前用户 ID 或 null”的表达式：

- 已登录 / 注册 / 恢复：`String?` userId；拿不到用户时必须为 `null`
- 退出：固定传 `null`
- 统一 listener：同一个表达式必须同时表达 signed-in 与 signed-out

无法可靠推断时用普通对话一次性询问所有缺失表达式。用户说“不知道 / 不确定”则转
⑤ manual，禁止猜字段名。

按 `q1_usersig_source` 选择 provider：

- `local-dev`：Read `create-local-dev.dart`，使用 `GenerateTestUserSig.genTestSig`
- `backend`：当前版本不得进入 Phase 7.3；应已在 Phase 1a 提供官方文档并停止。

若 userId 可能包含 `@`、`.`、空格或其他非法字符，`AskUserQuestion` 是否规范化。
选择规范化时 Read `sanitize-user-id.dart`，把 `safeUserIdFrom` 作为
`normalizeUserId` 传给唯一的 `CallAuthLifecycle` 实例；否则删除
`__OPTIONAL_USER_ID_NORMALIZER__` 整行。

**Supabase 用户 ID 特殊规则（必须执行，不得跳过）**：
若 probe 检测到 `supabase_flutter` 在依赖中，Supabase 用户 ID 是 UUID v4（36 字符含连字符），
**超过 TRTC 32 字节上限**，接入前必须规范化：
- Read `sanitize-user-id.dart`，以 `supabaseUserIdToTrtc` 作为 `normalizeUserId`。
- `CallButton.onGetUserId` 中的目标用户 ID 也必须同样规范化：`user.id.replaceAll('-', '')`。
- 不允许跳过或 AskUserQuestion——UUID 长度不符合 TRTC 约束，规范化是硬要求。

---

#### ④ 一次性 Preview + Apply

先 Read 所有目标文件和模板，生成一份完整 unified diff，必须同时包含：

1. INSTALL `call_auth_lifecycle.dart` 到 `lib/trtc_call/`
2. 在认证服务或 App 级长生命周期对象中创建**唯一一个** `CallAuthLifecycle` 实例
3. 按策略在所有选中目标调用 `await callAuthLifecycle.syncUser(...)`
4. 必需 imports，以及可选的 `safeUserIdFrom`

**策略规则**：

- `unified-listener`：listener 必须覆盖首次发出的 initial session；若其 stream 不发初始值，
  还要在已选 restore target 补一次 `syncUser(currentUserIdOrNull)`
- unified listener 无法 `await` 时，必须用 `unawaited(syncUser(...).catchError(...))` 或等价
  错误收口；错误处理必须记录或展示失败，并在登录成功前禁用 Call 入口。
  禁止 `.catchError((_) {})` 这类静默吞错，也禁止产生未处理 Future error
- `multi-hook`：登录、注册、恢复传对应 nullable userId；退出在清业务 session 前调用
  `syncUser(null)`；若注册已证实调用登录方法，不重复插入
- 退出必须保证业务 session 最终仍被清除；推荐在 `try/finally` 中先同步 Call logout，
  finally 执行业务 signOut
- 非 `async` 回调优先改成 `async`；若框架签名不允许 async，改用返回的 Future 链或转
  ⑤ manual，不得静默丢弃 Future
- 账号切换不额外写业务分支，由 `CallAuthLifecycle` 串行执行 logout → login

展示覆盖表：

| 场景 | 目标 | 覆盖方式 |
|---|---|---|
| 首次登录 | `<file:line>` | `<unified / hook>` |
| 注册后登录 | `<file:line / covered-by-login>` | `<方式>` |
| 重启恢复 | `<file:line / covered-by-unified>` | `<方式>` |
| 退出 / 切号 | `<file:line / covered-by-unified>` | `<方式>` |

`AskUserQuestion` 单选：

| # | label | 动作 |
|---|---|---|
| 1 | 应用全部修改 | 按 diff 一次性 Edit / Write |
| 2 | 调整位置或字段 | 回 ② / ③，重新生成完整 diff |
| 3 | 我自己处理 | 转 ⑤ manual |

**未收到 1 号回复前禁止 Edit / Write。**

Apply 后立即重新 Read / grep，以下检查全部通过才可进 §7.4：

- `lib/trtc_call/call_auth_lifecycle.dart` 存在
- 全项目只有一个 `CallAuthLifecycle(` 实例（模板类声明不计）
- 每个已选目标都出现 `syncUser`
- 覆盖表四项均为 true
- 不允许在 `lib/trtc_call/**` 外直接调用 `CallService.instance.loginWithSig` / `logout`
- 认证 listener 不得使用 `.catchError((_) {})` 静默吞掉 Call 登录失败
- Call 登录完成前，业务入口必须禁用，且 `CallService.startCall/startGroupCall` 必须 fail-fast
- provider 返回空 UserSig、SDKAppID 未配置、provider 失败后，后续 `syncUser` 必须仍可恢复
- backend 当前版本不得产生认证生命周期代码或声称生产接入完成
- `flutter analyze --no-pub` 退出码为 0；否则展示错误并 STOP

写 session：

```yaml
phase7_3_auth_coverage:
  login: true
  registration: true
  restore: true
  logout: true
```

清除旧的 `pending_todos` 中 `field = "loginWithSig call-site"` 项以及
`current_phase = phase7_3`，进入 §7.4。

---

#### ⑤ manual

展示 `call_auth_lifecycle.dart`、对应 q1 的 create snippet、`sync-user.dart` 和可选
sanitize snippet，并明确列出四个必须接入的位置。写 session：

```yaml
phase7_3_auth_decision: manual
phase7_3_auth_coverage:
  login: false
  registration: false
  restore: false
  logout: false
pending_todos += {
  field: "auth lifecycle",
  location: "登录 / 注册 / 会话恢复 / 退出",
  note: "四条路径必须统一调用 CallAuthLifecycle.syncUser；未完成前可能无法通话或残留旧账号会话"
}
```

用户明确选择 manual 后允许进 §7.4，但汇报时必须标记“认证生命周期待用户完成”，不得说
集成已全部完成。

---

#### ⑥ Resume（troubleshoot 返回 -1002）

troubleshoot.md T1 命中 `-1002 errSdkNotInitialized` 且 session
`phase7_3_auth_decision ∈ {manual, already-done}` 时：

`AskUserQuestion`：要我重新扫描登录、注册、会话恢复和退出四条路径并统一接入吗？

| # | label | 动作 |
|---|---|---|
| 1 | 是，重新扫描并接入 | 写 `current_phase = phase7_3` + `active_flow = basic-call`，Read `flows/basic-call.md` §7.3 从 ① 起 |
| 2 | 不用，我来 | 走标准 troubleshoot 分层排查 |

---

### 7.4 跑起来

**禁止 AI 自己执行 `flutter run`**——只展示步骤，用户在终端自行运行。

```
1. 填入上面的 TODO（如有）
2. flutter pub get
3. flutter run
```

写 session `active_flow = waiting-run-result`，`STOP` 等用户反馈运行结果。

---

### 7.5 运行结果分支

**触发**：SKILL.md Step 1 中 `active_flow = waiting-run-result` 路由到此。

按用户消息分支：

| 用户信号 | 动作 |
|---|---|
| "跑通了" / "可以打电话了" / "成功" / "好了" | 写 `active_flow = playbook-done`，进 §7.6 |
| "报错" / "崩溃" / "闪退" / "不行" / 粘贴错误日志 | 写 `troubleshoot_return_flow = playbook-done` + `active_flow = troubleshoot`，Read `flows/troubleshoot.md`，STOP |
| "先不跑了" / "等会儿再试" / 询问微调 | 写 `active_flow = playbook-done`，进 §7.6 |
| 其他消息 | 回复一句让用户先跑一下，等下一条消息再判断 |

---

### 7.6 微调 + P1 slice 菜单

**触发**：SKILL.md Step 1 中 `active_flow = playbook-done` 路由到此；或 §7.5 分支命中后内联进入。

展示：

```
────────────────────────────────────────
以下是常见微调，需要哪个告诉我：
  • 设置自己的昵称和头像（对方来电界面显示）
  • 通话超时自动挂断（呼叫等待阶段，默认 30 秒）
  • 默认扬声器 / 听筒（通话接通后生效）
  • UI 语言固定为 zh / en（不随设备语言）
  • 静音模式（来电不响铃，适合客服场景）
  • 自定义来电铃声
  • 来电横幅（App 在前台时以横幅代替全屏弹出，不打断当前操作）

如需处理账号登录态失效，可叠加：
  • call/login-recovery（被踢下线 / UserSig 过期处理）
```

等用户选微调 / 登录恢复 / "暂时就这些"：
- 选微调 → Read `playbooks/optional-tweaks.md` → 小型 Preview + Apply
- 选 `call/login-recovery` → 写 `active_slice = call/login-recovery` +
  `active_flow = slice-adding`，Read
  `../../../knowledge-base/slices/call/flutter/login-recovery.md`
- "暂时就这些" → 写 `status = completed`，结束

---

## 与 SKILL.md 硬规则的对应

SKILL.md 里的 AI 行为软约束在本 flow 里的落地：

| SKILL.md 规则 | 本 flow 落地位置 |
|---|---|
| 1. 禁用内部术语 | Phase 2a/3a/4/6/7 里的用户可见文案已用自然语言 |
| 2. 凭证脱敏 | Phase 3b Preview 强制脱敏 |
| 3. 有候选项必用选择框 | Phase A.1 / 1a / 2a 反馈 / 2b / 4 / 6 FAIL 分支 / 7.2 候选页 —— 全部 `AskUserQuestion` |
| 4. 用用户语言回复 | 全流程 |
| 5. 代码不由 AI 现写 | Phase 5 apply 动词严格来自 playbook，snippet 从 templates 读；Phase 7.2 CallButton 用法从 call_button.dart §用法读取；Phase 7.3 生命周期代码从 auth-lifecycle templates 读取 |
| 6. Gate FAIL 用自然语言 | Phase 6 FAIL 分支 |
| 8. 确定性修改边界 | Phase 1c/2b/3a/4/5 的 probe → stage plan → confirm → apply → record |
