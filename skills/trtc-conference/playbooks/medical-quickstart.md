---
id: medical-quickstart
ui_mode: medical-template
---

# Playbook: medical-quickstart

> **来源**：从 conference 域技能旧版 medical-template owner 文案提取。
> 对应 owner 文案已迁入 conference 域技能与 playbook。
>
> **触发条件**：`scenario = 1v1-video-consultation` AND `project_state.has_trtc_dep = false`，
> 用户在 A2-Q0.5 选择了"创建完整的问诊项目"。
>
> **bypass 说明**：本 playbook 不进 topic，不走状态机，不物化 execution_queue。
> 完成后 `status = completed`，流程终止。

> **Reporting boundary**：Root/Host 已负责本轮 Prompt、路由和 Host Stop notice；本 playbook 不执行独立 `send`。若直接进入且 Host 未记录，才补一次 stdin Prompt。动态澄清前保留 `context --question`，固定选项仍用 `AskUserQuestion`；notice 由 Host Stop 展示 `runtime/continuation-notice.md`。

---

## 进入

```bash
python3 -m tools.flow enter --playbook medical-quickstart --product conference --platform web
```

---

## 执行步骤

1. **确认目标目录**：询问用户新项目要放在哪里，或默认使用相邻目录（如 `../medical-consultation/`）。

2. **复制模板**：将 `../templates/medical-consultation/` 完整复制到目标目录，保持目录结构不变。

3. **禁止事项（不可绕过）**：
   - Do NOT enter `flows/topic.md`
   - Do NOT show scenario capabilities 或 slice/module overview
   - Do NOT generate Vue SFCs
   - Do NOT run any UI/medical verifiers
   - Do NOT hand off to topic

4. **告知用户启动方式**：用 `pnpm install` 安装依赖，`pnpm dev` 启动本地开发。
   **不要推荐 `npm install` / `npm run dev`**（npm 首次启动明显更慢，可能出现白屏）。

5. **完成**：写入 session（直接更新 `.trtc-session.yaml`）：
   ```yaml
   integration_path: medical-quickstart
   ui_mode: medical-template
   flow_state:
     result: template-copied
   status: completed
   ```

   然后退出：
   ```bash
   python3 -m tools.flow exit
   ```

---

## 用户侧话术

选择本路径后，先告知用户：

> 好的，我会创建一个完整的 1v1 视频问诊项目，里面已经包含问诊 UI、模拟数据和基础配置。创建完成后用 `pnpm install` 和 `pnpm dev` 启动。

不要说用户"命中了"或"匹配到了"某个内部规则。

---

## Resume 规则

若后续 turn 进入 session 时发现 `ui_mode = medical-template` 或 `flow_state.result = template-copied` 或 `status = completed`：
- 不要重新进入 topic
- 不要重新打开 slice 执行序列
- 只简要说明项目已创建完成，按需重复 `pnpm install` / `pnpm dev` 命令
