# Workflow Protocol Reference

低频协议细节放在这里，避免 `SKILL.md` 每次加载时携带字段枚举。

## 启动与 Resume

首启：

```jsonc
{
  "workflow_id": "wizard-android",
  "user_prompt": "<本 turn 用户原文，仅产品使用时传>",
  "context": {
    "session_id": "sess_<6位小写字母数字>_<unix秒>",
    "ide": "cursor",
    "skill_version": "<当前 skill 版本>",
    "os": "darwin",
    "framework": "android"
  }
}
```

字段约束：

- `session_id`：同一 IDE 对话周期内复用。
- `ide`：`cursor` / `claude-code` / `codebuddy` / `codex` / `windsurf` / `trae`。
- `os`：`darwin` / `win32` / `linux`。
- `framework`：可选 `android` / `ios` / `uni-app` / `harmonyos` / `server` / `flutter`。
- `user_prompt`：产品使用时每轮传给 `get_workflow_state`；工具调试或无法判断时省略。不要把 `user_prompt` 放进 `context`，避免写入 `state_token`。
- Prompt 体验上报由 Root/Host 的 Prompt → invoke → Host Stop 链路负责；本 skill 不执行 `--prompt-stdin` / `--log-stdin`。

Resume：

```jsonc
{
  "run_id": "<上一步返回的 run_id>",
  "user_prompt": "<产品使用时传>"
}
```

`get_workflow_state` 返回的 `prompt`、`required_tool_calls`、`completion_schema`、`run_id` 是下一步唯一依据。`state_token` 仍会返回，但只作为兼容 / 跨进程快照，禁止手改、拼接、解码后重组、局部复制。

**`run_id` 跨进程可恢复**：引擎把 run payload 同步落盘（`os.tmpdir()/trtc-push-mcp-runs/<run_id>.json`，TTL 7 天，权限 0600）。MCP 重启 / IDE 重载 / 换进程调用后，凭 `run_id` 调 `get_workflow_state` / `complete_workflow_step` 会自动从磁盘恢复，不再 `unknown_run` 返工。`state_token` 仍按每进程随机密钥签名，进程重启即失效——跨进程恢复只走 `run_id`，不要试图复用旧 token。

**呈现契约**：每个阶段 `prompt` 要求输出给用户的内容，必须在提交 `complete_workflow_step` 之前完整呈现；禁止连续推进多个阶段而中间不向用户呈现。无 `required_tool_calls` 的阶段会带 `presentation_reminder` 字段，收到必须遵守。

## Step 状态

- `advanced`：使用返回的 `run_id` 进入 `next_state`，执行新 prompt。
- `failure_retry`：按 `error_code` 与 `hints_for_llm` 修正后，重新提交当前 step。
- `schema_violation`：按 `errors` 修正 output，使用同一 `run_id` / state 再提交，不要前进。
- `advanced_to_failure`：向用户说明失败原因并停止。
- `invalid_token` / `unknown_run`：先用 `run_id` 恢复（run 已落盘，MCP 重启后仍有效）；`run_id` 也恢复不了时重启同一 workflow。重启仍失败按 `SKILL.md` 的受控 fallback 继续；MCP 整体不可用则按「MCP 不可用（硬停止）」提醒用户开启，不进 fallback。

## Abandon

调用格式：

```jsonc
{
  "run_id": "<当前 run_id>",
  "reason": "user_gave_up",
  "last_error_code": "<可选>"
}
```

可以调用：

- 用户明确说停、放弃、换话题：`user_gave_up` / `user_switched_topic` / `user_aborted`。
- 同一 `run_id` 上反复 `failure_retry` / `schema_violation`，且没有可执行修复路径：`ai_stuck`，附最近 `last_error_code`。

不要调用：

- 正常收尾，终局 `is_terminal=true` 会自动记录 `outcome=completed`。
- 单次可恢复的 `failure_retry` / `schema_violation`。
- 只想给用户一个“暂停”提示；调用即代表本 run 结束。

调用后停止一切 workflow 协议动作；无需向用户展示该 tool。

## MCP 与厂商差异来源

若 MCP 不可用或 `list_workflows` 未返回预期 workflow：提示用户重启 IDE / 确认已配置 `trtc-push-mcp`（公开发布包：`npx -y @tencent-rtc/trtc-push-mcp@1.0.11`），**不要**退回 markdown 手册自行编流程。

厂商工程差异与验收要求以 MCP 返回为准，主要来自 `integration_requirements`（Android / iOS）。
