# TRTC Voice AI Starter Kit

[English](README.md) | **简体中文**

用 TRTC 搭一个 AI 语音助手 —— 从跑通 demo 到接进自己项目，只需要跑一条安装命令，之后全程在 IDE 聊天窗口里完成。

---

## 这是什么

一个装在你 IDE 里的 AI 引导工具，支持 Claude Code、Cursor、CodeBuddy 和 Codex。你描述需求，AI 助手替你把密钥配置、依赖安装、服务启动全搞定，最后给你一个能说话的 demo 或一套可以接进自己项目的代码。

**你最终拿到的：**
- 用户可以直接在浏览器里跟 AI 说话，有实时字幕和状态提示
- 一个在服务端处理签名和 AI 调度的后端，密钥不会跑到浏览器里
- 语音识别、大模型、语音合成三块都能按需更换：默认 ASR 用 TRTC ASR，TTS 用 TRTC 内置语音合成，开箱即用、不需要额外账号；大模型用你已有的任意 OpenAI 兼容服务
- 从零到第一次对话，大概 30 秒

---

## 技术栈

| | |
|---|---|
| **前端** | React 18 + Vite + TypeScript |
| **后端** | Node.js ≥ 18 / Fastify / TypeScript |
| **包管理** | pnpm workspaces |
| **LLM** | 任意 OpenAI 兼容服务，用你已有的即可（混元、OpenAI、DeepSeek 等） |
| **默认 STT** | TRTC ASR（bigmodel，支持 28 种语言） |
| **默认 TTS** | TRTC 内置 TTS（flow，无需额外账号） |
| **延迟** | 端到端 300ms 以内 |
| **平台（v1）** | Web（iOS / Android 后续版本支持） |

---

## 能做什么

这个 skill 是所有 TRTC 对话式 AI 接入需求的统一入口。告诉 AI 助手你想做什么，它来帮你选路：

| 场景 | 做什么 |
|---|---|
| **AI 客服助手** | 知识库问答 + 转人工 + 工单管理 |
| **AI 口语陪练** | 英语口语练习：场景对话、实时纠错、能力报告 |
| **会议实时口译** | 多方会议 AI 口译：双语字幕、多语言 |
| **从零跑通**（本 skill）| 先把 AI 语音对话跑起来，后续按自己需求开发 |

---

## 支持哪些模型

随时切换，告诉 AI 助手你想换哪家，它帮你改配置重启服务。

**大语言模型**

| 提供商 | 备注 |
|---|---|
| 腾讯混元 | 腾讯大模型，提供 OpenAI 兼容接口 |
| DeepSeek | 中文场景性价比最高 |
| MiniMax | 国内大模型 |
| OpenAI | GPT-4o、GPT-4o-mini 等 |
| Anthropic Claude | Claude 3 Haiku、Sonnet 等 |
| Google Gemini | Gemini 1.5 Flash、Pro 等 |
| Dify / Coze | 工作流式 LLM 平台（[Dify](https://trtc.io/document/79680.md) · [Coze](https://trtc.io/document/79681.md)） |

**语音识别（STT）**

| 提供商 | 语言 |
|---|---|
| TRTC ASR（默认）| 28 种语言 |
| Azure AI 语音 | 100+ 语言 |
| Deepgram | 30+ 语言 |
| Soniox | 英语 |

**语音合成（TTS）**

| 提供商 | 备注 |
|---|---|
| TRTC 内置 TTS（默认，flow）| 无需额外账号，多语言音色（[音色列表](https://trtc.io/document/79682)） |
| MiniMax | 多语言，自然度高 |
| Azure AI 语音 | 400+ 音色，140+ 语言 |
| ElevenLabs | 声音克隆 |
| Cartesia | 低延迟流式 |
| Inworld | 角色化风格 |
| 自定义 | 接自己的 HTTP TTS |

---

## 怎么用

**1. 描述你要做什么**
在 IDE 聊天窗口里说你想搭 AI 语音助手，skill 自动触发，先问你要哪种体验。

**2. 选场景**
AI 助手列出四个选项：从零跑通、AI 客服、口语陪练、会议口译。选客服 / 口语陪练 / 口译的，会路由到对应的专属 skill；选从零跑通的，继续往下走。

**3. 配 3 个密钥**
AI 助手只会在聊天里问你要 SDKAppID。其余密钥（TRTC 的 SDKSecretKey、腾讯云 API 密钥、大模型的 Key / 地址 / 模型名）都由你自己填进 `.env`，敏感信息不经过聊天框。AI 助手会说清楚每一项是干嘛用的、去哪里拿，填完后帮你统一验证。大概 5 分钟。

**4. 选接入方式**
- **Quick Start**：AI 助手装好依赖、起服务、给你一个链接，直接开说话
- **集成**：AI 助手给你后端代码和前端 React 片段，你接进自己项目，不生成演示 UI

**5. 开始对话**
打开 `localhost:5173`，点麦克风，跟 AI 说话。

---

## 环境要求

- Node.js ≥ 18
- pnpm ≥ 8（`npm install -g pnpm`）
- 腾讯云账号（免费注册：[国内站](https://console.cloud.tencent.com/trtc/app?utm_campaign=skill&_channel_track_key=lDTHxeje) · [海外站](https://console.trtc.io?utm_campaign=Agent-skills-general&_channel_track_key=tR91l0wy)）

---

## 安装

在项目目录里运行：

```bash
# 自动检测 IDE
npx -y @tencent-rtc/trtc-agent-skills@latest add

# 指定 IDE
npx -y @tencent-rtc/trtc-agent-skills@latest add --ide claude
npx -y @tencent-rtc/trtc-agent-skills@latest add --ide cursor

# 重装
npx -y @tencent-rtc/trtc-agent-skills@latest add --clean
```

装完之后直接在 IDE 聊天窗口里说需求，skill 自动激活。

---

## 常见问题

**不会编程也能用吗？**
可以。AI 助手带着你一步步走，你不需要自己敲命令。

**用哪个大模型？**
用你已有的任意 OpenAI 兼容服务就行，混元、DeepSeek、OpenAI 等都可以。把 Key、接口地址和模型名填进 `.env` 即可，不需要专门去申请某一家。

**支持中文对话吗？**
支持。默认识别英文，跟 AI 助手说一声就能换成中文（或其他语言），它会把识别语言和开场白一起改好；AI 会用你说话的语言回复。TRTC ASR bigmodel 引擎支持 28 种语言，切换不需要换 provider。需要更多语种（比如小语种），换 Azure STT（100+ 语言）就行；TTS 语种方面，Azure 和 ElevenLabs 覆盖最广。

**密钥会不会泄露？**
密钥只存在本地 `.env` 文件里，只在后端用，不会传到浏览器。

**Quick Start 和集成方式有什么区别？**
Quick Start 直接生成一个可以跑的 demo；集成方式给你代码片段，你自己接进已有项目，不会帮你生成任何界面。

**有实时字幕吗？**
有。Demo 里默认显示对话字幕。

**能用在正式项目里吗？**
后端的密钥签名和 Webhook 验证是按生产标准写的；UI 和业务逻辑是最简版本，你需要按自己的需求来扩展。

**支持手机端（iOS / Android）吗？**
v1 只有 Web 端的引导式集成。后端代码跟平台无关，移动端可以自己接，官方有快速接入文档：[iOS](https://trtc.io/document/69000.md) · [Android](https://trtc.io/document/69001.md)。v2 计划加上移动端引导。

---

## 关于 TRTC

[TRTC（腾讯实时音视频）](https://trtc.io/) 一次 API 调用（`StartAIConversation`）把语音识别、大模型调度、语音合成、打断处理和对话管理全串起来。全球 200+ 国家和地区节点，端到端延迟 300ms 以内。

---

## 相关链接

- [对话式 AI 完整文档索引](https://trtc.io/llms/conversational-ai.txt)（AI 可读格式）
- TRTC 控制台：[国内站](https://console.cloud.tencent.com/trtc/app?utm_campaign=skill&_channel_track_key=lDTHxeje) · [海外站](https://console.trtc.io?utm_campaign=Agent-skills-general&_channel_track_key=tR91l0wy)
- [API 参考：StartAIConversation](https://trtc.io/document/64963.md)
- [提交问题](https://github.com/Tencent-RTC/agent-skills/issues)
- [联系我们](https://trtc.io/contact)
