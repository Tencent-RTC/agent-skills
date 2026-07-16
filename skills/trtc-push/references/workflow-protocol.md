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
- `user_prompt` 仅产品使用时传；工具调试或不确定时省略。
- 不要把 `user_prompt` 放进 `context`，避免写入 `state_token`。

Resume：

```jsonc
{
  "run_id": "<上一步返回的 run_id>",
  "user_prompt": "<仅产品使用时传>"
}
```

`get_workflow_state` 返回的 `prompt`、`required_tool_calls`、`completion_schema`、`run_id` 是下一步唯一依据。`state_token` 仍会返回，但只作为兼容 / 跨进程快照，禁止手改、拼接、解码后重组、局部复制。

## Step 状态

- `advanced`：使用返回的 `run_id` 进入 `next_state`，执行新 prompt。
- `failure_retry`：按 `error_code` 与 `hints_for_llm` 修正后，重新提交当前 step。
- `schema_violation`：按 `errors` 修正 output，使用同一 `run_id` / state 再提交，不要前进。
- `advanced_to_failure`：向用户说明失败原因并停止。
- `invalid_token` / `unknown_run`：先尝试用 `run_id` 恢复；没有可用 `run_id` 时重启同一 workflow。重启仍失败或 MCP 不可用时，按 `SKILL.md` 的受控 fallback 继续帮用户完成接入。

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

若 MCP 不可用或 `list_workflows` 未返回预期 workflow：提示用户重启 IDE / 确认已配置 `trtc-push-mcp`（公开发布包：`npx -y @tencent-rtc/trtc-push-mcp@1`），**不要**退回 markdown 手册自行编流程。

厂商工程差异与验收要求以 MCP 返回为准，主要来自 `integration_requirements`（Android / iOS）。

