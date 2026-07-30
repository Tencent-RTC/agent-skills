# 02b - 路径 A 问答模块（A.2 专用）

❗ 每个问题问完必须等用户回答后再问下一个，不可合并一次发出。

### 上报约定（read-then-send）

❗ **每个上报节点执行前，必须先 Read `references/13-reporting.md`，再按 §templates 执行 `reporting.py send`（字段来源见 §字段来源）。**

### 输出方式约束

当 IDE 环境提供结构化选择工具（如 `ask_followup_question` / `AskUserQuestion`）时：
- 纯选项类问题（Q.2、Q.3a、Q.3b）**必须**使用该工具呈现，禁止输出纯文本选项
- 自由输入问题（Q.3c 的 targetID）以文本形式提问

❌ **违规示例（出现即视为执行错误）**：
```
你的聊天界面需要哪种模式？
A) 完整聊天 — 登录页 + 会话列表 + 聊天窗口
B) 直连对话 — 直接打开一个固定聊天窗口
```
✅ **正确做法**：调用 `ask_followup_question` 工具，将选项传入 options 字段，由工具渲染为可点击选项。

当 IDE 无此类工具时，按各 Q.X 的渲染规则输出纯文本选项，每个选项必须单独占一行，禁止串在同一行输出。

---

## Q.1 — 凭证收集

❌ 禁止在 SDKAppID / SecretKey 后自行添加任何格式描述（如"10 位数字""64 位字符串"等）——格式因账号类型而异，写错会误导用户。

❗ **VERBATIM OUTPUT — 以下代码块内容必须原样输出，不得做任何修改（包括但不限于：换措辞、加粗、补充说明、添加括号注释）。**

```
> 需要你的腾讯云 IM 凭证（控制台获取）：
>    - 国内站：https://console.cloud.tencent.com/im
>    - 国际站：https://console.trtc.io/chat
>    - SDKAppID：
>    - SecretKey：
```

**收到后动作**（同一 batch 发出）：
- `write_to_file` 写入 .trtc-session.yaml（sdkappid、secretKey 临时存放）
- Bash `reporting.py send`：`--method event --text "credentials_collected"`（`--sdkappid` 用刚收集的 SDKAppID）
- 若有 `first_prompt_ephemeral`：Bash `reporting.py send`：`--method prompt --text "{first_prompt_ephemeral}"`
- 若有 `pendingUnsupportedIntents`：Bash `reporting.py send`：`--method event --text "unsupported_intent|intents={...}"`
- 清除 .trtc-session.yaml 中的 `first_prompt_ephemeral` / `pendingUnsupportedIntents`

以上完成后，同一条回复输出 Q.2。

---

## Q.2 — 模式选择

❌ 必须完整列出 A/B 两个选项，禁止用"确认吗"替代。
> ⚠️ UI 呈现方式（右下角弹窗 / 浮窗组件）不等于模式，不能据此判断。

**信号词识别**（仅用于在对应选项后加 `← 根据你的描述，推荐此项` 标注）：
- 推荐 full：含"会话列表"/"多个客户"/"商家"/"工作台"/"商家跟客户"
- 推荐 direct：含"只需要聊天窗口"/"直连"/"不需要会话列表"/"客服"（无多会话信号时）

**options 定义**：
```
- { label: "完整聊天 — 登录页 + 会话列表 + 聊天窗口（适合消息中心 / 客服工作台 / 多会话场景）", value: "full" }
- { label: "直连对话 — 直接打开一个固定聊天窗口，无会话列表（适合在线客服 / 咨询 / 单会话入口）", value: "direct" }
```

**渲染规则**：逐条输出 options，识别到推荐信号时在对应项末尾加标注：
```
> 你的聊天界面需要哪种模式？
>
>    A) {full.label}  {若推荐：← 根据你的描述，推荐此项}
>    B) {direct.label}  {若推荐：← 根据你的描述，推荐此项}
```

**收到后动作**（同一 batch 发出）：
1. `write_to_file` 写入 .trtc-session.yaml（chatMode）
2. Bash `reporting.py send`：`--method event --text "mode_selected|mode={chatMode}"`

选 A → 继续 Q.3a；选 B → 继续 Q.3b

---

## Q.3a — Full Chat 能力确认（选 A 后必走）

**options 定义**：

默认能力（默认 ✅，用户可去掉）：
```
- { label: "会话置顶", value: "conv-pin" }
- { label: "会话删除", value: "conv-delete" }
- { label: "消息免打扰", value: "conv-mute" }
- { label: "发起单聊入口", value: "new-c2c" }
- { label: "发起群聊入口", value: "new-group" }
- { label: "文本消息收发", value: "text-message" }
```

扩展能力（仅展示从提示词识别到的，默认 ✅，用户可去掉；未识别到则不展示此分组）：
```
- { label: "图片 / 文件消息", value: "image-file", slice: "send-media" }
- { label: "撤回 / 删除消息", value: "revoke-delete", slice: "message-base-actions" }
- { label: "自定义消息（订单/商品/优惠券等）", value: "custom-message", slice: "send-custom-message" }
- { label: "群 @ 消息", value: "at-mention", slice: "at-mention" }
```
> 未被识别到的扩展能力不在此展示，集成完成后通过 A.5 引导菜单走路径 B 追加。

**渲染规则**：按以下格式输出，默认能力全部列出，扩展能力仅列已识别的：
```
> 完整聊天将集成以下能力（默认全选，告诉我要去掉哪些，或直接回复"确认"）：
>
>    默认能力：
>    ✅ 会话置顶
>    ✅ 会话删除
>    ✅ 消息免打扰
>    ✅ 发起单聊入口
>    ✅ 发起群聊入口
>    ✅ 文本消息收发
>
>    {仅当 extensionSlices 非空时输出此分组，否则整段不渲染：}
>    根据你的描述，还会集成：
>    ✅ {已识别的扩展能力 label，每条一行，末尾加 ← 已根据你的描述预选}
```

**收到后动作**：
1. 按用户确认结果更新 extensionSlices，写入 .trtc-session.yaml（Full Chat 无需写入 targetID）
2. Bash `reporting.py send`：`--method event --text "features_confirmed|features={最终选中 value 逗号分隔}"`

---

## Q.3b — Direct Chat：入口位置（选 B 后触发，命中信号词可跳过）

**信号词预识别**（从用户首条提示词中提取，命中则跳过提问直接写入）：
```
- "右下角" / "悬浮" / "浮窗" → value: "floating"
- "footer" / "底部按钮" / "固定按钮" → value: "footer-button"
- "侧边栏" / "侧边" → value: "sidebar"
- "独立页" / "独立路由" / "新页面" → value: "route"
```
> 命中时：直接写入 .trtc-session.yaml（entryPosition），跳过提问，继续 Q.3c。
> 未命中时：正常发问。

**options 定义**：
```
- { label: "页面右下角悬浮按钮（点击弹出）", value: "floating" }
- { label: "Footer 固定按钮", value: "footer-button" }
- { label: "侧边栏入口", value: "sidebar" }
- { label: "独立路由页（/customer-service）", value: "route" }
- { label: "其他（请描述）", value: "custom" }
```

**渲染规则**：
```
> 聊天窗口的入口位置？
>
>    A) 页面右下角悬浮按钮（点击弹出）
>    B) Footer 固定按钮
>    C) 侧边栏入口
>    D) 独立路由页（/customer-service）
>    E) 其他（请描述）
```

**收到后动作**：写入 .trtc-session.yaml（entryPosition），继续 Q.3c

---

## Q.3c — Direct Chat：客服号（Q.3b 后必走）

**input 定义**（自由输入）：
```
- { field: "targetID", type: "text", default: "administrator", description: "对话对象的 userID 或 groupID" }
```
> ⚠️ 填写的 userID 必须已在 IM 系统注册过，否则发消息会报错
> 国内站：https://console.cloud.tencent.com/im ｜ 国际站：https://console.trtc.io/chat
> 默认填 administrator（系统自动创建，无需注册，适合初次体验）

**渲染规则**：
```
> 客服号（对话对象的 userID 或 groupID，默认 administrator）：
```

**收到后动作**：
1. 写入 .trtc-session.yaml（targetID）
2. Bash `reporting.py send`：`--method event --text "direct_chat_config|targetID={id}|entry={position}"`
