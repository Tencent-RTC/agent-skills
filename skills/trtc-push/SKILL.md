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
version: 1.1.1
---

# TIMPush 开发者助手

## 渐进披露

- 每 turn 先读 `issues/ROUTER.json` 做轻量路由；不要先读整个 `issues/`。
- 进入 Android / iOS / Flutter / UniApp / HarmonyOS workflow 前，先读一次 `references/hard-rules.md`。
- 写 Gradle / Application / Podfile / AppDelegate / `registerPush` 代码前，再读 `references/timpush-sdk-api.md` 和 `references/code-templates.md`。
- wizard 走到 stage-8 / stage-10 结尾输出「后台 API 能力衔接段」，或 stage-11 落到 `unavailable` 分支（用户没配管理员凭据）时，读一次 `references/push-server-onboarding.md`——它是能力清单 + 可复制 mcp.json snippet + UserSig 获取步骤的唯一权威副本，禁止自由发挥。
- 路由命中非 workflow 知识时，只读命中的 1 个 `target`。
- 启动字段、`abandon_workflow` 等低频协议细节见 `references/workflow-protocol.md`。

## 核心原则

本 Skill **不含可由 LLM 自行解释的流程正文**。阶段、schema、失败路由都由 `trtc-push-mcp` 的 workflow engine 决定。

你的工作：按 engine 下发的当前 `prompt` 执行单步 → `complete_workflow_step` 提交结构化 output → **下一步只能来自引擎返回值**。禁止自己编流程、跳步、或用 markdown 手册替代 engine。

外部流程 skill **不能替代** wizard 任一阶段；即使用户要求用外部方案驱动集成，凭据、路径、注册时序等红线仍以 engine 下发的 prompt 与 schema 为准。

### 排障写文件与逐步引导（硬）

- **`troubleshoot-*` 默认零写入**：未获用户本轮明确授权前，禁止改用户工程任何文件。可疑 bug → 贴拟改 diff + 问是否授权；详见 `references/hard-rules.md`「Troubleshoot：零写入 + 逐步引导」。
- **本轮最多 1～2 个用户问题 / 1 个校验动作**；禁止一股脑丢长 checklist。每个问题写清：怎么做、期望看到什么、做完回什么。
- **禁止**把 AtomicX `LoginStore.setCertificateID` 当成 TIMPush `registerPush` 的替代（见 `cards/ios/atomicx-vs-timpush.md`）。

## 每 turn（按顺序）

1. 读 `issues/ROUTER.json` 的 `match_any` / `priority` / `platform`，得到候选 `target` / `workflow_id`。路由是 best-effort；未命中不代表不能处理。
2. 命中 `platform=auto` 的集成入口（如“集成 push / 接入离线推送”）→ 先调用 detect 系列工具判断项目平台，再选择 `wizard-android` / `wizard-ios` / `wizard-flutter` / `wizard-uniapp`。
3. 命中 Android / iOS / Flutter / UniApp `workflow_id` → 读 `references/hard-rules.md`，进入 Workflow 循环。
4. 需要解释或非 workflow 知识 → 只读路由命中的 1 个 `target`。
5. 无命中 → 按 `fallback.question` 问 1 个澄清问题。
6. 意图不清 → `list_workflows`，把 `trigger_phrases` 复述给用户澄清。

特殊分支：

- 用户已明确是 Android / iOS TIMPush 排障但缺厂商/错误码 → 进对应 `troubleshoot-*` stage-0 收集症状与证据，**不要自行下结论**；stage-0 **先问 1 个澄清/校验问题并等待用户回复**，不要跳过引擎直接改源码或一次抛出全部排查项
- `list_workflows` 未返回预期 workflow 或 `trtc-push-mcp` 工具整体不可用 → 按「MCP 不可用（硬停止）」提醒用户开启并等待，**不要**退回 markdown 手册执行、不要静默兜底。

## MCP 不可用（硬停止：提醒用户开启，禁止静默兜底）

`trtc-push-mcp` 工具（`list_workflows` / `get_workflow_state` / `complete_workflow_step` 等）不在工具列表、调用报错、或 `list_workflows` 无预期返回时，最常见原因是 MCP 未启用 / 未加载。**此时唯一动作是直接提醒用户开启，然后停下来等用户**——不得静默降级、不得自行编流程、不得退回 markdown 手册、不得用训练记忆带着用户往下走。没有引擎就没有状态强制、schema 契约和工具账本，「AI 自己带着走」必然走歪（实测复盘：MCP 未启用时静默兜底，是集成耗时失控、离线推送测不通的直接原因）。

按 IDE 告诉用户怎么开：

- **Cursor**：项目级 MCP 默认禁用且无弹窗。让用户到侧边栏 Customize → MCP 打开 `trtc-push-mcp` 开关，然后重载窗口。
- **Claude Code**：安装器已在 `.claude/settings.local.json` 预批准；让用户重启 `claude` 会话。若仍提示审批，让用户用 `/mcp` 批准 `trtc-push-mcp`。
- **CodeBuddy**：确认项目根存在 `.mcp.json`（注意不是 `.codebuddy/mcp.json`），然后重启 CodeBuddy。
- **Codex**：让用户在项目目录运行 `codex` 并接受 trust 提示（未信任时 `.codex/config.toml` 整层不加载）。

用户完成启用 / 重启后重新进入本流程，从 `list_workflows` 重新开始。「受控 fallback」**不适用**于本场景——它只覆盖 MCP 已启用但 workflow 运行中连续异常的情况。

## Workflow 循环

```
list_workflows（可选，看候选）
  → get_workflow_state（产品使用每 turn 带 user_prompt；调试不传）
  → 按返回的 prompt / required_tool_calls / completion_schema 执行
  → complete_workflow_step { run_id, step, output }
  → 按 status 继续或停止
```

`run_id` 优先；`state_token` 视为 opaque，禁止手改 / 拼接 / 解码重组 / 局部复制。

- 返回值 5 种 status（`advanced` / `failure_retry` / `schema_violation` / `advanced_to_failure` / `invalid_token`）、`abandon_workflow` 调用时机与恢复细节见 `references/workflow-protocol.md`。
- **绝不**自己决定「下一步该做什么」或越过当前 state——`next_state` 只能来自引擎。
- MCP 返回的 `prompt` **优先于**训练记忆 / 常识。

### 产品工作流 MCP（不是 Skill 体验数据上报）

`trtc-push-mcp` 是 TIMPush 的功能型工作流 MCP，用于推进产品配置状态；它不是体验数据上报 MCP，也不替代 Root/Host 的 Prompt → invoke → Host Stop 链路。

- 产品使用时，每轮向 `get_workflow_state` 传 `user_prompt`；工具调试或无法判断时不传，质量事件和本地脱敏由 MCP 统一处理。
- 不得把 `user_prompt` 放入 `context`，也不得执行 `--prompt-stdin` / `--log-stdin`；避免原文进入 `state_token` 或额外 shell 链路。

## 受控 fallback（workflow 异常时）

目标是继续帮用户快速接入，不是机械报错。只有在 workflow 连续无法恢复（如
`run_id`/`state_token` 都无法继续、同一阶段反复工具异常）时进入 fallback。
**MCP 整体不可用不属于 fallback 场景**——那是上一节的硬停止，先让用户开启 MCP。

fallback 必须遵守：

- 先告知用户：主 workflow 中断，正在按同一套 TIMPush 约束走备份路径。
- 继续执行 `references/hard-rules.md`；写代码前仍读 `references/timpush-sdk-api.md`
  和 `references/code-templates.md`。
- 尽量继续使用 MCP 原子工具（检测、版本、校验、写 local 配置），不要自由发挥。
- 凭据安全（iOS：Credentials 源文件 + gitignore，禁止主 Info.plist；Android：local.properties）、`registerPush` 后打印 `registrationID=`、iOS 不自动改 `.pbxproj`
  Capability 等红线不因 fallback 放宽。
- **排障 fallback 仍遵守零写入**：未获用户授权不得改用户工程；逐步提问规则不放宽。
- 收尾必须列出：已完成项、未完成 workflow stage / 人工 checklist、验证结果、剩余风险。

### 恢复（`invalid_token` / `unknown_run`）

先用 `run_id` 恢复；没有可用 `run_id` 时重启同一 workflow。不得手工修 token。若重启仍失败或 MCP 不可用，留在本 fallback 路径，不要退回 markdown 手册。

## 知识库用法

- `issues/`：先 `ROUTER.json`；只读命中 target。`cards/` = 问题卡，`flows/` = 分支排查；不要通读整个 `issues/`。
- Android / iOS / Flutter / UniApp / HarmonyOS 排障必须走 MCP workflow；`issues/**/*.md` 不能替代 `list_workflows → get_workflow_state → complete_workflow_step`。
- RN / 产品 FAQ：有对应 workflow 前走知识文档；不要塞进其它平台 workflow。

## 知识穷尽兜底（查网）

与「MCP 不可用」「受控 fallback」不同：本条在 **本地知识 + MCP 排障路径已走完，仍无有证据的根因/方案** 时启用，避免卡住用户。

触发（须同时满足）：

1. 已按 `ROUTER.json` 读过命中 target（或澄清后再路由仍无更合适 target）；Android / iOS / Flutter / UniApp / HarmonyOS 已走完相关 `troubleshoot-*` 或明确无法继续推进。
2. 仍拿不到日志 / 配置 / 控制台 / 用户已验证事实支撑的结论，或本地文档明确写「需外部确认」。

执行顺序：

1. **优先官方域**：腾讯云 TIMPush / IM 文档、厂商开放平台（华为 / 小米 / OPPO / vivo / 荣耀 / APNs / FCM / HarmonyOS Push Kit 等）、Apple / Google 官方文档。
2. **仍不够再广检索**：社区帖、第三方博客、非官方汇总等；必须标明来源 URL / 标题，并**明确提醒用户：非官方信息源不一定可信，落地前需自行核对**。
3. 凭据安全与 `references/hard-rules.md` 不因查网放宽；禁止用训练记忆硬编未核实结论。
4. 查网得到可复用的稳定解法时，可在收尾提示用户向官方反馈；不要在用户工程里擅自改 Skill 源文件。

## 已知限制（避免误用）

- MCP workflow 当前覆盖以 `list_workflows` 返回为准；RN 仍主要通过 `issues/` 做排查引导。
- Flutter 工程请走 `wizard-flutter`；UniApp 请走 `wizard-uniapp`，不要误跑纯 `wizard-android` / `wizard-ios`（除非用户明确只要改某一原生子工程）。
