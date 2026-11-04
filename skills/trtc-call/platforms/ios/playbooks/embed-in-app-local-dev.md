# playbook: iOS embed-in-app (q1 = local-dev)

> **触发条件**：`platform = ios` AND `form = embed-in-app` AND `q1_usersig_source = local-dev`。
>
> **本文件性质**：指令 recipe。**禁止内嵌代码块**，所有代码来自 `platforms/ios/templates/`。AI 只执行
> INSTALL / PATCH / APPEND 三种动词，不生成代码。
>
> **执行时机**：`flows/basic-call.md` 的 Phase 3 读本文件的「工程配置段」「代码与依赖段」来提取并展示改动；
> Phase 4 按已确认的清单落地；「对话式 PATCH」在 Phase 6.2 / 7.3 使用。其它阶段不 Read 本文件。执行范围必须与已确认的变更清单取交集：清单没列的步骤不得执行。
>
> 所有 PATCH / APPEND 先检查幂等（目标里已有同内容则跳过并告知用户），再落地。

---

## 工程配置段（Phase 4 落地）

| # | 动词 | 目标 | 源 / 参数 | 条件 |
|---|---|---|---|---|
| P0 | RUN | 项目目录（含 `.xcodeproj` 的那一层） | `pod init <所选 xcodeproj 文件名>`（多个 `.xcodeproj` 时必须显式带上，否则 `pod init` 会报 "Multiple Xcode projects found"）；官方生成器，只生成 `Podfile`，不改工程文件。生成的 `Podfile` 自带 `use_frameworks!` 和正确的 `target` 名 | 仅当 probe `podfile.exists = false`，**且用户在 Phase 3 明确同意创建**；目录里已有 `Podfile` 时绝不执行（避免覆盖） |
| P1 | PATCH | `Podfile` 的 `platform :ios` 行 | `templates/snippets/podfile/platform-line.rb`；已有未注释且 ≥ 14.0 则保持不变，已有但 < 14.0 则就地替换该行。**`pod init` 生成的 `# platform :ios, '9.0'` 是注释行，视为"没有"**：把这一行整行替换为 snippet 内容（不要保留被注释的旧行） | 无条件 |
| P2 | APPEND | `Podfile` 主 App target 块内 | `templates/snippets/podfile/pod-line.rb` | 无条件；已有 `TUICallKit_Swift` 行：版本已是 `4.2.1` 则跳过；不一致时须 Phase 2 已获用户同意改为 `4.2.1`，同意后**就地替换该行**为 snippet 内容（不新增第二行），未同意则不执行 |
| P3 | PATCH | `Podfile` 的 `post_install` | 无 `post_install` 块：追加 `templates/snippets/podfile/post-install-sandbox.rb`；已有：把 `post-install-sandbox-body.rb` 并入该块内 | 无条件；已含 `ENABLE_USER_SCRIPT_SANDBOXING` 则跳过 |
| P4 | APPEND | `<AppTarget>/Info.plist` 顶层 `<dict>` | `templates/snippets/info-plist/microphone.xml` | `info_plist_form = file` |
| P5 | APPEND | `<AppTarget>/Info.plist` 顶层 `<dict>` | `templates/snippets/info-plist/camera.xml` | `info_plist_form = file` AND `q3_media_type ∈ {video, both}` |
| P6 | 告知用户 | Xcode Target -> Info 页 | 添加 `NSMicrophoneUsageDescription`（视频还要 `NSCameraUsageDescription`） | `info_plist_form = generated` |

### 顺序与后续

- P1 → P2 → P3 顺序执行。
- Podfile 改完**必须** `pod install`，由用户执行；之后用 `.xcworkspace` 打开。
- Xcode 主工程 `IPHONEOS_DEPLOYMENT_TARGET` 低于 14.0 时，**不改 pbxproj**，告知用户在 Xcode 里改。
- 用户明确跳过某文件（session `skipped_platform_configs`）则该文件的步骤全部跳过，Phase 5 verify 时对应失败项只提醒、不自动修。
- `use_frameworks!`：`pod init` 生成的 Podfile 已自带，无需处理。用户已有的 Podfile 里没有它时，**不自动加**，列入 Phase 3「你需要手动做」并在 verify 里以 error 提示（缺它会导致 Swift 动态库链接失败）。
- `pod init` 之后 `Podfile` 在 snapshot 里记为 `created`，仍在 `--allow Podfile` 内，不会被审计判为越界。

---

## 代码与依赖段（Phase 4 落地）

| # | 动词 | 目标 | 源 / 参数 | 条件 |
|---|---|---|---|---|
| 1 | INSTALL | `<AppTarget>/Debug/TRTCDebugConfig.swift` | `templates/Debug/TRTCDebugConfig.swift`，把 `TRTC_SDK_APP_ID` 那一行的 `0` 替换为 `session.sdkappid`；`secretKey` **保持空串** | 本 playbook 专属；**probe `existing.debug_config_path` 非空则整步跳过**（用户可能已经填了 SecretKey，覆盖会丢，而我们不得读该文件）。SDKAppID 与 session 不一致时，**不替用户改**（不得为定位该行而 Read 文件），只告知应填的值，由用户自己改 |
| 2 | APPEND | `.gitignore`（项目根） | `templates/snippets/gitignore/trtc-debug-config.gitignore` | 无条件；已含 `Debug/TRTCDebugConfig.swift` 则跳过；没有 `.gitignore` 则新建 |

步骤 1 的文件**必须加入主 App target 的 Compile Sources**。命令行无法可靠地改 pbxproj，处理方式：

- 工程使用文件系统同步分组（Xcode 16 新工程，pbxproj 含 `PBXFileSystemSynchronizedRootGroup`）：放进该分组目录即自动编译，无需额外操作。
- 其它工程：告知用户在 Xcode 里把该文件拖进 Target（勾选 Add to targets），并在 Phase 5 verify 提醒。

### SecretKey 约束（硬规则）

- 步骤 1 写入后，AI 之后任何 turn 都**不得 Read `TRTCDebugConfig.swift`**（用户可能已填入 SecretKey）。
  需要改 `sdkAppID` 时让用户自己改，AI 只告知值。
- verify 只 grep `sdkAppID` 行，不输出 `secretKey` 行。
- 不得把 SDKAppID 以外的任何凭证写进 session、日志或其它文件。

---

## 对话式 PATCH（Phase 6.2 / 7.3，用户确认后执行）

这些步骤改的是**用户自己的代码**，必须先展示改动、确认后才落地。位置由用户指定，AI 不猜。

| # | 动词 | 目标 | 源 | 条件 |
|---|---|---|---|---|
| D1 | PATCH | 用户指定的登录处 | `templates/snippets/swift/login-call-local-dev.swift`；并确保文件顶部有 `templates/snippets/swift/imports.swift` 的三行 import（已有的不重复） | 用户选择 patch |
| D2 | PATCH | 用户指定的「点击呼叫」处理方法内 | 按 `q3_media_type` 选 `calls-audio.swift` 或 `calls-video.swift`；`both` 默认用 `calls-video.swift` 并告知可改 `.audio` | 用户选择 patch |

约束：

- D2 的目标位置是**点击事件处理方法**。目标若是登录成功回调、`viewDidLoad`、`onAppear`，拒绝并让用户换位置。
- D1 / D2 都可选 `manual-paste`（只展示代码和位置说明，用户自己粘）或 `skip`（只记 pending_todo）。
- `relogin-cold-start`、`logout`、`login-listener` 三个 snippet **只告知，不 PATCH**。

---

## 最小验证页（Phase 6.2 的 `quick-test`，仅 SwiftUI，用户明确选择后执行）

适用：用户的项目里没有登录页和呼叫入口，希望先把通话跑起来。它是**联调用的临时页面，不是产品界面**。

| # | 动词 | 目标 | 源 / 内容 |
|---|---|---|---|
| Q1 | INSTALL | `<probe.app_source_dir>/QuickTest/TRTCQuickTestView.swift` | `templates/quick-test/TRTCQuickTestView.swift` 原样复制，**不改一个字**。目标已存在则不覆盖，告知"已有，跳过" |
| Q2 | PATCH | `probe.app_entry_file` | 只把 `WindowGroup { … }` 里的**根视图表达式**换成 `TRTCQuickTestView()`，其后的 `.modelContainer(...)` 等 modifier 原样保留 |

步骤：

1. **先给用户看，再动手**：Read `probe.app_entry_file`（App 入口文件不含密钥）。
   - 在 `WindowGroup { }` 里找到**唯一**的根视图表达式（例如 `ContentView()`）。找不到、或有多个 `WindowGroup`、根视图不是单个表达式 → **不改入口**，转 `manual-paste`：只新增 Q1 的文件，告诉用户"请你自己把根视图换成 `TRTCQuickTestView()`"。
   - 展示：① 将新增的文件路径；② 入口文件的**前后对比**（≤ 15 行），写明原来的根视图是什么。
   - 明确说："这是联调用的页面。上线前要删除这个文件，并把入口还原成 `<原根视图>`，我会把它记进待办。"
   - 用户确认后才继续；不确认 → 回到 6.2 重新选。
2. **先拍快照再改**：`ios_audit.py snapshot --output .trtc-call/ios-baseline-quicktest.json`，然后做 Q1、Q2。
3. **审计**：`ios_audit.py audit --baseline .trtc-call/ios-baseline-quicktest.json --output .trtc-call/ios-audit-quicktest.json --allow "<app_source_dir>/QuickTest/TRTCQuickTestView.swift" --allow "<probe.app_entry_file>"`。
   `matched` 才算通过；`diverged` 或 `no-op` 都不算，按 Phase 4 的审计结果表处理。
4. **写 session**：
   - `quick_test = {status: applied, file: "<Q1 路径>", entry_file: "<入口文件>", original_root_view: "<原根视图表达式>"}`（`manual-paste` 时 `status: file-only`）
   - `pending_todos += {field: "quick_test_page", location: "<入口文件>", note: "上线前删除 TRTCQuickTestView.swift，并把 App 入口的根视图还原为 <原根视图>"}`
5. 工程不是文件系统同步分组 → 告知用户把新文件拖进 Target（勾选 Add to targets），`ios_verify.py` 会检查。

约束：

- 验证页里的 userID、被叫 userID 都是输入框，没有 `TODO_` 占位；**不再需要** `login-call-local-dev.swift` 和 `calls-*.swift` 这两类 PATCH。
- 验证页只引用 `TRTCDebugConfig`，**不读也不显示 SecretKey**。
- 不为验证页新增别的文件，不改 `ContentView` 等用户已有视图，不设计其它界面。

---

## 与 backend playbook 的差异

`embed-in-app-backend.md` 只给官方服务端 UserSig 文档指引，不生成 `TRTCDebugConfig.swift`，不改项目。

---

## 落地审计（`platforms/ios/tools/ios_audit.py`）

落地前 `snapshot`、落地后 `audit`，`--allow` 只列用户确认过的文件。多改了任何未确认的文件即 `diverged`，
`project.pbxproj` 无论是否被列入都视为违规。快照只记路径和哈希，`TRTCDebugConfig.swift` 只记是否存在，不读内容。

---

## verify 覆盖（`platforms/ios/tools/ios_verify.py`）

- `Podfile` 含 `pod 'TUICallKit_Swift', '4.2.1'`、`platform :ios` ≥ 14.0、含 `ENABLE_USER_SCRIPT_SANDBOXING`
- `Podfile.lock` 存在且含 `TUICallKit_Swift (4.`（说明 `pod install` 已执行）
- `Info.plist` 含 `NSMicrophoneUsageDescription`；视频时含 `NSCameraUsageDescription`
- `Debug/TRTCDebugConfig.swift` 存在，整个文件在 `#if DEBUG` 内，`sdkAppID` 与 session 一致
- `.gitignore` 含 `Debug/TRTCDebugConfig.swift`
- 项目内不得有任何被 git 跟踪或会被提交的文件，把非空 `secretKey` 字面量写在 `#if DEBUG` 之外
- 若存在 `TRTCQuickTestView.swift`：提醒上线前删除；非同步分组时提醒加入 Target

> **Release 产物的实测结论**（用一个假密钥对照：Debug 产物里能搜到，Release 产物里 0 处命中）：`#if DEBUG` 能保证 SecretKey 与 `TRTCDebugConfig` 不进入 Release。
> 在 Release 二进制里搜 `GenerateTestUserSig` 或 `hmac secretKey` 仍会有命中，它们来自 `TUICallKit_Swift` 自带的类和日志文案（静态链接进主二进制），**不是你的代码泄漏**，也不含密钥值。判断 Release 是否干净，应搜你填过的密钥值和 `TRTCDebugConfig`，不要搜这两个词。
