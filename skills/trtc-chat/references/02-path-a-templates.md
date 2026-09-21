# 02a - 路径 A 话术模板（按需读取）

> 到对应步骤时 `read_file` 对应 § T.X 段落，不要在 A.3 写代码阶段提前加载。

---

## T.1 — A.1 项目概况反馈（输出后直接接 Q.1，同一条回复）

> ❗ **CHECKPOINT**（本段话术输出前必须已完成，否则 BLOCKED: session_not_initialized）：
> - [ ] Step 1.5 的 WRITE `.trtc-session.yaml` 已有 tool result 确认成功
> - [ ] Step 1.5 的 READ 验证已有 tool result 确认 `sessionId` 可读回
>
> ⛔ 若以上两项的 tool result 不存在于本轮 tool results 中，禁止输出以下话术，立即执行 Step 1.5。

```
> 我看了下你的项目：
> - **{platform}**（{vite/webpack}）+ {ts/js}
> - UI 库：**{ui_library}**，CSS 方案：{css_scheme}
> - 命名约定：{naming}，{setup-script / options-api}
> - 还没集成 TRTC Chat
```

> ❗ T.1 输出后**立即在同一条回复里**接 T.2，不停顿，不加"是否继续"等字样。

---

## T.4 — A.4 收尾消息

### 模板

```
✅ 基础聊天功能已就绪：{按 chatMode 列出实际生成的组件}

[若 extension_slices_applied.length > 0：]
✅ 额外集成：
  • {slice description}
  • ...

[若 unsupported_intents.length > 0：]
⚠️ 你提到但本次未生成的能力：
  • "{raw}" —— {fallback 建议}

下一步：npm run dev → 验证
```

### fallback 建议映射

| 意图类别 | 建议 |
|---|---|
| 翻译 | 自行接入翻译 API（监听 `onReceiveNewMessage` → 翻译 → `sendMessage` 回写） |
| AI 自动回复 | 监听消息 → 调 AI → `sendMessage` 回写 |
| 其他 | 路径 B 自然语言模式重新提，或等 slice 库更新 |

### 跑通话术

**Full Chat**：
```
> npm run dev → /login → 输入用户名 → /chat → 发一条文本试试 🎉
```

**Direct Chat**：
```
> npm run dev → 点击入口按钮 → 自动连接 → 发一条文本试试 🎉
```

---

## T.5 — A.5 引导菜单

```
> 基础聊天已经集成。我们还支持下面这些功能，您可按需添加：
>
> 功能推荐：
>   1. 自定义消息（订单 / 商品 / 优惠券 / 投票 / 评价）
>   2. 图片、视频、文件消息（进度 / 失败重试）
>   3. 撤回 / 删除
>   4. 群 @ 消息
>
> [若 unsupported_intents.length > 0：]
> 📋 你之前提到但本次未支持：
>   • {unsupported_intents[].raw}
>
> 💬 或者直接告诉我你要什么（用大白话）。
>
> ⚠️ 首次登录说明：
>   1. 新 SDKAppID 可输入任意合法 userID（如 `user001`、`test_xxx`）登录
>   2. 登录后默认激活与管理员的单聊会话
>   3. 发起新单聊或创建群聊时携带成员，需确保对方 userID 已登录过 IM（首次登录会在系统注册）；可在 IM 控制台手动创建。
>
> 国内站：https://console.cloud.tencent.com/im?utm_campaign=skill&_channel_track_key=CtW4AMuN
> 国际站：https://console.trtc.io/chat
>
> 如需调整主题色，直接告诉我你的风格偏好即可。
>
> 如果启动后遇到编译报错，把错误信息粘贴给我，我来帮你排查。
>
> 如需查看本次变更的文件清单和上线对接说明，请查看 `WHAT-TO-DO-NEXT.md`。
```

### 拼装规则

- `unsupported_intents` 为空 → 📋 段不渲染
- 用户选中 → 进 `03-path-b-script.md` B.2
- 选 📋 列表项 → 路径 B 重新命中，仍未命中则提示"等 slice 更新"

---

## T.BLOCKED — 统一阻断回复模板（Strict Mode）

> 用于主 SKILL v0.2 与路径 A/B 的 fail-closed 场景。
> 规则：先输出阻断码，再给一条最小恢复指引；不追加方案、不继续执行后续步骤。

### `BLOCKED: project_root_unresolved`

```
BLOCKED: project_root_unresolved
无法确定项目根目录。请在目标项目根目录重试，或明确提供 projectRoot 路径。
```

### `BLOCKED: session_not_initialized`

```
BLOCKED: session_not_initialized
sessionId 尚未落盘。请先完成 .trtc-session.yaml 初始化（sessionId/projectRoot/flow_state.chat.phase）。
```

### `BLOCKED: phase_gate_not_satisfied`

```
BLOCKED: phase_gate_not_satisfied
当前 phase 的前置条件未满足。请先完成上一 phase 的必填项再继续。
```

### `BLOCKED: credential_missing`

```
BLOCKED: credential_missing
凭证未写入成功。请补充有效的 SDKAppID 与 SecretKey 后重试。
```

### `BLOCKED: unsupported_platform`

```
BLOCKED: unsupported_platform
当前平台不在支持范围（仅支持 vue3）。请切换到 vue3 项目，或等待后续平台支持。
```

### `BLOCKED: required_reference_missing`

```
BLOCKED: required_reference_missing
缺少必需 reference/slice 文件，无法继续执行。请检查 references 与 knowledge-base 是否完整。
```

### 使用规则

- 阻断回复必须精简，不得附加“我先继续帮你写代码”。
- 同一轮只允许一个阻断码。
- 阻断解除后，从当前 phase 重新执行，不跳 phase。
