# Workflow Protocol Reference

低频协议细节放在这里，避免 `SKILL.md` 每次加载时携带字段枚举。


## 启动与 Resume

首启：

```jsonc
{
  "workflow_id": "wizard-android",
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

Resume：

```jsonc
{
  "run_id": "<上一步返回的 run_id>"
}
```

`get_workflow_state` 返回的 `prompt`、`required_tool_calls`、`completion_schema`、`run_id` 是下一步唯一依据。`state_token` 仍会返回，但只作为兼容 / 跨进程快照，禁止手改、拼接、解码后重组、局部复制。

**`run_id` 跨进程可恢复**：引擎把 run payload 同步落盘（`os.tmpdir()/trtc-push-mcp-runs/<run_id>.json`，TTL 7 天，权限 0600）。MCP 重启 / IDE 重载 / 换进程调用后，凭 `run_id` 调 `get_workflow_state` / `complete_workflow_step` 会自动从磁盘恢复，不再 `unknown_run` 返工。`state_token` 仍按每进程随机密钥签名，进程重启即失效——跨进程恢复只走 `run_id`，不要试图复用旧 token。

**呈现契约**：每个阶段 `prompt` 要求输出给用户的内容，必须在提交 `complete_workflow_step` 之前完整呈现；禁止连续推进多个阶段而中间不向用户呈现。无 `required_tool_calls` 的阶段会带 `presentation_reminder` 字段，收到必须遵守。

## Step 状态

- `advanced`：使用返回的 `run_id` 进入 `next_state`，执行新 prompt。
- `failure_retry`：按 `error_code` 与 `hints_for_llm` 修正后，重新提交当前 step。
- `schema_violation`：按 `errors` 修正 output，使用同一 `run_id` / state 再提交，不要前进。
- `missing_required_tool_calls`：当前阶段存在未调用的必调工具（见 `missing_tool_calls`），先按要求真实调用对应工具再重新提交，禁止凭假设硬填字段。
- `tool_verification_failed`：当前阶段的工具校验或落盘核验未通过（见 `error` 与 `failed_tool_calls`），先修复工程源码/配置并复跑校验工具通过（`ok: true` / `valid: true`）或完成文件落盘后，再重新提交。
- `advanced_to_failure`：向用户说明失败原因并停止。
- `invalid_token` / `unknown_run`：先用 `run_id` 恢复（run 已落盘，MCP 重启后仍有效）；`run_id` 也恢复不了时重启同一 workflow。重启仍失败按下方「受控 fallback」继续；MCP 整体不可用则按 `SKILL.md`「MCP 不可用（硬停止）」提醒用户开启，不进 fallback。

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

若 MCP 不可用或 `list_workflows` 未返回预期 workflow：提示用户重启 IDE / 确认已配置 `trtc-push-mcp`（公开发布包：`npx -y @tencent-rtc/trtc-push-mcp@1.0.13`），**不要**退回 markdown 手册自行编流程。

厂商工程差异与验收要求以 MCP 返回为准，主要来自 `integration_requirements`（Android / iOS）。

## 受控 fallback（workflow 连续异常不可恢复时）

只有在 MCP 已启用但 workflow 连续无法恢复（如 `run_id`/`state_token` 重启后仍异常、同一阶段工具连续崩溃）时进入 fallback。**MCP 整体不可用不属于 fallback 场景**（走 `SKILL.md` 硬停止）。

fallback 必须遵守：

1. 先告知用户：主 workflow 异常中断，正在按同一套 TIMPush 约束走受控备份路径。
2. 此时按需读取 `references/hard-rules.md`；写代码前读取 `references/timpush-sdk-api.md` 和 `references/code-templates.md`。
3. 尽量继续使用 MCP 原子工具（`detect_*`、`get_latest_timpush_version`、`validate_*`、`apply_local_properties`、`verify_*_wiring`），不要自由发挥。
4. 凭据安全（Android：`local.properties`；iOS/Flutter/UniApp：Credentials 源文件 + `.gitignore`，禁止主 `Info.plist` 或 `.xcconfig`）、`registerPush` 后打印 `registrationID=`、iOS 不自动改 `.pbxproj` Capability 等红线不因 fallback 放宽。
5. **排障 fallback 仍遵守零写入**：未获用户授权不得改用户工程；每轮最多 1～2 问规则不放宽。
6. 收尾必须列出：已完成项、未完成 workflow stage / 人工 checklist、验证结果、剩余风险。

## 知识穷尽兜底（查网）

当本地知识卡 + MCP `troubleshoot-*` 已走完，仍拿不到日志 / 配置 / 控制台支撑的结论时启用：

1. **优先官方域**：腾讯云 TIMPush / IM 文档、厂商开放平台（华为 / 小米 / OPPO / vivo / 荣耀 / APNs / FCM / HarmonyOS Push Kit）、Apple / Google 官方文档。
2. **仍不够再广检索**：社区帖、第三方博客等；必须标明来源 URL / 标题，并**明确提醒用户：非官方信息源不一定可信，落地前需自行核对**。
3. 凭据安全与零写入红线不因查网放宽；禁止用训练记忆硬编未核实结论。

