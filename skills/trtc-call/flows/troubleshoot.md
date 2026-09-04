# flows/troubleshoot — Call Flutter 问题排查

> **触发条件**：用户报告 Call Flutter 集成后的运行时错误 / 崩溃 / 功能异常。
> 由 `SKILL.md` Step 2 在 `intent = troubleshoot` 或 `kind = symptom_like` 时分派。

---

## 步骤

### T1 — 读报错速查表

Read `playbooks/integration-reference.md`。

用 §常见报错速查 的每一行的"报错 / 现象"列对用户描述做 **字面 / 语义匹配**：

- **命中 `-1002 errSdkNotInitialized`** 且 session
  `phase7_3_auth_decision ∈ {manual, already-done}` →
  执行 `flows/basic-call.md §7.3-⑥`（重新扫描完整认证生命周期）再 STOP。
- **命中其他条目** → 按对应"解决"列的步骤回答，STOP。
- **未命中** → 进入 T2。

### T2 — 收集诊断信息

若速查表未命中，用普通对话追问以下信息（一次问完，不要分多轮）：

1. **复现场景**：debug / release / simulator / 真机？iOS 版本？Android 版本？
2. **错误完整内容**：报错文字 / 日志 / 崩溃截图（尽量完整，不要只贴一行）
3. **集成状态**：`flutter analyze` 有没有 error？`flutter pub get` 是否正常完成？
4. **已尝试**：用户自己试过哪些方法？

收到回复后回 T1 重新匹配（更完整的信息可能命中之前遗漏的行）；若仍未命中进入 T3。

### T3 — 分层排查

按以下顺序检查，每层给用户一个具体操作：

| 层 | 检查点 | 操作 |
|---|---|---|
| 依赖 | `flutter pub get` 是否完成 | 重跑并观察输出 |
| 平台配置 | iOS Podfile / Xcode deployment target；Android minSdk | 对照 `integration-reference.md §iOS 配置` 和 `§Android 配置` 逐项核查 |
| 权限 | Info.plist / AndroidManifest 权限声明 | 对照速查表里的权限相关行 |
| MaterialApp / CupertinoApp | App 内 `navigatorObservers` + `localizationsDelegates` | 对照 `integration-reference.md §App 入口适配矩阵` |
| MaterialApp.router + GoRouter | App 内 delegates + `GoRouter.observers` | 禁止给 `MaterialApp.router` 添加 `navigatorObservers` |
| SDK 初始化顺序 | `loginWithSig` 是否在订阅 `loginEventStream` 之后调用 | 检查 `call_service.dart` 内部实现 |
| 代码版本 | 是否用了旧版 API（`TUICallMediaType` / `result.code` 等）| 对照速查表 §Dart API |

每层排查后如果问题解决，STOP 并告知用户哪一层是根因（供后续补充到 integration-reference.md）。

### T4 — 未解决时的兜底

若 T1–T3 均未解决：

1. 告知用户这是目前 integration-reference.md 未覆盖的新问题
2. Read `../../trtc-sdk-log-analysis/SKILL.md`，按平台、产品和时间窗口生成手动导出指引，并让用户上传或把日志放入工作区
3. 如果仍是 iOS native 层崩溃，再补充 Xcode Organizer → View Device Logs → Runner 崩溃 → Thread 0 调用栈，并建议带 SDK 版本、iOS 版本和复现步骤提腾讯云工单

---

### T5 — 排障结束出口

每层排查完成（T1 命中 / T3 某层解决 / T4 引导完毕）后，`AskUserQuestion`：

> 问题解决了吗？

| # | label | 动作 |
|---|---|---|
| 1 | 解决了，继续 | 读 `troubleshoot_return_flow` 字段，按下表路由 |
| 2 | 还没解决，继续排查 | 回 T2 补充信息 |
| 3 | 先放着，以后再说 | 写 `active_flow = playbook-done`，STOP |

**`troubleshoot_return_flow` 路由表**：

| 字段值 | 动作 |
|---|---|
| `playbook-done` | 写 `active_flow = playbook-done`，Read `flows/basic-call.md` §Phase 7.6 |
| `demo-experience` | 写 `active_flow = demo-experience`，Read `flows/demo-experience.md` 从上次 Phase 续接 |
| `phase6` | 写 `active_flow = basic-call`，Read `flows/basic-call.md` §Phase 6（重跑 verify）|
| 字段不存在（从 SKILL.md 直接进入）| 写 `active_flow = playbook-done`，进 §Phase 7.6（若有活跃集成 session）或告知"排障完成，随时可继续集成"|

---

## 适用范围

本 flow 仅处理 **Call Flutter 集成后的运行时问题**：

- ✅ iOS / Android 启动崩溃
- ✅ 来电界面不弹 / 文案异常
- ✅ 通话建立失败 / 无声 / 黑屏
- ✅ `flutter analyze` / `flutter run` 报错

不适用：
- ❌ 基础集成问题（用户还没跑通 Phase A → Phase 7）→ 回 `flows/basic-call.md`
- ❌ TRTC 产品事实性问题（价格 / API 用法 / 错误码释义）→ `trtc-docs`
