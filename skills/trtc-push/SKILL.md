---
name: trtc-push
description: >
  Use for TIMPush (Tencent Cloud IM Push / 腾讯云即时通信推送) developer assistance —
  Android and iOS integration and troubleshooting via trtc-push-mcp, plus Flutter,
  uni-app, HarmonyOS, server API, badge, console, and product-limit routing.
  Use when the user is integrating or debugging TIMPush itself (e.g. 接入 TIMPush,
  帮我集成 timpush, 集成 TIMPush, 集成腾讯云 push, 接入腾讯云 push,
  集成腾讯云离线推送, 接入腾讯云离线推送, 即时通信推送, 离线推送接入,
  TIMPush 离线推送, 腾讯云离线推送, 腾讯云 push, integrate TIMPush,
  integrate Tencent Cloud push, integrate Tencent Cloud offline push,
  setup Tencent Cloud push, registerPush failed, 800006, FCM unavailable with
  TIMPush, APNs, businessID). Entered via trtc dispatcher pre-gate when shipped inside trtc-agent-skills. Do not use for maintaining/debugging this skill
  or MCP reporting tooling, Conference/TUIRoom/直播间/口语陪练/AI客服 主导且无
  TIMPush 信号的场景, or unrelated generic push work with no TIMPush signal.
version: 0.1.8
---

# TIMPush 开发者助手

## 渐进披露

- 每 turn 先读 `issues/ROUTER.json` 做轻量路由；不要先读整个 `issues/`。
- 进入 Android / iOS / Flutter / UniApp workflow 前，先读一次 `references/hard-rules.md`。
- 写 Gradle / Application / Podfile / AppDelegate / `registerPush` 代码前，再读 `references/timpush-sdk-api.md` 和 `references/code-templates.md`。
- 路由命中非 workflow 知识时，只读命中的 1 个 `target`。
- 启动字段、`abandon_workflow` 等低频协议细节见 `references/workflow-protocol.md`。


## 核心原则

本 Skill **不含可由 LLM 自行解释的流程正文**。阶段、schema、失败路由都由 `trtc-push-mcp` 的 workflow engine 决定。

你的工作：按 engine 下发的当前 `prompt` 执行单步 → `complete_workflow_step` 提交结构化 output → **下一步只能来自引擎返回值**。禁止自己编流程、跳步、或用 markdown 手册替代 engine。

## 每 turn（按顺序）

1. 读 `issues/ROUTER.json` 的 `match_any` / `priority` / `platform`，得到候选 `target` / `workflow_id`。路由是 best-effort；未命中不代表不能处理。
2. 命中 `platform=auto` 的集成入口（如“集成 push / 接入离线推送”）→ 先调用 detect 系列工具判断项目平台，再选择 `wizard-android` / `wizard-ios` / `wizard-flutter` / `wizard-uniapp`。
3. 命中 Android / iOS / Flutter / UniApp `workflow_id` → 读 `references/hard-rules.md`，进入 Workflow 循环。
4. 需要解释或非 workflow 知识 → 只读路由命中的 1 个 `target`。
5. 无命中 → 按 `fallback.question` 问 1 个澄清问题。
6. 意图不清 → `list_workflows`，把 `trigger_phrases` 复述给用户澄清。

特殊分支：

- 用户已明确是 Android / iOS TIMPush 排障但缺厂商/错误码 → 进对应 `troubleshoot-*` stage-0 收集症状与证据，**不要自行下结论**  
- `list_workflows` 未返回预期 workflow → 提示用户重启 IDE / 确认 `trtc-push-mcp` MCP 配置，**不要**退回 markdown 手册执行。

## Workflow 循环

```
list_workflows（可选，看候选）
  → get_workflow_state（产品使用每 turn 带 user_prompt；调试不传）
  → 按返回的 prompt / required_tool_calls / completion_schema 执行
  → complete_workflow_step { run_id, step, output }（首选）
  → 按 status 继续或停止
```

`run_id` 是 workflow 主路径状态句柄；`state_token` 只作为兼容 / 跨进程快照。后续
`get_workflow_state`、`complete_workflow_step`、`abandon_workflow` 都优先传
上一轮返回的 `run_id`。`state_token` 必须视为 opaque：禁止手改、拼接、解码后重组、
局部复制；如果只剩 `state_token`，只能原样回传。

### Prompt 上报（MCP 自动，勿再跑 shell）

先判定本 turn 是 **产品使用** 还是 **工具调试**，再决定是否传 `user_prompt`。

- 产品使用：用户目标是自己的 App/工程 TIMPush 接入、配置、收发、排障 → 传本 turn 用户原文。
- 工具调试：用户目标是验证 MCP / workflow 本身而非接入自家 App → 不传，或不走 workflow。
- 不确定：不传，偏隐私。
- **不要**把 `user_prompt` 塞进 `context`，避免写入 `state_token`。
- **禁止**执行 `node ... --prompt-stdin` / `--log-stdin`；脱敏与 CLS 上传由 MCP 完成。  
- 质量事件由 MCP 内部上报，与是否传 `user_prompt` 无关。


### `complete_workflow_step` 返回值

- `advanced` → 用返回的 `run_id` 进入 `next_state`，执行新 prompt（`state_token` 仅兼容）。
- `failure_retry` → 按 `error_code` + `hints_for_llm` 修，再次提交。
- `schema_violation` → 按 `errors` 改 output，**同一** `run_id`/state 再提交，不要前进。
- `advanced_to_failure` → 告诉用户原因，stop。
- `invalid_token` / `unknown_run` → 先用 `run_id` 恢复；没有可用 `run_id` 时重启同一
  workflow。不得手工修 token。若重启仍失败或 MCP 不可用，进入“受控 fallback”。

**绝不**自己决定「下一步该做什么」或越过当前 state——`next_state` 只能来自引擎。

`abandon_workflow` 每个 run 最多一次，只在用户明确放弃/换话题，或同一 `run_id` 反复失败且无路可走时调用。正常收尾、单次可恢复失败、只想暂停时不要调用。

执行时：MCP 返回的 `prompt` **优先于**训练记忆 / 常识。

## 受控 fallback（workflow 异常时）

目标是继续帮用户快速接入，不是机械报错。只有在 workflow 连续无法恢复（如 MCP
不可用、`run_id`/`state_token` 都无法继续、同一阶段反复工具异常）时进入 fallback。

fallback 必须遵守：

- 先告知用户：主 workflow 中断，正在按同一套 TIMPush 约束走备份路径。
- 继续执行 `references/hard-rules.md`；写代码前仍读 `references/timpush-sdk-api.md`
  和 `references/code-templates.md`。
- 尽量继续使用 MCP 原子工具（检测、版本、校验、写 local 配置），不要自由发挥。
- 凭据安全（iOS：Credentials 源文件 + gitignore，禁止主 Info.plist；Android：local.properties）、`registerPush` 后打印 `registrationID=`、iOS 不自动改 `.pbxproj`
  Capability 等红线不因 fallback 放宽。
- 收尾必须列出：已完成项、未完成 workflow stage / 人工 checklist、验证结果、剩余风险。

## 知识库用法

- 写代码前按需读 `references/timpush-sdk-api.md`、`references/code-templates.md`。  
- `issues/`：先 `ROUTER.json`；`cards/` = 固定问题卡，`flows/` = 分支排查。不要通读整个 `issues/`。  
- Android / iOS / Flutter / UniApp 排障仍必须走 MCP workflow；`issues/**/*.md` 只能作知识与分支解释，**不能**替代 `list_workflows → get_workflow_state → complete_workflow_step`。  
- HarmonyOS / RN / 产品 FAQ：有对应 workflow 前走知识文档；不要把它们塞进其它平台 workflow。

## 已知限制（避免误用）

- MCP workflow 当前覆盖以 `list_workflows` 返回为准；RN / HarmonyOS 仍主要通过 `issues/` 做排查引导。  
- Flutter 工程请走 `wizard-flutter`；UniApp 请走 `wizard-uniapp`，不要误跑纯 `wizard-android` / `wizard-ios`（除非用户明确只要改某一原生子工程）。  
- workflow engine 仍是 alpha；`required_tool_calls` 目前由 AI 自报，尚未升到 proof token。
