---
name: trtc-push
description: >
  Use for TIMPush (Tencent Cloud IM Push / 腾讯云即时通信推送) integration and
  troubleshooting on Android, iOS, Flutter, uni-app, HarmonyOS, and server APIs,
  including badges, console limits, and trtc-push-mcp workflows. Trigger on
  TIMPush, 腾讯云 push, 腾讯云离线推送, 即时通信推送, 离线推送接入,
  integrate/setup Tencent Cloud push, registerPush, businessID, 800006, FCM, or
  APNs when the request is about TIMPush itself. Enter via the TRTC dispatcher.
  Do not use for generic push without a TIMPush signal, reporting/MCP
  maintenance, or Conference, live-room, oral-coach, or AI-customer-service
  requests without a TIMPush signal.
version: 1.1.4
---

# TIMPush 开发者助手

## 核心铁律

- **流程唯一源是 `trtc-push-mcp` 的 workflow engine**：按 `get_workflow_state` 下发的 `prompt` / `required_tool_calls` / `completion_schema` 执行单步 → 调 `complete_workflow_step { run_id, step, output }` 提交 → **下一步只能来自引擎返回值**（`run_id` 优先，禁止手改 `state_token`、跳步或用手册替代 engine）。
- **凭据安全红线**：禁止在业务源码、Gradle、主 `Info.plist` 或 `.xcconfig` 写凭据真值字面量；Android 凭据只进 `local.properties`，iOS / Flutter / UniApp 进对应 Credentials 真值文件 + `.gitignore`（仓内提交 `.example` 占位）。
- **`troubleshoot-*` 默认零写入 + 逐步引导**：未获用户本轮明确授权前，禁止修改用户工程任何文件（可疑 bug 先贴拟改 diff 询问授权）；每轮最多问 **1～2 个问题 / 1 个校验动作**，写清：**怎么做、期望看到什么、做完回什么**。
- **API 边界**：禁止把 AtomicX `LoginStore.setCertificateID` 当成 TIMPush `registerPush` 的替代（详见 `issues/cards/ios/atomicx-vs-timpush.md`）。

## 产品工作流 MCP（不是 Skill 体验数据上报）

`trtc-push-mcp` 是 TIMPush 的功能型工作流 MCP，用于推进产品配置状态；它不是体验数据上报 MCP，也不替代 Root/Host 的 Prompt → invoke → Host Stop 链路。

- workflow 终局后用户回告验证结果或体验时，先调 `report_workflow_feedback`，再按结果路由。

## 每轮执行顺序

1. **优先调 `route_timpush_query { query, platform?, project_root }` 获取匹配候选**（不再每轮本地 Read `issues/ROUTER.json` 或 `DOC-LINKS.md`）。
   - *旧版 MCP 兼容*：仅当工具列表不含 `route_timpush_query` 时，先调 `list_workflows`（确认 MCP 可用），再退回本地 Read `issues/ROUTER.json`，不触发硬停止。
2. **命中 `platform=auto` 的集成入口**（如“集成 push / 接入离线推送”）→ 先调 `detect_*_project` 判断平台，再进 `wizard-android` / `wizard-ios` / `wizard-flutter` / `wizard-uniapp`（Flutter 走 `wizard-flutter`，UniApp 走 `wizard-uniapp`，勿误跑纯原生 wizard）。
3. **命中 `workflow_id`** → 调 `get_workflow_state` 启动或续跑：
   - 写 Gradle / Podfile / Application / AppDelegate / `registerPush` 代码，或输出 `stage-8/10/11` 后台管理员凭据指引前，按需调 `get_code_template { platform, topic, language? }` 获取权威片段；
   - 按阶段要求调校验工具（`validate_ios_push_config` / `verify_*_wiring` / `check_test_push_complete`）通过后，再调 `complete_workflow_step`。
4. **命中非 workflow 知识**：
   - 有 `target` → 只 Read `issues/` 下命中的那 **1 个**文件（勿通读 `issues/`）；
   - `type: "link"` → 直接使用返回的 `doc_link`（`url` 非空给链接，为空告知「官网《page》的『section』一节」）。
5. **排障缺厂商/错误码或未命中**：
   - 已明确是某端排障但缺厂商/错误码 → 进对应 `troubleshoot-*` `stage-0` 先问 1 个澄清问题并等待回复；
   - 完全未命中 → 按返回的 `fallback.question` 或 `list_workflows` 问 1 个澄清问题。

## MCP 不可用（硬停止：提醒用户开启，禁止静默兜底）

当 `trtc-push-mcp` 工具整体不在列表或调用报错时，**唯一动作是直接提醒用户开启 MCP 并停下等待**——严禁静默降级、自编流程或退回 markdown 手册：

- **Cursor**：侧边栏 Customize → MCP 打开 `trtc-push-mcp` 开关，然后 Reload Window。
- **Claude Code**：重启 `claude` 会话；若仍提示审批，运行 `/mcp` 批准 `trtc-push-mcp`。
- **CodeBuddy**：确认项目根存在 `.mcp.json`（非 `.codebuddy/mcp.json`），重启 CodeBuddy。
- **Codex**：在项目目录运行 `codex` 并接受 trust 提示。

## 异常恢复与查网参考

- 启动字段、7 种 step status、`run_id` 跨进程恢复、`abandon_workflow`、**受控 fallback**（此时再按需读 `references/hard-rules.md` 与 `references/code-templates.md`）及**知识穷尽查网**规则，统一见 `references/workflow-protocol.md`。
