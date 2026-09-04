---
phase: troubleshoot
product: conference
platform: web
---

# Conference Web Troubleshoot Flow

> **调用方**：`trtc/SKILL.md` Section A 在识别到
> `(product=conference, platform=web)` + symptom-like intent 后直接 Read 本文件。
> 不经过 `trtc-conference/SKILL.md`（那是 integration 主链路）。
>
> **职责**：Conference Web 运行时症状的结构化诊断。B-Audit（集成审计）
> 走 `trtc/SKILL.md` Section C → `integration-audit.md`，不走本文件。

> **Reporting boundary**：Root/Host 已负责本轮 Prompt 与路由记录；本 flow 不执行独立 `send` 路径。若直接进入且 Host 未记录，才补一次 stdin Prompt。动态澄清前保留 `context --question`，固定选项仍使用 `AskUserQuestion`；普通失败继续排障，notice 由 Host Stop 展示 `runtime/continuation-notice.md`。

---

## 入口 recap

向用户说一句定位句（translate to user's language）：

> Got it — something's broken in your Conference Web / RoomKit integration.
> Let me narrow down the symptom.

---

## B-Q1a — Conference Web 症状菜单

Question: *Which best matches what you're seeing?*

| # | 选项 | 诊断方向 | 第一步要问的上下文 |
|---|------|----------|-------------------|
| 1 | 进不了房间 / 房间不存在 / 被解散 / 密码错误 | `conference/login-auth` + `conference/room-lifecycle` | 已登录？roomId 来源？join 还是 createAndJoin？ |
| 2 | 无画面 / 无声音 / 权限被拒 / 设备占用 | `conference/prejoin-check` + `conference/device-control` | HTTPS？iframe？会前 API 与会中 API 混用？ |
| 3 | 登录失败 / UserSig 报错 / 6206 / 被强制下线 / 凭证过期 | `conference/login-auth` | userSig 来源（local-dev/console/backend）？有无监听 `onLoginExpired`？ |
| 4 | 会前设备检测与会中状态冲突（双 getUserMedia / DeviceDetector 报错） | `conference/prejoin-check` + `conference/device-control` | 会前用了哪套 API？会中又用了哪套？ |
| 5 | 屏幕共享失败 / iframe 内无画面 / display-capture 被拒 | `conference/screen-share` + `conference/device-control` | 浏览器？iframe 有无 `allow="display-capture"` 等属性？ |
| 6 | 房间类型 / 能力不匹配（100211、100006、标准会议调了直播接口） | `conference/integration-audit` §6 + `conference/room-lifecycle`，代码不确定时转 `trtc-docs` | roomType？有没有调 Live/PK/上麦 API？ |
| 7 | 视频布局异常 / 远端画面不更新 / 成员列表问题 | `conference/video-layout` + `conference/participant-list` | 用的是 official-roomkit 还是自定义 `useRoomView`？ |
| 8 | 有具体错误码（贴出来） | `python3 -m tools.search slices --intent error-code --query "<code>"` | 等用户粘贴 |
| 9 | 说一下具体现象 | `python3 -m tools.search slices --intent troubleshoot --query "<free-text>"` | free-text |

---

## Conference Web 高频错误码速查

遇到以下错误码可直接给出 verdict，无需再走搜索：

| 错误码 | 结论 | 处理 |
|--------|------|------|
| **6206** | UserSig 无效 / 已过期 | 重新签发 userSig；前端监听 `USER_SIG_EXPIRED` 事件自动刷新 |
| **100211** take-seat not enabled | Standard 房间的内部 seat 同步消息 | 通常**可安全忽略**；若未调用上麦/连麦 API，不影响功能 |
| **100006** only open to live room | 在 Standard 房间调了 Live 专属接口 | 移除 Live/PK/连麦 API 调用；用 `setWidgetVisible` 隐藏 Live 工具栏 widget |

---

## 诊断流程

选项 1–7 确认后：

1. 若 `project_state` 已扫描（用户在 session 中已有项目上下文）→ 直接针对代码诊断，无需再问"能否贴代码"。
2. 若无项目上下文 → 在**第一条诊断消息里**内联一句上下文请求（如"能贴一下你的 `joinRoom` 调用部分吗"），不单独提问。

读取对应 slice 的**排障指南**章节，给出：
- 症状 → 根因 → 修复步骤
- 每个修复步骤要有可直接替换的代码片段（不是"你应该……"的描述）

---

## 边界

- 本文件只处理 **runtime symptom**（A intent）。
- Integration audit（F intent）→ `trtc/SKILL.md` Section C → `integration-audit.md`。不在此重复。
- 选项 8/9 的 search 调用若返回 `no_match` / `no_slice` → 转 `../../trtc-docs/SKILL.md`。
- 若文档和项目检查仍无法解释黑屏、无声、卡顿、掉线或进房失败等运行时现象：先说明当前排障资料不足，再 Read `../../trtc-sdk-log-analysis/SKILL.md`，按其 1.0 手动导出指引收集用户提供的日志。
- 非 Conference Web 产品的 symptom → `../../trtc-docs/SKILL.md`（dispatcher 层已分流，不应进入本文件）。
