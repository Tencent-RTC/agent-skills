# TIMPush workflow 硬约束（L2）

> **何时读**：进入 `wizard-android` / `troubleshoot-android` / `wizard-ios` / `troubleshoot-ios` / `wizard-flutter` / `troubleshoot-flutter` / `wizard-uniapp` / `troubleshoot-uniapp` / `troubleshoot-harmony`（首次 `get_workflow_state` 之前）必须 Read 本文件一次；同会话后续 turn 不必重复读，除非用户换了新的 workflow run。  
> **冲突处理**：若本文件与 engine schema 冲突，以 engine schema 为准，并向用户说明「workflow 文档需要升级」，不要自行补流程。


---

## 厂商差异来源

`fetch_vendor_setup_guide` 同时返回文档解析结果与 `integration_requirements`。

- Android 7 厂商：以 MCP `fetch_vendor_setup_guide` 返回的 `integration_requirements` 为准。
- iOS / Apple APNs：以 MCP 返回的 Apple / APNs `integration_requirements` 为准。

**不要**从 `vendor-*.md` 长文档临场抽取这些机器可判定差异。

---

## 全平台通用红线

- **trtc-push-mcp 不可用 = 硬停止，禁止静默兜底**：工具列表里没有 `trtc-push-mcp`、或 `list_workflows` 跑不通时，唯一动作是直接提醒用户开启 MCP 并等待（各 IDE 开法见 SKILL.md「MCP 不可用」节）；不得改用纯知识 / 手写步骤 / markdown 手册带用户往下走。没有引擎就没有状态强制、schema 契约和工具账本，「AI 自己带着走」必然走歪。
- **逐阶段呈现**：workflow 每个阶段 prompt 要求输出给用户的内容，必须在调用 `complete_workflow_step` 之前完整呈现；禁止连续推进多个阶段而中间不向用户呈现。无 `required_tool_calls` 的阶段，engine 会在返回里附带 `presentation_reminder`，收到即遵守。
- **进度头照抄、不加料**：engine 注入的首行形如 `【第 10/15 步 · 输出未完成清单】`，照抄即可。**禁止**自己往里补「下一步：X」或把内部 state 名 / 「阶段 8」这类第二套编号写给用户——下一步信息在返回值的 `progress.next_title` 里，只给你自己规划用。
- **用户可见输出必须分层**：凡一条消息里同时含「AI 已完成的事」「需要用户去做/决策的事」「补充说明」，一律按 **✅ 我已完成 / 🙋 需要你做 / 💡 补充说明** 三桶带小标题输出；需要用户动手的每条写清「去哪 + 干什么 + 做完回我什么」。禁止平铺成同权重长文（实测反馈：层级不分时用户要读完全文才知道自己该干嘛）。高密度阶段 engine 已用 `user-facing-layering` 片段注入同一份契约。
- wizard 的交付物（stage-10 成功标准 / 验证指南 / 路线图）与收尾追问（stage-11 体验调研 + 下一项路由）是两个独立阶段：先完整交付，提交后才允许提问。

---

## Android 跨阶段红线

- 凭据**只**进 `local.properties`，源码 / Gradle 字面量都不行（engine 在 stage-4/6 用 schema 拒收）。
- 厂商工程差异以 `fetch_vendor_setup_guide.integration_requirements` 为准；stage-5/8 必须按 selected vendors 输出并校验，不允许只靠通用文案跳过小米 / OPPO / vivo / 荣耀 / 魅族 / FCM 差异。
- **厂商凭据分两级，只问编译期必需的那一级**：`local_properties.build_time_keys`（当前只有 vivo AppID + AppKey、荣耀 APPID）会注入 BuildConfig / manifestPlaceholders，必须问、缺了要拦。其余（华为 Client ID / Client Secret、小米 / OPPO / 魅族 AppKey + AppSecret、FCM 服务账号 JSON）只在用户**手动**去腾讯云控制台上传厂商证书时用到——客户端身份来自厂商 JSON、运行时配置来自 `timpush-configs.json`，**不填也能集成成功**。这一级默认不索要、不写空占位、不在 stage-8 当漏项催；只在指引里说明「从厂商控制台复制、直接粘贴到腾讯云证书表单」。
- Chat / IM `SDKAppID` 与 `TIMPUSH_SDK_APP_ID` 必须一致；不一致 engine 在 stage-3 → `advanced_to_failure`。
- 包名一致性（工程 `applicationId` vs 厂商控制台填的包名）由 stage-3 `check_consistency` 阻塞校验。
- 写完 Application（stage-6）**必须真编译验证** `compile_passed=true`；只做静态 review 会触发 `compile_failed` retry。
- registerPush 成功后**必须**再调 `getRegistrationID`，并用固定关键字打印 `registrationID=`（`registration_id_logged=true`）；只打 `registerPush success` 不够，控制台接入测试拿不到 ID。
- 完成 stage-11 收尾追问才算交付——schema 要求 AI 提交 `follow_up_prompt_presented=true`。**呈现方式硬约束：一律用文本引导 + 用户自由回复，`follow_up_delivery=text_prompt`；禁止 AskQuestion / 结构化弹卡 / ABCD 菜单**（Cursor 端 AskQuestion 会先弹卡再让 AI 继续输出，把上面的交付物挤下去；测试里出现过「确认框抢在检测结果前面弹出」的问题）。输出 Q1（如有）+ Q2 后**同轮直接提交** `complete_workflow_step`，不等回复；`user_experience` 用户已明确表态填对应枚举，否则填 `not_collected`，后续经 `report_workflow_feedback` 补报。unavailable 分支必须**完整展开**管理员凭据配置指引（含 mcp.json 可复制 snippet + UserSig 两个链接），别只说一句「配了管理员凭据后自动验证」——参考 `references/push-server-onboarding.md`。
- **「后台 API 能力衔接段」全流程只讲一次**：stage-8 用 **2 行**说清（一行「配好管理员凭据后我可以直接帮你核对控制台证书 / 下载 timpush-configs.json / 代发三态测试推送」+ 一行自由回复引导），stage-10 只用 **1 行**回指，**禁止**在两个阶段各铺一遍 5 条能力清单（实测反馈：同一段介绍重复出现是聊天噪音主因）。5 条能力全清单、mcp.json snippet、UserSig 步骤只在用户主动问「怎么配 MCP / 能做什么」或 stage-11 unavailable 分支展开，副本见 `references/push-server-onboarding.md`。仍**禁止**只说一句「配了凭据我就能帮你 X」而完全不点明凭据是三个 MCP 环境变量。

---

## iOS 跨阶段红线

- **凭据落点（禁止 xcconfig / 禁止主 Info.plist 存机密）**：
  - Push：`TIMPushCredentials.swift`（ObjC：`TIMPushCredentials.h/.m`）。真值文件必须 `.gitignore`；仓内提交同名 `.example`（占位 `YOUR_*`）。
  - Chat：若 detect 已发现工程内 Chat 凭据（任意既有路径：源码常量 / 既有配置文件 / 既有 `ChatCredentials`），**一律不改用户文件**。若需要 Chat 登录凭据但工程内未发现，则新建 `ChatCredentials.swift`（或 `.h/.m`）+ `.example` + gitignore，**不要**再用 `timpush.local.xcconfig` / 新建 `Config.xcconfig` 写机密。
  - 用户提供了真值 → AI 写入 Credentials 真值文件；用户跳过 → 只落 example / `YOUR_*` 占位，并**明确提示要改的路径与字段名**。
  - **禁止**把 Push AppKey / Chat SecretKey / SDKAppID 真值写入主 `Info.plist` 或经 `INFOPLIST_KEY` 注入。
  - AppDelegate / 业务代码只引用 Credentials 符号；真值只能出现在 Credentials 真值文件（或用户既有 Chat 凭据文件）。
- Bundle ID 不能含通配符 `*`；Xcode / Apple Developer / 腾讯云 APNs 证书三处必须一致。
- `get_latest_timpush_version` 必须传 `platform: "ios"`；禁止把 Android changelog 版本写进 Podfile。
- stage-3 必须调用 `validate_ios_push_config`；`businessID` 可后补，但未就绪时必须进入 checklist，不能假装已完成。
- Apple Developer / 腾讯云上传证书是半自动门控：必须输出 checklist 并收集 `manual_apple_steps_done`，禁止静默跳过。
- Chat Key ≠ Push Key；IM 登录后场景 `registerPush` 传 `nil`/空字符串，不要传 Chat Key，也不要把 Push Key 当 Chat SecretKey。
- `mixed` 必须同时收集并归档 Chat（若工程尚无）与 Push（SDKAppID / Push 客户端密钥 / businessID）两侧信息；`standalone_push` 只收集 Push；`im_chat` 以 Chat 为准且 `registerPush` 的 appKey 传 nil，仍须配置 businessID。
- 已集成 Chat 再补 Push 时：Push 与 Chat 共用 SDKAppID，但 Push 客户端密钥 ≠ Chat 密钥。若 SDKAppID 变更，必须显式确认是否迁移 Chat 应用；**不得静默改**用户既有 Chat 凭据文件。
- registerPush 成功后**必须**再调 `getRegistrationID`，并用固定关键字打印 `registrationID=`（`registration_id_logged=true`）。succ 回调里的 `deviceToken` 是 APNs token，**不是** registrationID。同时必须打印 `>>>>> TIMPush registerPush success`（`register_push_success_logged=true`）；SDK 不保证输出该字面量。
- 不要自动改 `.pbxproj` 添加 Push Notifications / App Groups——只给 checklist（**XcodeGen 例外**：必须改 `project.yml` 的 `entitlements.path` + `entitlements.properties.aps-environment`，并把真实 Bundle ID / DEVELOPMENT_TEAM 写进 yml；禁止只写 path 导致 generate 把 entitlements 覆写成空 `<dict/>`）。空 entitlements / 未关联 `CODE_SIGN_ENTITLEMENTS` → 真机 `code=3000`「未找到 aps-environment」。`detect_ios_project` 的 `aps_environment_present` / `entitlements_file_empty` / `xcodegen_entitlements_wired` / 相关 warnings 非空时必须先修再 registerPush。
- 新建的 Credentials 源文件若未进 target，须提示用户加入 Compile Sources（或给出 XcodeGen 片段），不要 silently 假定已编译。
- registerPush 成功回调必须打印**两行**（固定前缀 `>>>>> TIMPush`）：`registerPush success` **以及** `registrationID=`（后者来自 `getRegistrationID`）。SDK **不会**默认打出字面量 `registerPush success`；只打 `registrationID=` 时须告知用户检索前缀，避免误判「没成功」。succ 的 `deviceToken` ≠ registrationID。
- **XcodeGen + CocoaPods**：若工程有 `project.yml`/`project.yaml`，`xcodegen generate` 会清掉 pbxproj 里的 `[CP] Check Pods Manifest.lock` / `Embed Pods Frameworks` 等脚本，也会清掉仅在 Xcode UI 添加的 Push Capability。顺序必须是 `xcodegen generate` → `pod install` → 打开 `.xcworkspace`。`detect_ios_project` 的 `uses_xcodegen` / `cocoapods_integration_broken` / entitlements 相关 `warnings` 非空时必须先复述并修复，再改 AppDelegate。编译报 `No such module 'TIMPush'` 时优先查 CocoaPods 脚本；真机报 `code=3000` 时优先查 entitlements。
- 完成 stage-11 收尾追问才算交付（同 Android follow-up 契约）。

---

## Flutter 跨阶段红线

- 走 `wizard-flutter` / `troubleshoot-flutter`，不要对 Flutter 根目录误跑纯 `wizard-android`。
- Android 子工程用 `project_kind: "flutter"` + `android_root: "<proj>/android"`；路径以 `path_profiles.flutter` 为准。
- **凭据落点**：
  - Android：`local.properties`（不变）。
  - Dart（registerPush 所用）：`lib/tim_push_credentials.dart`（gitignore）+ `lib/tim_push_credentials.example.dart`（提交，`YOUR_*`）。
  - iOS 原生：若需落 Chat 凭据且工程内未发现 → `ios/Runner/ChatCredentials.swift`（+ example + gitignore）；已发现则**不改**。**禁止** `timpush.local.xcconfig` / 主 Info.plist 存机密；**不要**调用 `apply_local_xcconfig`。
  - 用户给真值则写入；跳过则占位并明确提示路径。
- `registerPush` **禁止**写在 `main`；通知点击用 `addPushListener`，不要依赖即将废弃的 `onNotificationClicked` 业务逻辑。
- registerPush `code==0` 后**必须** `getRegistrationID` 并用 `debugPrint` 打出 `registrationID=`（`registration_id_logged=true`）；只验证非空不够。
- 目标端用 `route_key`（`android_only` / `ios_only` / `both`）经 `success_routes` 跳转；禁止用 `failure_routes` 伪装跳过。
- 完成路线图 stage 才算交付（同 Android follow-up 契约）。

---

## UniApp 跨阶段红线

- 走 `wizard-uniapp` / `troubleshoot-uniapp`，不要对 uni-app 根目录误跑纯 `wizard-android`。
- **插件导入门控**（stage-3）：必须 `plugin_imported=true`（const）；不能替用户在 HBuilderX 点「导入插件」。
- **自定义基座门控**（stage-7）：必须 `custom_base_acknowledged=true`；标准基座不含厂商通道，不能用来验离线推送。
- Android 检测用 `detect_android_project { project_kind: "uniapp" }`；路径以 `path_profiles.uniapp` 为准：
  - `timpush-configs.json` → `nativeResources/android/assets/`
  - 厂商 JSON（google-services、mcs 等）→ `nativeResources/android/`（**不在** assets）
- 编辑 `uni_modules/TencentCloud-Push/utssdk/app-android/config.json` 的 `dependencies` / `plugins` 按所选厂商。
- iOS：`nativeResources/ios/Resources/timpush-configs.json` **只写 businessID**（官方路径，非 AppKey）；Apple 证书步骤半自动门控。
- **凭据落点（禁止 xcconfig）**：
  - Push SDKAppID / AppKey：`push_credentials.js`（或 `.ts`，gitignore）+ `push_credentials.example.js`（提交）。
  - Chat：若 detect 已发现凭据 → **不改**；需要且未发现 → `chat_credentials.js`（+ example + gitignore）。
  - **禁止** `timpush.local.xcconfig` / 新建 `Config.xcconfig` 存机密；**不要**调用 `apply_local_xcconfig`；不要把 AppKey 写入 Info.plist。
- HBuilderX **避开 4.64 / 4.65**；TencentCloud-Push 建议 1.1.0+。
- registerPush 成功后**必须**再调 `getRegistrationID`，并用 `console.log('registrationID=' + ...)` 打印（`registration_id_logged=true`）；只打成功回调不够。
- 目标端用 `route_key` 经 `success_routes` 跳过未选端（如 `android_only` 跳过 stage-5 ios-configs）。
- 完成 stage-11 收尾追问才算交付（同 Android follow-up 契约）。

---

## Troubleshoot：零写入 + 逐步引导（硬）

适用于所有 `troubleshoot-*` workflow（含受控 fallback 下的排障）。**比 Wizard 更严**：Wizard 有计划确认闸口后可写文件；排障默认零写入。

### 写文件红线

- **禁止**写用户工程任何源文件 / `pbxproj` / `Podfile` / Gradle / Manifest / Dart / 凭据文件，除非用户本轮明确授权（「按方案改 / 可以改 / LGTM / 开干」等）。
- **允许不经确认**：只读搜代码、读文件、跑 detect / validate / 列假设、在回复里贴拟改 diff（不落地）。
- 怀疑源码 bug：输出「现象 → 证据 → 假设 → **拟改 diff（不落地）** → 问是否授权」；未获授权不得 `Write` / `StrReplace` / 改工程。
- fix-plan 阶段凡 `touches_files=true` 必须 `user_approval_required=true`，且须等用户确认后才能宣称「已修改工程」。

### 逐步提问（禁止清单轰炸）

- **本轮对用户最多问 1～2 个问题**，或只让用户做 **1 个**校验动作。
- 每个问题必须写清三要素：**怎么做**（具体操作）+ **期望看到什么**（日志关键字 / 界面）+ **做完回我什么**。
- **禁止**一次抛出 5+ 项「请你去查 Bundle ID / businessID / 证书 / 权限 / 控制台…」；其余项记内部 notes，下轮再问。
- stage-0 可在内部记录多字段，但**对用户呈现必须逐步**；未拿到本轮答案前不要跳到 fix 或改代码。

### API 边界（禁止混用）

- TIMPush 正道：`TIMPushManager.registerPush` + `TIMPushDelegate.businessID()`（及 `applicationGroupID` 等）。
- **禁止**把 AtomicX `LoginStore.setCertificateID` / AtomicXCore `PushManager` 当成 TIMPush `registerPush` 的替代或「缺的一步」。前者服务 AtomicX 内置 APNs/VoIP（含 CallKit）路径；用户工程已接 TIMPush 时不要推荐补 `setCertificateID`。
- 细节见 `cards/ios/atomicx-vs-timpush.md`（Android AtomicX 同类混淆同样适用该边界原则）。

## Troubleshoot：证据优先

先收集现象、配置证据、运行日志，再排序根因。

「用户填错 / 复制错 / 没配对」只能作为证据支持后的候选假设，**不能**作为默认第一响应。

尤其 RegistrationID / UserID 不存在这类控制台报错，必须先核对：

- `pushLogin success` / `APNs configuration success` / `deviceToken`
- `Set offline push token successfully` / `registerPush getToken`
- `business_id` / 证书 ID
- 控制台应用 SDKAppID
- APNs 开发/生产环境是否与安装包匹配

---

## HarmonyOS 跨阶段红线

- 走 `troubleshoot-harmony`；Flutter / uni-app 鸿蒙问题经对应跨端 workflow 下钻后，也必须进 `troubleshoot-harmony` 再过服务状态与系统形态门控。
- **先分系统形态**：纯血 HarmonyOS NEXT 走鸿蒙原生 Push 链路；Android 兼容模式回华为 AGConnect 链路（`flows/android/vendor-not-received.md` / `cards/android/vendor-huawei.md`），禁止混用两条链路的配置指引。
- **1000900010 / `Illegal application identity`** 是安装包身份与 AGC 登记不一致，不是 JS 代码问题：按 `flows/harmonyos/offline-not-received.md`「1000900010 排查清单」逐项核对（手动签名 → 包名四方一致 → Push Kit 开通后重申 Profile → 证书有效期 → `client_id` 写死 → 本地真机）。
- 客户端注册必须使用**客户端密钥**；服务端密钥用于 REST 下发，混用即配置错误。
- `registerPush` 成功后必须拿到非空 RegID / token；云真机不支持，必须本地真机验证。
- 发送回执 `80300002` 是服务端下发无权限（`cards/android/error-codes.md` 80300002 节），勿当作鸿蒙客户端注册失败。
- Flutter 鸿蒙 Push 当前为产品缺口：直接告知用户并走原生混合接入，不要在 Flutter 插件层反复尝试。

---

## 三态推送验证闭环（收尾契约）

任何一次 `send_test_push` 被调用后（无论在 wizard stage-10b 内、troubleshoot 内、还是用户后续说「帮我发一条测试推送」的独立场景），**必须**在用户表示结束、验证完成或不继续时按下面收尾：

1. **先调 `check_test_push_complete { to_account }`**——它是唯一的「测完了没」权威口径（依据 `session-store.js` 的三态账本）。禁止靠 AI 自己回忆脑补三态哪个跑了。
2. **再给用户输出三态总结**，逐条显式标记 ✅ 通过 / ❌ 未通过 / ⏭️ 跳过（引用工具返回的 `progress`）；未通过的态**先讲 `trace_push` 得到的第一环失败原因**，再让用户决定是否排查。
3. **最后写明结论**：一句话「本次验证到此结束」（三态收尾）/「还差 X 未验，随时回来说『帮我验证推送』」（部分收尾）/「验证被中止」（用户主动中止）。禁止不给结论就默默停下——历史上出现过「用户回『收到了』之后 AI 直接沉默、流程不了了之」的案例。
4. `confirm_test_push` 收到最后一个待测态时会返回 `_completion_hint`，触发该 hint 时**必须**当轮做完上面 1-3；不得延后到下一轮。

以上适用于 wizard 与 troubleshoot 的所有平台，也适用于用户在向导外的 ad-hoc 测试请求。

---

## 用户结果反馈上报（user_resolution / user_experience）

- `user_resolution` 与 `user_experience` 都是**用户显式反馈**，不是 AI 自评。
- `user_resolution`（troubleshoot 终局必填；wizard 只经 `report_workflow_feedback` 上报）：`resolved`（已解决）/ `unresolved`（未解决）/ `partial`（部分解决）/ `deferred`（稍后再验证）/ `not_collected`（未反馈）。终局上报时写入 `workflow_finished`。
- `user_experience`（wizard 终局体验）：`smooth`（顺畅）/ `usable_with_friction`（有卡顿但走完）/ `blocked`（卡住）/ `not_collected`。schema 中为 optional：**所有 IDE 一律用文本引导 + 自由回复呈现**（不弹卡），输出后同轮直接提交，用户已在本轮明确表态就填对应枚举，否则填 `not_collected` 并让用户后续经 `report_workflow_feedback` 补报。
- **禁止**把 `verification_status`（AI 自评）复制到 `user_resolution`；两字段必须独立。
- **禁止**在无用户明确选择时填 `resolved` / `unresolved` / `partial` / `smooth` / `usable_with_friction` / `blocked`；此时必须填 `not_collected`。
- 用户说「稍后再验证」「先这样」→ `deferred`，不算失败，不再追问。
- 用户未表态、AI 忘了问 → `not_collected`，不算失败，不影响 `completed` 状态。
- **回告必报**：workflow 终局后用户回告验证结果或体验（「验证通过了」「杀进程收不到」「流程很顺」等）时，**必须先调 `report_workflow_feedback`**（带上仍记得的 `run_id` / `workflow_id`），再按结果路由——`unresolved` / `partial` 进对应平台 troubleshoot，`resolved` 礼貌收尾。
- 若 `complete_workflow_step` 因旧版 MCP 不含 `user_experience` 字段报 schema_violation，去掉该字段重试即可，不要反复重试。

---

## Schema 缺口

若发现某条红线在 engine 的 schema 里漏了：**不要自己补流程**，向用户反馈「workflow 文档需要升级」。

