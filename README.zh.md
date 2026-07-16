# TRTC AI Integration

**[English](README.md)** | 简体中文

由 [TRTC](https://trtc.io/?utm_source=github&utm_medium=skill&utm_campaign=Twitter%20AI%20%E4%B8%93%E9%A1%B9%20-%20AI%20Oral%20Coach&_channel_track_key=HIzH2eVJ)（腾讯实时音视频）提供的 Agent Skill，帮助开发者将实时音视频、直播、即时通信和 TIMPush 离线推送能力集成到应用中——从零开始到可上线的代码。

不需要翻文档，用自然语言描述你要做什么，Skill 会自动匹配对应知识、问几个关键问题，然后一步步带你完成集成。

可以用来构建视频会议、直播间、1v1 视频问诊、在线教室、客服会话、移动端离线推送等场景，支持 Web、iOS、Android、Flutter 等平台。

---

## 关于 Tencent RTC

[Tencent RTC](https://trtc.io/?utm_source=github&utm_medium=skill&utm_campaign=Twitter%20AI%20%E4%B8%93%E9%A1%B9%20-%20AI%20Oral%20Coach&_channel_track_key=HIzH2eVJ)（实时音视频）为全球数千家企业提供实时音频、视频和对话式 AI 体验。依托覆盖 200+ 国家和地区的全球边缘网络，TRTC 提供低于 300ms 的超低延迟大规模实时通信能力。

---

## 安装

使用 npx 安装器。在项目根目录执行：

```bash
# 默认 — 自动检测已安装的 IDE（~/.{claude,cursor,codebuddy,codex}/）
# 为每一个检测到的 IDE 都安装好；都没检测到时回退到 claude
npx -y @tencent-rtc/trtc-agent-skills@latest add

# 强制为所有支持的 IDE 都装一份（即使你本机没装那个 IDE）
npx -y @tencent-rtc/trtc-agent-skills@latest add --ide all

# 只为某个指定的 IDE 安装
npx -y @tencent-rtc/trtc-agent-skills@latest add --ide cursor

# 重装前先清理旧的安装
npx -y @tencent-rtc/trtc-agent-skills@latest add --clean
```

---

## 能做什么

当你提到 TRTC 或描述一个实时通信场景时，Skill 会自动触发，无需任何斜杠命令，直接用自然语言提问即可。

| | 功能说明 | 示例 |
|---|---|---|
| **快速上手** | 引导你跑通 Demo、从零集成、排查错误或添加新功能 | *"我想在 Web 应用里加视频会议"* · *"用户进房报错 6206"* · *"会议已接入，现在想加屏幕共享"* |
| **场景引导** | 加载完整场景，按顺序逐步实现每个能力，每步附代码和验证 | *"我想搭建一个会议应用"* · *"我想用 Conference 搭建一个医疗问诊场景"* |
| **AI 客服搭建** | 从零搭建语音优先的 AI 客服智能体，或将 AI 客服后端接入现有应用。覆盖密钥配置、能力组装（知识库、人工转接、工具调用、会话摘要）、服务启动全流程 | *"帮我用 TRTC 搭建一个 AI 客服"* · *"我想把 AI 客服能力集成到我的 Node.js 后端"* · *"帮我接入 TRTC Conversational AI"* |
| **AI 口语陪练** | 从零搭建语音优先的 AI 英语口语陪练教练，或将 AI 口语陪练后端接入现有应用。覆盖密钥配置、能力组装（场景角色扮演、单句纠正、接话建议、能力报告、自定义知识库）、服务启动全流程 | *"帮我用 TRTC 搭建一个 AI 口语陪练"* · *"我想把口语陪练能力集成到我的应用中"* · *"帮我搭建一个英语口语教练"* |
| **AI 实时翻译** | 从零搭建实时 AI 会议翻译，或将翻译后端接入现有应用。覆盖密钥配置、能力组装（实时翻译、会议扇出、双语字幕、转写记录）、服务启动全流程 | *"帮我用 TRTC 做一个 AI 实时会议翻译"* · *"我想把 AI 实时翻译能力接入我现有的会议室"* · *"帮我搭建一个同声传译系统"* |
| **Push 离线推送** | 通过 `trtc-push-mcp` 引导 TIMPush 集成和排障，覆盖 Android、iOS、Flutter、UniApp、厂商通道、APNs、角标、服务端 API 和控制台限制检查 | *"帮我集成 TIMPush"* · *"接入腾讯云离线推送"* · *"registerPush 报 800006"* |
| **文档查询** | 从官方知识库检索事实性问题，每个答案附来源引用 | *"错误码 6206 是什么意思？"* · *"Conference 按分钟怎么计费？"* · *"会议室最多支持多少人？"* |

Skill 会在项目中保存你的进度。关掉工具下次回来，可以从上次中断的地方继续，不需要重新复述你在做什么。

---

## 支持的产品与平台

| 产品 | 说明 | 可用状态 |
|------|------|---------|
| **Conference** | 视频会议——多人会议、屏幕共享、会中聊天 | Web ✅（Vue3 / React） |
| **Conversational AI** | 语音优先的 AI 智能体——AI 客服（语音对话、知识库检索、人工转接、工具调用、会话摘要）、AI 口语陪练（场景角色扮演、单句纠正、接话建议、能力报告）与 AI 实时翻译（多语言会议翻译、双语字幕、扇出编排） | Web ✅ |
| **Live** | 互动直播——主播/观众、连麦、弹幕、礼物、美颜 | 即将支持 |
| **Chat** | 即时通信——消息、会话、群组、用户资料 | Web ✅ |
| **Push** | 腾讯云即时通信推送 / 离线推送 TIMPush——Android/iOS 推送配置、厂商通道、APNs、Flutter、UniApp、角标、服务端 API 和排障 | Android / iOS / Flutter / UniApp ✅ |
| **Call** | 音视频通话——1v1 和群组通话 | 即将支持 |
| **RTC Engine** | 实时音视频引擎——进房、推流、拉流 | 即将支持 |


---

## 工作原理

当你描述要做什么时，Skill 会：

- **识别**你的 TRTC 产品和平台——从你的描述或项目文件中推断
- **询问**你的意图：跑通 Demo、从零集成、排查错误，还是在已有项目上扩展功能
- 对于集成任务，从知识库**匹配场景**，展示完整的能力清单——要实现什么、按什么顺序——确认后再开始
- **逐步推进**，每次只处理一个能力，给出可用代码，等你确认成功后再继续
- **保存进度**到项目根目录的 `.trtc-session.yaml`（自动加入 `.gitignore`），支持跨 session 续接

集成引导目前支持 **Conference Web（Vue3 / React 官方 RoomKit 路径）**、**Chat Web**、**Conversational AI（AI 客服、AI 口语陪练 & AI 实时翻译）** 和 **TIMPush 离线推送（Android / iOS / Flutter / UniApp）**。Conversational AI Skill 拥有独立的能力模型，不走 Slice/Scenario 流水线，而是通过自闭环的引导流程完成密钥配置、能力选择和服务启动。TIMPush 通过 `trtc-push-mcp` workflow engine 驱动平台识别、厂商配置、凭据安全的本地配置写入和排障流程。文档查询、错误码搜索、计费咨询全产品可用（Conference、Live、Chat、Call、RTC Engine、TIMPush）。

### 知识库：Slice 与 Scenario

Skill 的知识分两层：

**Slice** 是原子能力单元——每个功能对应一个 Slice，如 `conference/join-room`、`conference/screen-share`、`live/barrage`。每个 Slice 分两层：
- 产品级概览：功能说明、核心概念、最佳实践、排障指南（跨平台通用）
- 平台实现细节：具体 API、代码示例、平台特有注意事项

**Scenario** 是面向完整场景的 Slice 串联。例如「会议室」Scenario 按顺序链接多个 Slice——从鉴权、创建房间，到屏幕共享、成员管理、退出清理——以真实集成顺序排列。

---

## 相关链接

- [TRTC 文档](https://trtc.io/document)
- [控制台（国际站）](https://console.trtc.io)
- [控制台（中国站）](https://console.cloud.tencent.com)
- [下载 SDK](https://trtc.io/download)
- [提交问题](https://github.com/Tencent-RTC/agent-skills/issues)

---

## 联系我们

如需技术支持或企业定制优惠，可访问 [trtc.io/contact](https://trtc.io/contact) 提交联系方式，我们的团队将尽快与您联系。
