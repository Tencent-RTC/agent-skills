# meeting-interpreter（Path A 默认场景）

会议室 + AI 实时翻译的完整体验 Demo：Vue3 + `tuikit-atomicx-vue3`（Atomicx Core，无预置 UI）搭建真实会议室（登录/建房进房、参会人列表、视频布局、设备、屏幕分享、会中聊天），叠加一层独立的 AI 实时翻译能力（主持人开关 → 按当前真实参会人扇出多路翻译 → 静默旁听转写面板）。

## 组成

- `backend/` —— 场景专属 FastAPI 后端，把 `conversation-core` + `realtime-translation` + `meeting-ops` 三个能力包粘合成这个 demo 的 API 形状，并实现「仅主持人可开关 AI 翻译」的房主校验（这条规则是本 demo 的产品设计，不属于任何可复用能力包）
- `ui/` —— Vue3 前端（会议室 Layer 1 + AI 翻译 Layer 2 + 视觉展示层）

## 启动

```bash
cd backend && bash start.sh        # 后端：首次运行自动建 venv + 装依赖 + 生成自签证书
cd ui && npm install && npm run dev   # 前端：vite dev，代理 /api 到 https://localhost:8020
```

浏览器打开 `https://localhost:5173`。

## 权限说明

「仅会议主持人可开关 AI 翻译」是本 demo 的产品规则（起一路 `StartAIConversation` 有云服务调用开销，扇出多路更是倍数开销，不希望任意参会人随手触发）。这条校验写在 `backend/app/server.py` 的 `_verify_owner`，用内存字典记录建房人 = 房主，**仅供演示**。

如果你是要把这套能力接入自己已有的系统（而不是照搬这个会议室 demo），请看 Skill 顶层 `auto_adapters/`——那里的集成方式完全不需要这套房主校验：你自己系统的权限体系应该在你自己的后端完成，`meeting-ops` 能力包本身不做任何权限假设。
