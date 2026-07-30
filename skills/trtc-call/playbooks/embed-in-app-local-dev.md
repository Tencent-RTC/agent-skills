# playbook: embed-in-app (q1 = local-dev)

> **触发条件**：`form = embed-in-app` AND `q1_usersig_source = local-dev`。分派逻辑在 `SKILL.md`。
>
> **本文件性质**：指令 recipe。**禁止内嵌代码块**——所有代码来自 `templates/`。AI 只
> 执行 INSTALL / PATCH / REPLACE / APPEND 四种动词，不生成代码。
>
> **执行时机**：AI 在 SKILL.md 的 Phase 5（apply）阶段读本文件并执行"代码"段；
> Phase 2b（平台配置 apply）阶段读本文件并执行"平台配置"段。其它阶段不 Read 本文件。
> 实际执行范围必须再与当前阶段已确认的 `.trtc-call/*-apply-plan.json` 取交集；
> playbook 有步骤但 plan 未列为 `planned` 时禁止执行。

---

## 代码段（Phase 5 apply 时执行）

| # | 动词 | 目标 | 源 / 参数 | 条件 |
|---|---|---|---|---|
| 1 | INSTALL | `lib/trtc_call/trtc_call_bootstrap.dart` | `templates/lib/trtc_call/trtc_call_bootstrap.dart` | 无条件 |
| 2 | INSTALL | `lib/trtc_call/call_service.dart` | `templates/lib/trtc_call/call_service.dart` | 无条件 |
| 3 | INSTALL | `lib/trtc_call/call_button.dart` | `templates/lib/trtc_call/call_button.dart` | 无条件 |
| 4 | INSTALL | `lib/debug/generate_test_user_sig.dart` | `templates/lib/debug/generate_test_user_sig.dart` | 无条件（本 playbook 专属） |
| 5 | PATCH | `lib/main.dart` @ `main()` 函数体第一行 | 若 `main()` 是 `async`（`void main() async` / `Future<void> main()`）且第一行不是 `WidgetsFlutterBinding.ensureInitialized()`，插入该调用 | `WHEN main() is async` |
| 6 | PATCH | `lib/main.dart` @ 顶部 import 区 | 插入 `templates/snippets/main-dart/import-local-dev.dart` 内容 | 无条件（本 playbook 专属） |
| 7D | PATCH | `lib/main.dart` @ `runApp(...)` 调用处 | `templates/snippets/main-dart/runapp-local-dev.dart` | `WHEN app_entry_variant ∈ {material-app, cupertino-app}` |
| 7R | PATCH | `lib/main.dart` @ `runApp(...)` 调用处 | `templates/snippets/main-dart/runapp-local-dev-router.dart` | `WHEN app_entry_variant = material-router-go-router` |
| 8D | PATCH | `lib/main.dart` @ `class MyApp` 字段区 | `templates/snippets/main-dart/myapp-fields.dart` | `WHEN app_entry_variant ∈ {material-app, cupertino-app}` |
| 8R | PATCH | `lib/main.dart` @ `class MyApp` 字段区 | `templates/snippets/main-dart/myapp-fields-router.dart` | `WHEN app_entry_variant = material-router-go-router` |
| 9D | PATCH | `lib/main.dart` @ MyApp 构造函数命名参数 | `templates/snippets/main-dart/myapp-constructor-params.dart` | `WHEN app_entry_variant ∈ {material-app, cupertino-app}` |
| 9R | PATCH | `lib/main.dart` @ MyApp 构造函数命名参数 | `templates/snippets/main-dart/myapp-constructor-params-router.dart` | `WHEN app_entry_variant = material-router-go-router` |
| 10D | PATCH | `lib/main.dart` @ App 参数区 | `templates/snippets/main-dart/materialapp-params.dart` | `WHEN app_entry_variant ∈ {material-app, cupertino-app}` |
| 10R | PATCH | `lib/main.dart` @ `MaterialApp.router(` 参数区 | `templates/snippets/main-dart/materialapp-router-params.dart` | `WHEN app_entry_variant = material-router-go-router` |
| 10G1 | PATCH | `<go_router_config_file>` @ import 区 | `templates/snippets/go-router/import.dart` | `WHEN app_entry_variant = material-router-go-router` |
| 10G2 | PATCH | `<go_router_config_file>` @ `GoRouter(` 参数区 | 合并/追加 `templates/snippets/go-router/observers.dart` | `WHEN app_entry_variant = material-router-go-router` |
| 11 | APPEND | `pubspec.yaml` @ `dependencies:` 段末 | `templates/snippets/pubspec/shared.yaml` | 无条件 |
| 12 | APPEND | `pubspec.yaml` @ `dependencies:` 段末 | `templates/snippets/pubspec/local-dev.yaml` | 无条件（本 playbook 专属） |

### 顺序约束

- 4 个 INSTALL（步骤 1-4）可任意顺序执行
- 步骤 5-10（main.dart PATCH）必须按当前 app_entry_variant 选 D 或 R 分支并顺序执行
- GoRouter 分支步骤 10G1-10G2 在 main.dart 分支完成后执行
- 步骤 11-12（pubspec APPEND）与 main.dart 系列独立

### pubspec APPEND 幂等规则

步骤 11-12 执行前，逐 key 检查目标文件是否已存在：

```bash
grep -q "tencent_calls_uikit:"  pubspec.yaml && echo "skip" || echo "append"
grep -q "flutter_localizations:" pubspec.yaml && echo "skip" || echo "append"
grep -q "crypto:"               pubspec.yaml && echo "skip" || echo "append"
```

已存在的 key **跳过**（告知用户"已有 `<key>`，跳过"）；不存在才追加，追加时必须使用以下**精确内容**（不得让 Agent 自行选择版本）：

```yaml
  tencent_calls_uikit: ^5.0.0
  flutter_localizations:
    sdk: flutter
  crypto: ^3.0.7
```

逐 key 处理，不是整段跳过。

### 步骤 5 补充说明（`WidgetsFlutterBinding.ensureInitialized()`）

遵循 Flutter 最佳实践：`async main()` 中所有需要 platform channel 的 SDK（Firebase / Supabase / SharedPreferences 等）都要求调用方在调用前先做 binding 初始化，TrtcCallBootstrap 不例外。

- `main()` 是 `async` 且第一行已经是 `WidgetsFlutterBinding.ensureInitialized()` → 跳过本步
- `main()` 是 `async` 且第一行不是 → 在函数体第一行插入 `WidgetsFlutterBinding.ensureInitialized();`
- `main()` 不是 `async`（同步 main）→ 跳过本步（同步 main 不需要）

### 步骤 7D/7R 补充说明

用户 `main()` 里的 `runApp(...)` 常见形态：`runApp(MyApp());` / `runApp(const MyApp());` /
`runApp(MaterialApp(...))`（即用户没写 MyApp 而直接 runApp MaterialApp）。

- 前两种形态：直接文本替换整个 `runApp(...)` 语句为 snippet 内容
- 第三种形态（无 MyApp 类）：**停下告知用户**"你的 main.dart 没有把 App 抽成一个类，
  Builder 注入需要一个 App class 作为 builder 返回体。建议你先把 MaterialApp 抽成
  `class MyApp extends StatelessWidget` 再重试。"，禁止硬 patch。

### 步骤 9D/9R 补充说明

MyApp 构造函数可能形态：`const MyApp({super.key})` / `const MyApp({Key? key}) : super(key: key)` /
`MyApp(this.foo)` 等。追加位置：在最后一个 named param 之后（保持 `super.key` 在最前，
新增字段追加到末尾）。若是 positional-only 构造函数（如 `MyApp(this.foo)`），**停下告知用户**
"你的 MyApp 构造函数使用位置参数，建议改为命名参数以便集成 TRTC。"，禁止硬 patch。

### 步骤 10D/10R/10G 补充说明

标准 `MaterialApp` / `CupertinoApp` 已有参数时：
- 有 `localizationsDelegates: [foo, bar]` → 改为 `localizationsDelegates: [foo, bar, ...trtcDelegates]`
- 有 `navigatorObservers: [obs1]` → 改为 `navigatorObservers: [obs1, ...trtcObservers]`
- 无 `supportedLocales` → 追加 snippet 中的 `supportedLocales` 行
- 有 `supportedLocales` → 保持用户原值不动（TUICallKit 支持任意 locale）

`MaterialApp.router + GoRouter`：
- `MaterialApp.router` 只合并 `localizationsDelegates` / `supportedLocales`，严禁添加 `navigatorObservers`
- 定位 `routerConfig:` 引用的 `GoRouter(...)` 定义文件并写入 session `go_router_config_file`
- GoRouter 已有 `observers: [obs1]` → 改为 `[obs1, TUICallKit.navigatorObserver]`
- 无 `observers` → 追加 `observers: [TUICallKit.navigatorObserver]`
- 已有 `TUICallKit.navigatorObserver` 或对应 import → 各自跳过，保证重复执行幂等
- 找不到唯一 GoRouter 定义、使用 AutoRoute/自建 RouterDelegate、或为 `CupertinoApp.router` → fail-fast，
  禁止执行代码段

---

## 平台配置段（Phase 2b apply 时执行）

按 `q3_media_type` 分支裁剪：`q3 = audio` 不执行相机相关步骤。

| # | 动词 | 目标 | 源 / 参数 | 条件 |
|---|---|---|---|---|
| P1 | APPEND | `ios/Runner/Info.plist` @ 顶层 `<dict>` 内 | `templates/snippets/ios/info-plist-audio.xml` | 无条件 |
| P2 | APPEND | `ios/Runner/Info.plist` @ 顶层 `<dict>` 内 | `templates/snippets/ios/info-plist-camera.xml` | `WHEN q3 ∈ {video, both}` |
| P3 | APPEND | `android/app/src/main/AndroidManifest.xml` @ `<manifest>` 内 | `templates/snippets/android/manifest-audio.xml` | 无条件 |
| P4 | APPEND | `android/app/src/main/AndroidManifest.xml` @ `<manifest>` 内 | `templates/snippets/android/manifest-camera.xml` | `WHEN q3 ∈ {video, both}` |
| P5 | PATCH | `android/app/build.gradle` @ `android { defaultConfig { ... } }` | 按 `templates/snippets/android/gradle-min-sdk.groovy` 内注释规则确保 `minSdkVersion ≥ 21` + `multiDexEnabled true` | 无条件 |

### 平台配置跳过策略

Phase 2a 若用户明确"跳过 X 平台"（session `skipped_platform_configs` 含对应文件），
本表中该文件的所有步骤跳过；Phase 6 verify 时明确标注"这些平台文件未完成"。

### 未在本 playbook 覆盖的平台改动（用户手动）

以下 3 处由 SKILL.md Phase 2a 明确告知用户手动处理，playbook 不落 apply 指令：

- `ios/Runner.xcodeproj/project.pbxproj`：`IPHONEOS_DEPLOYMENT_TARGET ≥ 14.0`，已有更高版本保持不变（用 Xcode 图形界面改）
- `ios/Podfile`：详见 `playbooks/integration-reference.md §iOS 配置`（单一来源；platform 至少 14.0，禁止强制覆盖所有 Pods）
- **iOS Podfile 修改后必须 `cd ios && pod install`**（SKILL.md Phase 2a 提醒用户）

---

## local-dev 凭证注入

两个 runapp snippet 固定使用 `int.fromEnvironment('TRTC_SDK_APP_ID')` 与
`String.fromEnvironment('TRTC_SECRET_KEY')`。禁止把实际 SDKAppID / SecretKey 替换进
`lib/main.dart`、session 或其它项目文件。Phase 7 指导用户在本地通过 `--dart-define`
注入；生产必须改走后端 UserSig。

---

## 与 backend playbook 的差异

本文件是 `embed-in-app-local-dev.md`。对应的 `embed-in-app-backend.md` 差异：

- backend 当前版本仅提供官方服务端 UserSig 文档指引，不生成代码、不修改项目
- 步骤 6 引用纯公共 `import.dart`，不 import 测试签名类
- 步骤 7D/7R 引用对应的 backend runapp snippet，不初始化测试签名类
- 无步骤 12（pubspec 不加 `crypto` 依赖）

其余标准/GoRouter 分支与平台配置段遵循相同入口矩阵。

---

## verify 覆盖（`tools/verify_embed_in_app.py --variant local-dev`）

按本 playbook 步骤反向 grep：
- 每个 INSTALL 目标文件存在
- `lib/main.dart` grep `GenerateTestUserSig.sdkAppId`、`GenerateTestUserSig.secretKey`、
  `TrtcCallBootstrap.run(`、`trtcDelegates`
- 标准 App：`lib/main.dart` 仅一次合并 `trtcObservers`
- GoRouter：`MaterialApp.router` 不含 `navigatorObservers`；GoRouter 配置仅一次包含
  `TUICallKit.navigatorObserver`
- `pubspec.yaml` grep `tencent_calls_uikit:`、`crypto:`
- `lib/main.dart` 必须包含 `int.fromEnvironment('TRTC_SDK_APP_ID')` 与
  `String.fromEnvironment('TRTC_SECRET_KEY')`，且不得把 SecretKey 字面量赋给
  `GenerateTestUserSig.secretKey`
- 平台配置 grep 对应权限声明（按 `q3` 分支裁剪 grep 表达式）
