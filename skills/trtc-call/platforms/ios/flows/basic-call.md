# platforms/ios/flows/basic-call — iOS AI 运行时流

> **触发条件**：`platforms/ios/ROUTER.md` 判定 `platform = ios` 且 `form = embed-in-app`。
>
> **本文件性质**：AI 运行时 orchestration，按 Phase 顺序推进，STOP 点明确。
>
> **代码来源永远是 `platforms/ios/templates/`，指令来源永远是 `platforms/ios/playbooks/embed-in-app-<q1>.md`，
> 事实来源永远是 `platforms/ios/playbooks/integration-reference.md`**。本文件不含 Swift 代码，不生成代码。
>
> **与 Flutter 版的差异**：iOS 版不使用 `apply_plan.py` 的"计划 → 批准 → 审计"门禁；改为
> "探测 → 展示全部改动 → 用户一次确认 → 落地 → 校验"。确认之前禁止任何 Edit / Write **用户工程文件**
> （skill 自己的工作目录 `.trtc-call/` 与 `.trtc-session.yaml` 不算用户工程文件，Phase 2 起允许写入）。

---

## Session 写入规约

所有 session 写入必须用两步 CAS，不得直接编辑 `.trtc-session.yaml`。

**Step 1** 读版本号：
```bash
(cd "<当前 trtc skill 目录>" && python3 -m tools.session read --project-root "<用户项目根目录>" --field state_version)
```
**Step 2** 批量写入（单字段也用 write-batch）：
```bash
(cd "<当前 trtc skill 目录>" && python3 -m tools.session write-batch --project-root "<用户项目根目录>" \
  --updates '{"field1": "value1"}' --expected-version N)
```
exit 3（冲突）→ 重读版本号重试，最多三次，仍失败则 `AskUserQuestion`：重置 session 从头开始 / 我先手动检查，然后 STOP。

**列表字段的"追加"**（本 flow 里写作 `pending_todos += …`、`skipped_platform_configs += …`）：`write-batch` 对列表是整体覆盖，不是追加。
做法：先 `read --field <字段名>` 取当前值，把新项并进去，再把完整列表整体写回。
exit 1（参数错误）→ 停下排查，不重试。

凡本 flow 里「写 X = Y」均指上述 write-batch。同一 Phase 内的多个字段合并成一次调用。

**SecretKey 永远不进 session、不进对话、不进日志。**

---

## 顺序总览

```
Phase A   SDKAppID                读 session.sdkappid；没有则回收集流程
Phase 1   两个问题                 Q1 UserSig 来源 + Q3 媒体类型，一次问完
Phase 2   工程探测                 ios_probe.py → blockers / 现状
Phase 3   改动预览 + 一次确认       展示全部改动（含你需要手动做的）→ STOP 等确认
Phase 4   落地                     按 playbook 执行，逐项汇报
Phase 5   校验                     ios_verify.py → 自然语言汇报
Phase 6   待办与登录接入            pending 清单 + 登录处 patch + 登录相关 API 告知
Phase 7   呼叫触发 + 跑起来         呼叫处 patch + 填 SecretKey + 运行 + 结果分支
Phase 8   收尾                     明确"仅覆盖前台来电" + 微调菜单
```

**顺序硬门**：Phase N 完成前禁止进入 Phase N+1。每个 Phase 结束写 `current_phase`。

---

## Phase A — SDKAppID

**目的**：只确认 SDKAppID，**永不收集 SecretKey**。

**短路**：session 有 `sdkappid`（非空、大于 0，由根分发器的收集流程写入）→ 写
`phase_a_state = has-sdkappid`、`q8_sdk_app_id = <sdkappid>`，直接进 Phase 1。

**等待回复**：`phase_a_state = awaiting-sdkappid` → 本轮用户消息就是对「请发 SDKAppID」的回复，按下表第 1 行的校验处理，不再重弹问题。

**没有 `sdkappid`**（用户直接进入本 skill 或老 session）→ `AskUserQuestion` 单选：

| # | label | value | 动作 |
|---|---|---|---|
| 1 | 我有 SDKAppID，现在给你 | `has` | **不要 Read 共享的 `collect-sdkappid.md`**（它的前置断言和出口是给根分发器用的，会重复询问）。直接说："好，请把 SDKAppID（纯数字）发给我。SecretKey 不用发到对话里，后面我会告诉你填到代码的具体位置。" 先写 `phase_a_state = awaiting-sdkappid`，然后 STOP 等回复；下一轮读到 `phase_a_state = awaiting-sdkappid` 时，不再弹本表，直接把用户这条消息当作回复处理：若 trim 后匹配 `^\d{8,12}$`，写 `sdkappid = <int>`、`sdkappid_state = collected`、`phase_a_state = has-sdkappid`、`q8_sdk_app_id = <int>`、`current_phase = phase1`，进 Phase 1；不匹配则提示"这看起来不是 SDKAppID（应是 8–12 位纯数字），请再发一次，或选择先用占位走完流程"，保持等待（用户说"取消 / 先占位"则按第 2 行处理）。回复里含疑似 SecretKey 时按下面的规则处理，不得写入 |
| 2 | 还没有，先用占位走完流程 | `placeholder-only` | 写 `phase_a_state = placeholder-only`；模板里 `sdkAppID` 保持 `0`；`pending_todos += {field: "TRTC SDKAppID", location: "Debug/TRTCDebugConfig.swift", note: "运行前自己填 sdkAppID 与 secretKey"}`；告知"代码能编译，但登录会失败，运行前必须填好"，进 Phase 1 |

用户回复里若含疑似 SecretKey（≥ 32 位十六进制串，或"SecretKey"后跟长串）：不复述、不使用、不写入任何地方，回复：

> 你的消息里好像包含了 SecretKey。我不会使用它，也不会写进任何文件。它已经出现在对话里，建议到 TRTC
> 控制台重置这个密钥。以后只需要把 SDKAppID 发给我，SecretKey 你自己填到本地文件里。

**出口**：`phase_a_state ∈ {has-sdkappid, placeholder-only}`，否则禁止进入 Phase 1。进入 Phase 1 时一并写 `current_phase = phase1`。

---

## Phase 1 — 两个问题

一次 `AskUserQuestion` 发出，多题一 turn。

**Q1 — UserSig 来源**

| # | label | value |
|---|---|---|
| 1 | 本地调试 —— 在客户端用 SDKAppID + SecretKey 签名，最快跑起来 | `local-dev` |
| 2 | 生产环境 —— 先按官方文档完成服务端 UserSig（当前版本仅提供指引） | `backend` |

写 `q1_usersig_source`。`backend` → Read `playbooks/embed-in-app-backend.md` 执行 handoff，写
`phase1a_blocked = backend-usersig-integration-deferred` 后 STOP。**禁止继续探测或改项目。**

**Q3 — 媒体类型**

| # | label | value |
|---|---|---|
| 1 | 仅语音 | `audio` |
| 2 | 仅视频 | `video` |
| 3 | 语音和视频都支持 | `both` |

写 `q3_media_type`、`current_phase = phase2`。两个字段都写入后才能进 Phase 2。

---

## Phase 2 — 工程探测

在任何文件落盘前运行只读探测：

```bash
python3 "<trtc-call skill 目录>/platforms/ios/tools/ios_probe.py" \
  --project-root "<用户项目根目录>" \
  --output "<用户项目根目录>/.trtc-call/project-profile.json"
```

> 用户选定 xcodeproj / target 之后重跑时，追加 `--xcodeproj "<文件名>.xcodeproj"` 和/或 `--target "<target 名>"`。

必须直接读取 JSON 的 `blockers`、`warnings`、`app_target`、`app_targets`、`deployment_target`、
`deployment_ok`、`info_plist_form`、`info_plist_path`、`app_source_dir`、`file_system_synchronized`、
`ui_framework`、`language`、`podfile`、`existing`。**禁止 AI 再自行 grep 另做一份判断。**

> `.trtc-call/` 不含任何凭证，但仍应确保 `.gitignore` 忽略它；若项目是 git 仓库且未忽略，提醒用户。

- `blockers` 非空：把每条 `message` 转成自然语言告诉用户，写 `phase3a_blocked = <message>`，STOP。
  - `no-xcodeproj`：当前目录不是 iOS 原生工程（也可能是路径不对）。
  - `objc-only`：纯 Objective-C 工程不能直接用，告知原因（核心方法没有 `@objc`），建议新增 Swift 文件做桥接或查文档。
- `warnings` 逐条转自然语言，并按下表处理：

| warning | 处理 |
|---|---|
| `multiple-xcodeproj` | 用 `AskUserQuestion` 让用户选要接入的 `.xcodeproj`（选项取自 warning 里列出的文件名）；写 `xcodeproj`，然后**带 `--xcodeproj <所选文件名>` 重跑 probe**。此后 `ios_verify.py` 带同一个 `--xcodeproj`；`pod init` 则把所选文件名作为位置参数（`pod init <文件名>.xcodeproj`，`pod init` 本身没有 `--xcodeproj` 选项）。续接时（`phase3` / `phase4` 重跑 Phase 2、Phase 5 verify）先 `read` session 里记录的 `xcodeproj` / `app_target`，再带上这两个参数，不要回到默认工程 |
| `multiple-app-targets` | 用 `AskUserQuestion` 让用户选目标；写 `app_target`，然后**带 `--target <所选 target>`（同时带已确定的 `--xcodeproj`）重跑 probe**；部署版本、Info.plist、源码目录以重跑结果为准。`ios_verify.py` 也带同一组参数 |
| `deployment-too-low` | 列入 Phase 3 的「你需要手动做」，不改 pbxproj |
| `tuicallkit-version-mismatch` | 展示现有版本，问用户是否改为 4.2.1；不同意则 STOP |
| `force-deployment-override` | 建议用户移除，并说明原因；不替用户删 |
| `no-podfile` | 记 `podfile_missing = true`，继续往下。**不要此时问用户**，是否创建 Podfile 统一放到 Phase 3 的确认里 |
| `no-cocoapods` | 告知本机没有 CocoaPods（TUICallKit_Swift 只支持 CocoaPods），请先安装（官方安装方式见 https://guides.cocoapods.org/using/getting-started.html ），装好后再来；写 `phase3a_blocked = no-cocoapods`，STOP |

- `blockers` 为空 → 写 `project_profile_path = .trtc-call/project-profile.json`、`current_phase = phase3`，进 Phase 3。

---

## Phase 3 — 改动预览 + 一次确认

Read `playbooks/embed-in-app-local-dev.md`，按「工程配置段」和「代码与依赖段」提取步骤，**与 probe 结果取交集**
（已满足的步骤标记"已有，跳过"，不展示 diff）。

按 `q3_media_type` 裁剪：`audio` 不展示相机权限。

**一次性展示三块：**

**① 我会改的（给 diff）**
- **没有 Podfile 时（`podfile_missing = true`）**，这一块最前面单独说一句，并作为确认选项的一部分让用户明确同意：
  > 我没有在你的项目里找到 Podfile（TUICallKit_Swift 需要通过 CocoaPods 安装）。需要我帮你创建一个吗？我会在项目目录运行 `pod init`，它只生成一个 `Podfile`，不会改你的 Xcode 工程文件。
  用户不同意创建 → 告知"没有 Podfile 无法继续，你可以自己执行 `pod init` 后再来找我"，写 `phase3a_blocked = user-declined-podfile`，STOP。
- `Podfile`：`platform` 行、`pod 'TUICallKit_Swift', '4.2.1'`、沙盒设置。沙盒设置要如实说明：它写在 Podfile 的 `post_install` 里，你执行 `pod install` 时会把你工程所有 target（含 Release）的 `ENABLE_USER_SCRIPT_SANDBOXING` 设为 `NO`，所以 `pod install` 之后 `project.pbxproj` 会有变化，这是预期行为（Xcode 15+ 不加会 Embed 失败）
- `Info.plist`（`info_plist_form = file`）：麦克风权限（视频还有摄像头权限）
- 新增 `Debug/TRTCDebugConfig.swift`：整个文件在调试构建里才存在，`sdkAppID` 我填好，**`secretKey` 留空**
- `.gitignore`：忽略上面这个文件，防止误提交你填的 SecretKey

**② 需要你手动做的（我只指路，不替你改）**
- 部署版本低于 14.0 → 在 Xcode 的 Target → General / Build Settings 里改到 14.0 以上，已有更高版本不要降
- 无独立 Info.plist（`info_plist_form = generated`）→ 在 Xcode Target → Info 页添加麦克风权限（视频还要摄像头权限）说明文案
- 工程不是文件系统同步分组 → 把 `Debug/TRTCDebugConfig.swift` 拖进 Target（勾选 Add to targets）
- `Podfile` 没有 `use_frameworks!` → 加上
- 改完 Podfile 后执行 `pod install`，之后用 `.xcworkspace` 打开

**③ 你的 SecretKey**

> SecretKey 不要发给我。等下我会告诉你在 `Debug/TRTCDebugConfig.swift` 里填哪一行。这个文件只在调试构建里生效，
> 上线前请改成服务端签发 UserSig。

然后 `AskUserQuestion`：

| # | label | value |
|---|---|---|
| 1 | 确认，开始改（`podfile_missing = true` 时，label 写成「确认，开始改（包括帮我创建 Podfile）」） | `apply` |
| 2 | 有几处我想自己改 | `partial-skip`（追问具体哪些文件，写 `skipped_platform_configs += <文件>`；`podfile_missing = true` 时，选这项意味着用户自己创建 Podfile，提示其先执行 `pod init` 再回来，写 `phase3a_blocked = user-will-create-podfile`，STOP） |
| 3 | 取消 | `abort`（STOP，不改任何文件） |

只有 `apply` / `partial-skip` 才进入 Phase 4。写 `phase3_decision = <value>`、`current_phase = phase4`。
`podfile_missing = true` 且用户选 `apply` = 用户已同意创建 Podfile，Phase 4 才会执行 playbook 的 P0。

**进入 Phase 4 之前，先拍一次改动前快照**（只记路径和哈希，不记内容；`TRTCDebugConfig.swift` 只记是否存在）。
**若 `.trtc-call/ios-baseline-phase4.json` 已存在且 `current_phase = phase4`**（说明是 Phase 4 落地中断后的续接），**不要重拍**，沿用旧基线，否则审计无法证明"只改了确认过的文件"：

```bash
python3 "<trtc-call skill 目录>/platforms/ios/tools/ios_audit.py" snapshot \
  --project-root "<用户项目根目录>" \
  --output "<用户项目根目录>/.trtc-call/ios-baseline-phase4.json"
```

> **基线和审计结果每一步各存一份，不覆盖**：`ios-baseline-<步骤>.json` 是该步骤改动前的快照，`ios-audit-<步骤>.json` 是该步骤的审计结果。
> 步骤名固定为 `phase4`、`quicktest`、`login`、`call`。**必须先拍快照、再改文件**，顺序反了审计就证明不了任何事。

---

## Phase 4 — 落地

只执行 Phase 3 已展示并确认的步骤，顺序按 playbook：（`podfile_missing = true` 时先 `pod init`）→ Podfile → Info.plist → `Debug/TRTCDebugConfig.swift` → `.gitignore`。

- `pod init` 只在用户于 Phase 3 同意创建、且执行前再确认一次目录里仍没有 `Podfile` 时运行（命令见 playbook P0）；失败（例如 `pod` 报错）则停下，原样转述报错，不手写 Podfile 代替。
- 每个 PATCH / APPEND 先检查幂等，已有则跳过并告知。
- `TRTCDebugConfig.swift` 把 `TRTC_SDK_APP_ID` 行的 `0` 替换为 `session.sdkappid`；`placeholder-only` 时保持 `0`。
  **`secretKey` 保持空串。写入后 AI 不得再 Read 该文件。**
- 任一步失败：停下，报告已完成/未完成的项，不继续后续步骤，不回滚用户其它文件。
- 完成后逐文件汇报 ✅ / ⏭ 跳过 / ❌ 失败。

**落地后必须审计**，确认只改了用户确认过的文件：

```bash
python3 "<trtc-call skill 目录>/platforms/ios/tools/ios_audit.py" audit \
  --project-root "<用户项目根目录>" \
  --baseline "<用户项目根目录>/.trtc-call/ios-baseline-phase4.json" \
  --output "<用户项目根目录>/.trtc-call/ios-audit-phase4.json" \
  --allow "Podfile" \
  --allow "<probe.info_plist_path>" \
  --allow "<probe.app_source_dir>/Debug/TRTCDebugConfig.swift" \
  --allow ".gitignore"
```

`--allow` 只列 Phase 3 中用户确认的文件，用户选择自己改（`skipped_platform_configs`）的文件和 `info_plist_form = generated`
时的 `Info.plist` 不要列。读取 JSON 的 `status`：

| status | 处理 |
|---|---|
| `matched` | 通过，写 `current_phase = phase5` |
| `no-op` | 只有当落地汇报里**每一步都是"已有，跳过"**（幂等重跑）才算通过，写 `current_phase = phase5`。只要汇报里有任何一步是 ✅ 已写入，却审计为 `no-op`，说明快照拍晚了（顺序反了）或文件没真正写入：告知用户并重新检查，不进入 Phase 5 |
| `diverged` 且 `changes.forbidden` 非空 | **停下**。告诉用户 `project.pbxproj` 被改动，这违反约定，建议用 `git diff` 查看并还原，不继续 |
| `diverged` 且仅有 `changes.unplanned` | **停下**。用自然语言列出多改了哪些文件（只说路径和"新增 / 修改 / 删除"），问用户保留还是还原；不替用户还原，用户确认前不进入 Phase 5 |
| 退出码 2（`status = error`，错误 JSON 可能在 stderr） | 先看错误原因：`--allow` 含 `..` 或绝对路径是参数写错，修正后重跑，**不要重拍快照**；基线缺失或不匹配才是重新拍快照，只对"当前状态"再校验，并如实说明本次无法证明改动范围 |

> `ios_probe.py` 有 blocker、`ios_verify.py` 有 error、`ios_audit.py` 判 diverged 时退出码都是 1，但 stdout 仍有完整 JSON，照常读取，不要当成工具崩溃。

---

## Phase 5 — 校验

```bash
python3 "<trtc-call skill 目录>/platforms/ios/tools/ios_verify.py" \
  --project-root "<用户项目根目录>" \
  --sdkappid <session.sdkappid；placeholder-only 时省略> \
  --media-type "<q3_media_type>"
```

> 若 Phase 2 里用户选过 xcodeproj / target，这里追加同样的 `--xcodeproj` / `--target`，否则 verify 会默认检查第一个工程。

读取 JSON 的 `checks`，用自然语言汇报：先说通过了什么，再逐条说 `ok = false` 的项。

| 情况 | 处理 |
|---|---|
| `level = error` 且失败 | 告诉用户具体问题。自动修的范围**仅限 Phase 3 已确认且不在 `skipped_platform_configs` 里的文件**（Podfile 的 platform / pod 行 / 沙盒、plist、gitignore）；`podfile_use_frameworks` 失败、以及用户选择自己改的文件，只指路不修。自动修前先告知要改什么并得到同意；修完用 Phase 4 同一份基线（`ios-baseline-phase4.json`）、同一组 `--allow` 重跑审计，再重跑 verify，最多 3 轮，仍失败则列清单 STOP |
| `level = warn` 且失败 | 不阻塞。`pods_installed` → 提醒执行 `pod install`；`secret_key_filled` → 提醒运行前自己填；`plist_*`（无 Info.plist 形态）→ 提醒手动添加；`debug_config_in_target` → 提醒在 Xcode 里把 `TRTCDebugConfig.swift` 拖进 Target（勾选 Add to targets），并写入 `pending_todos`（不加入则 6.2 接入登录后会编译失败：`cannot find 'TRTCDebugConfig' in scope`） |
| `debug_config_not_tracked` / `no_secret_literal_in_source` 失败 | **高优先级**：告诉用户有 SecretKey 泄漏风险，建议到控制台重置该密钥；**不要把命中的内容复述出来** |

校验输出里不会含 SecretKey；若用户贴来的日志里含 `secretKey` / `hmac` / `string to sign` 行，先提醒其删除再继续。

写 `current_phase = phase6`。

---

## Phase 6 — 待办与登录接入

### 6.1 pending_todos

若 `pending_todos` 非空，逐条展示；有 `skipped_platform_configs` 则列出"这些文件你选择了自己改"。

### 6.2 登录与呼叫入口的接入位置

**目的**：把登录调用放到用户的登录成功处，把呼叫调用放到用户的"点击呼叫"处。登录页、通话按钮是**用户自己 App 的界面**，skill 不设计界面。

> **硬约束（6.2 / 7.3 全程适用）**：
> 1. 只能改用户**自己指定**的文件和方法；**不得新增任何源文件、不得改 App 入口**。
> 2. 唯一例外是下面的 `quick-test`：用户明确选了它，新增 `TRTCQuickTestView.swift` 并只改入口文件里的根视图一处，且改动前必须先给用户看前后对比、得到确认。
> 3. 用户的项目里没有登录页或呼叫入口时，**不得自己现编登录页/呼叫界面**（包括 `LoginView`、联系人列表等）；只能走 `quick-test`、`manual-paste` 或 `skip`。

`AskUserQuestion` 单选：**「你的项目里已经有登录和发起通话的地方吗？」**

| # | label | value |
|---|---|---|
| 1 | 有，我告诉你在哪个文件、哪个方法，你帮我加进去 | `patch` |
| 2 | 项目里什么都没有，你帮我生成一个最小验证页（输入 userID 登录、输入被叫发起通话，仅联调用） | `quick-test` |
| 3 | 给我代码和位置说明，我自己粘 | `manual-paste` |
| 4 | 先跳过 | `skip` |

`quick-test` 这一项**只在 `probe.ui_framework = swiftui` 且 `probe.app_entry_file` 非空且 `probe.app_source_dir` 非空时才列出**；
UIKit 或无法定位 SwiftUI 入口时只列 1、3、4，并说明"最小验证页目前只支持 SwiftUI 工程，UIKit 请选 1 或 3"。

- `quick-test`：按 `playbooks/embed-in-app-local-dev.md` 的「最小验证页」执行。完成后**登录和呼叫两处都已覆盖**：
  写 `dialog_patch_login = {status: quick-test}`、`dialog_patch_call_trigger = {status: quick-test}`，直接进入 6.3，之后 7.3 整节跳过。
- `patch`：问用户登录方法所在文件和方法名（自由文本）；该文件可能含用户自己的密钥配置，Read 后**若发现疑似 SecretKey（≥ 32 位十六进制串、`secretKey` / `SECRETKEY` 赋值），不得复述或写入任何地方**，只按 Phase A 的提示话术提醒用户；`TRTCDebugConfig.swift`、`*.xcconfig`、`.env`、`GenerateTestUserSig*` 这类配置文件不得 Read。找不到则让用户改（最多 3 次，之后转 `manual-paste`）。
  展示"方法所在段落 + PATCH 后效果"（≤ 15 行上下文 + 变更），确认后落地：
  - 落地前先对项目拍快照（命令同 Phase 3 末尾，`--output` 用 `.trtc-call/ios-baseline-login.json`），**拍完才能改文件**。
  - 按 `q1_usersig_source` 选 `login-call-local-dev.swift`（backend 当前不进入本流程）。
  - 确保文件顶部有 `imports.swift` 的三行 import，已有的不重复。
  - snippet 里的 `userID`：用户代码里已有当前登录 userID 变量就换成该变量；没有就换成字符串字面量 `"TODO_userID"`，并写 `pending_todos += {field: "login_userID", location: "<文件>:<行>", note: "把 TODO_userID 换成真实登录 userID"}`。
  - 落地后审计，`--baseline` 用 `ios-baseline-login.json`，`--output` 用 `.trtc-call/ios-audit-login.json`，`--allow` 只列用户指定的那一个文件（结果处理规则同 Phase 4 的审计结果表；`matched` 才算通过，这里 `no-op` 说明没改成，要重新检查）。
  - 写 `dialog_patch_login = {status: applied, file, method}`。
- `manual-paste`：展示 snippet 与"放在哪里"的说明，写 `dialog_patch_login = {status: manual}`，`pending_todos += 登录调用未接入`。
- `skip`：写 `dialog_patch_login = {status: skipped}`，`pending_todos += 登录调用未接入`。

### 6.3 登录相关 API 告知（只告知，不 PATCH）

无论 6.2 选哪个分支，都**展示一次**。SDK 不会替用户做下面三件事，由用户自己加；AI 不 PATCH、不追问位置。
展示 `templates/snippets/swift/` 下三个 snippet 的内容，并配上规则：

1. **冷启动重新登录**（`relogin-cold-start.swift`）：SDK 冷启动**不会**恢复登录，不重新登录就收不到任何来电。放在"判断用户已登录过"的启动处。
2. **登出 / 切换账号**（`logout.swift`）：先登出再登录新账号，不登出直接登录也可行；登出后呼叫会报 `6013` 或 `-1201`，请把呼叫入口置灰；
   **不要**用 `LoginStore.state.loginStatus` 判断登出，用自己的登录态。
3. **被踢下线 / UserSig 过期**（`login-listener.swift`）：这套写法来自官方 demo、编译确认，**真实触发行为我们没有验证过**，如实告知。

写 `login_extra_api_told = true`，`pending_todos += {field: "login_restore_and_logout", location: "用户自选", note: "冷启动重新登录、登出/切换账号、被踢/UserSig 过期，按给出的 API 自行接入"}`，`current_phase = phase7_3`。

---

## Phase 7 — 呼叫触发 + 跑起来

### 7.3 呼叫触发处接入（对话式 PATCH）

**若 `dialog_patch_call_trigger.status = quick-test`：本节整节跳过**（验证页里的按钮已经是点击触发），直接进入 7.4。

**硬约束**：呼叫**只能由用户点击触发**（通话按钮 / 联系人条目点击）。**禁止**放在登录成功回调、`viewDidLoad`、`onAppear`
等自动执行位置。原因：登录回调返回时通话引擎还没初始化完，立即 `calls` 稳定返回 `-1201`（实测）。snippet 不带重试逻辑。

`AskUserQuestion`：`patch` / `manual-paste` / `skip`（同 6.2）。

- `patch`：问"点击呼叫的处理方法"所在文件与方法名；定位后若目标是登录回调 / `viewDidLoad` / `onAppear`，**拒绝**并让用户换成点击处理方法。
  按 `q3_media_type` 选 `calls-audio.swift` / `calls-video.swift`（`both` 默认 video，并告知可改 `.audio`）。
  snippet 里的 `calleeUserID`：用户代码里已有被叫 userID 变量就换成该变量；没有就换成字符串字面量 `"TODO_callee_userID"`，
  并写 `pending_todos += {field: "callee_userID", location: "<文件>:<行>", note: "把 TODO_callee_userID 换成真实被叫 userID"}`。
  落地前后同样要快照与审计（基线 `ios-baseline-call.json`，结果 `ios-audit-call.json`），`--allow` 只列用户指定的那一个文件。
- 其余同 6.2。写 `dialog_patch_call_trigger`。

### 7.4 跑起来

分三步展示，然后 STOP 等用户反馈：

1. **自己填 SecretKey**：打开 `Debug/TRTCDebugConfig.swift`，在 `secretKey` 处填入控制台里的 SecretKey（占位流程还要补 `sdkAppID`）。
   不要发给我，不要提交 git。调试时 SDK 自带的签名工具会把 SecretKey 打印到 Xcode 控制台，**贴日志前先删掉含 `secretKey` / `hmac` 的行**。
   **建议在 Xcode 里填写**；若在 Cursor 等编辑器里填，填完立即关闭该文件的标签页，避免编辑器把当前打开的文件带进对话上下文。
   工程不是文件系统同步分组时，先确认已把该文件拖进 Target（否则编译报 `cannot find 'TRTCDebugConfig' in scope`）。
2. 还没执行过 `pod install` 就请你在终端执行（AI 不代为执行：它会联网下载并改写 `project.pbxproj`；用户明确要求 AI 代跑时，先再确认一次再执行），之后用 `.xcworkspace` 打开，选择真机或模拟器运行。
   > `pod install` 会改动 `project.pbxproj`、新增 `.xcworkspace`，这是预期行为，不算越界。审计只拿"每次接入前刚拍的快照"做对比，
   > 所以**如果用户在 Phase 4 之后执行过 `pod install`，6.2 / 7.3 的快照必须在那之后重新拍**（流程里本来就要求落地前重拍）。
3. 两台设备分别登录不同 userID，点击呼叫。使用最小验证页（`quick_test.status = applied`）时：两端先各自输入**不同**的 userID 点"登录"，等 3 到 5 秒，再在其中一端的"被叫 User ID"里填对方的 userID，点语音/视频通话。被叫端必须已登录且 App 在前台。

真机补充：免费个人团队签名需要在手机「设置 → 通用 → VPN 与设备管理」信任开发者证书，**删除 App 重装后要重新信任**。
国行 iPhone 如登录报 `9512`，检查该 App 是否被允许使用蜂窝/无线数据。

写 `active_flow = waiting-run-result`、`current_phase = phase7_5`，STOP。

### 7.5 运行结果分支

| 用户反馈 | 动作 |
|---|---|
| "跑通了" / "可以打电话了" | 写 `active_flow = playbook-done`，进 Phase 8 |
| "报错" / "崩溃" / 贴日志 | 先提醒删含 `secretKey` / `hmac` 行；按 `integration-reference.md` 的错误码速查逐条定位；仍无法定位则 STOP 让用户补信息 |
| "先不跑了" | 写 `active_flow = playbook-done`，进 Phase 8 |

常见定位（以 `integration-reference.md` 为准）：`-1201` → 先确认已登录、呼叫是否被放在登录回调里；`6013` → 登出后又呼叫；`70020` → SDKAppID
填错；`-1001 ... does not support this ability` → 该应用没开通 Call；`9512` → 网络权限；启动即崩溃 → 先查 Info.plist 权限声明。

---

## Phase 8 — 收尾

**AI 说**：

> 基础集成完成。
>
> **重要：这次只覆盖「App 在前台」时的来电。**
> - App 切到后台（Home 键）：收不到来电信令
> - 锁屏：可能过一会儿才送达，且只有 SDK 自带的震动，没有通知和铃声，不能当作能力承诺
> - App 被杀：完全收不到来电
>
> 如果你的产品需要这些场景，必须另外接入 VoIP Push + CallKit（目前我这里还没有这部分的接入流程）。
>
> 另外几点（API 见前面给你的示例，需要你自己加）：
> - 冷启动：用 `TUILogin.login` 重新登录，否则收不到来电
> - 登出 / 切换账号：用 `TUILogin.logout`，登出后把呼叫入口置灰
> - 被踢 / UserSig 过期：`TUILogin.add(listener)` + `onKickedOffline` / `onUserSigExpired`
> - 发布前确认 Release 包里没有 SecretKey：UserSig 要由你的后端签发
>
> 还有这些待办：<展示 pending_todos>
>
> 还想加什么？

可选微调（只告知 API，不替用户改）：昵称头像、悬浮窗、来电横幅、静音模式、自定义铃声、呼叫超时。API 清单见
`integration-reference.md` 的「可选微调 API」，**不得编造清单之外的 API**（如扬声器切换、UI 语言切换，公开 API 中未找到）。

用户选择"暂时就这些"→ 写 `status = completed`，结束。

---

## 不得做的事（本 flow 汇总）

- 要求用户在对话里发送 SecretKey；复述、使用或写入任何用户贴出的疑似 SecretKey。
- Read `Debug/TRTCDebugConfig.swift`（用户可能已填 SecretKey）；同理不 Read `*.xcconfig`、`.env`、`GenerateTestUserSig*`。
- 把 `calls` 放进登录成功回调、`viewDidLoad`、`onAppear`。
- 为冷启动恢复登录、登出、被踢处理做 PATCH（只告知）。
- 声称"锁屏 / 后台也能收到来电"。
- 改 `project.pbxproj`、关闭 `CODE_SIGNING_*`、强制覆盖所有 Pods 的部署版本。
- 对用户说内部术语（playbook / snippet / session 字段名 / 脚本名），用"我先给你看改动""我先检查一下代码"这类说法。
