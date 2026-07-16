# TIMPush workflow 硬约束（L2）

> **何时读**：进入 `wizard-android` / `troubleshoot-android` / `wizard-ios` / `troubleshoot-ios` / `wizard-flutter` / `troubleshoot-flutter` / `wizard-uniapp` / `troubleshoot-uniapp`（首次 `get_workflow_state` 之前）必须 Read 本文件一次；同会话后续 turn 不必重复读，除非用户换了新的 workflow run。  
> **冲突处理**：若本文件与 engine schema 冲突，以 engine schema 为准，并向用户说明「workflow 文档需要升级」，不要自行补流程。


---

## 厂商差异来源

`fetch_vendor_setup_guide` 同时返回文档解析结果与 `integration_requirements`。

- Android 7 厂商：以 MCP `fetch_vendor_setup_guide` 返回的 `integration_requirements` 为准。
- iOS / Apple APNs：以 MCP 返回的 Apple / APNs `integration_requirements` 为准。

**不要**从 `vendor-*.md` 长文档临场抽取这些机器可判定差异。

---

## Android 跨阶段红线

- 凭据**只**进 `local.properties`，源码 / Gradle 字面量都不行（engine 在 stage-4/6 用 schema 拒收）。
- 厂商工程差异以 `fetch_vendor_setup_guide.integration_requirements` 为准；stage-5/8 必须按 selected vendors 输出并校验，不允许只靠通用文案跳过小米 / OPPO / vivo / 荣耀 / 魅族 / FCM 差异。
- Chat / IM `SDKAppID` 与 `TIMPUSH_SDK_APP_ID` 必须一致；不一致 engine 在 stage-3 → `advanced_to_failure`。
- 包名一致性（工程 `applicationId` vs 厂商控制台填的包名）由 stage-3 `check_consistency` 阻塞校验。
- 写完 Application（stage-6）**必须真编译验证** `compile_passed=true`；只做静态 review 会触发 `compile_failed` retry。
- registerPush 成功后**必须**再调 `getRegistrationID`，并用固定关键字打印 `registrationID=`（`registration_id_logged=true`）；只打 `registerPush success` 不够，控制台接入测试拿不到 ID。
- 完成 stage-10 才算交付——engine 强制 `follow_up_prompt_presented=true`，不允许 AI 默默停下。Cursor 可用 AskQuestion；Claude Code / CodeBuddy 等无等价 UI 时输出编号选项并等待用户选择。

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
- 完成 stage-10 才算交付（同 Android follow-up 契约）。

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
- 完成 stage-10 才算交付（同 Android follow-up 契约）。

---

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

## Schema 缺口

若发现某条红线在 engine 的 schema 里漏了：**不要自己补流程**，向用户反馈「workflow 文档需要升级」。

