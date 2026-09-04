---
id: official-roomkit
ui_mode: official-roomkit
---

# Playbook: official-roomkit

> **来源**：从 conference 域技能旧版 A2-Q0.5 文案 → "If `ui_mode = official-roomkit`" 提取。
> 对应 owner 文案已迁入 conference 域技能与 playbook。
>
> **触发条件**：`ui_mode = official-roomkit`，用户选择了官方 TRTC 通用会议 UIKit。
>
> **bypass 说明**：本 playbook 不进 topic，不走状态机，不物化 execution_queue。
> Official RoomKit 内部已封装全部 16 个能力，无需逐 slice 生成代码。
> 完成后 `status = completed`，流程终止。

> **Reporting boundary**：Root/Host 已负责本轮 Prompt、路由和 Host Stop notice；本 playbook 不执行独立 `send`。若直接进入且 Host 未记录，才补一次 stdin Prompt。动态澄清前保留 `context --question`，固定选项仍用 `AskUserQuestion`；notice 由 Host Stop 展示 `runtime/continuation-notice.md`。

---

## 进入

```bash
python3 -m tools.flow enter --playbook official-roomkit --product conference --platform web
```

---

## 执行步骤

### Step 1：读取资料（只读这三个文件）

- `../../../knowledge-base/slices/conference/web/official-roomkit-api.md` — 完整 API 签名、调用时序、代码示例、MUST/MUST NOT 规则
- `../../../knowledge-base/slices/conference/web/official-roomkit-login-ui.md` — 登录页 UI 结构和样式约束（含 `usersig_source` 分支的 UI 规范）
- `../references/usersig-handling.md` — UserSig 凭证协议（3-path：local-dev / console / backend）

### Step 2：一次性生成项目文件

- **框架判定**：优先读取项目 `package.json`；依赖含 `react` / `next` 时生成 React 版本（`.tsx`，使用 `@tencentcloud/roomkit-web-react`、`tuikit-atomicx-react`、`@tencentcloud/uikit-base-component-react`）；依赖含 `vue` / `@vitejs/plugin-vue` 时生成 Vue3 版本（`.vue` / `.ts`，使用 `@tencentcloud/roomkit-web-vue3`、`tuikit-atomicx-vue3`、`@tencentcloud/uikit-base-component-vue3`）。用户明确指定 React 或 Vue3 时，以用户指定为准。
- **登录页**：按 `usersig_source` 分支（见 `../references/usersig-handling.md`）生成凭证部分：`local-dev` → 复制 bundled lib，登录调用 `getBasicInfo(userId)`；`console` → SDKAppID + UserSig 粘贴字段；`backend` → API fetch skeleton
- **会议室页**：在对应框架的 `UIKitProvider` 内挂载官方 `ConferenceMainView`（Vue3 移动端可用 `ConferenceMainViewH5`），接入同包导出的 `conference.*` API 调用
- **路由配置**：登录 → 会议室的跳转逻辑
- **场景定制**（若有）：按已选 scenario 调用 `setWidgetVisible` 隐藏/显示对应挂件

### Step 3：合规检查（inline，不跑完整 apply pipeline）

对照 `official-roomkit-api.md` 的 MUST/MUST NOT，验证生成的代码：

- 无手写 `crypto-js` / `pako` UserSig 签名器（`src/utils/usersig.ts` 等）
- React 项目不得出现 `@tencentcloud/roomkit-web-vue3` / `tuikit-atomicx-vue3` / `.vue` 会议页面；Vue3 项目不得出现 `@tencentcloud/roomkit-web-react` / `tuikit-atomicx-react` / TSX 会议页面
- `local-dev`：`SDKSECRETKEY` 只允许在 `src/config/basic-info-config.ts` 中；其他任何文件不得出现 SecretKey
- `console` / `backend`：客户端代码无 `SecretKey`，无 signing bundle
- `conference.login()` 在所有房间操作之前调用
- `setWidgetVisible` / `registerWidget` / `onWill` 在 login 后、joinRoom 前注册
- `setFeatureConfig({ shareLink })` 在 joinRoom 成功后调用
- cleanup 函数在 `ROOM_LEAVE` 和 `ROOM_DISMISS` 事件时调用

### Step 4：UserSig 填入指引

按 `usersig_source` 分支（见 `../references/usersig-handling.md`）向用户展示收尾说明：
- `local-dev`：展示 usersig-handling.md Path A Handoff（填入 `src/config/basic-info-config.ts`）
- `console`：展示 usersig-handling.md Path B Handoff（控制台生成 UserSig 后粘贴）
- `backend`：展示 API skeleton 的 TODO 注释，指向后端签发文档

填入真实文件路径和变量名；不要声称 userSig 是自动获取的（如果实际不是）。

同时告知用户安装依赖：`pnpm install`，再 `pnpm dev`（或项目已有的包管理器）。

### Step 5：完成

写入 session（直接更新 `.trtc-session.yaml`）：
```yaml
integration_path: official-roomkit
flow_state:
  result: official-roomkit-done
status: completed
```

然后退出：
```bash
python3 -m tools.flow exit
```

---

## 禁止事项（不可绕过）

- Do NOT read 其他 slice 文件（`room-lifecycle.md`、`device-control.md` 等）
- Do NOT hand off to `flows/topic.md`
- Do NOT run 状态机（`init_slice_queue`、`next_slice` 等）
- Do NOT ask A2-Q0.6（无 slice loop，auto-advance policy 无意义）
