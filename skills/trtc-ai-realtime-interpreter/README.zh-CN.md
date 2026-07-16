# TRTC AI 实时翻译 Skill

[English](README.md) | [中文](README.zh-CN.md) | [日本語](README.ja.md)

> 基于 TRTC Conversational AI 构建的 AI 实时会议翻译——零代码、语音优先。两条路径，全程由 AI 引导：你只需开口说话，AI 帮你搞定一切。

## 关于 Tencent RTC

[Tencent RTC](https://trtc.io/?utm_source=github&utm_medium=skill&utm_campaign=Twitter%20AI%20%E4%B8%93%E9%A1%B9%20-%20AI%20Oral%20Coach&_channel_track_key=HIzH2eVJ)（实时音视频）为全球数千家企业提供实时音频、视频和对话式 AI 体验。依托覆盖 200+ 国家和地区的全球边缘网络，TRTC 提供低于 300ms 的超低延迟大规模实时通信能力。

**Conversational AI** 能力让开发者可以构建能够聆听、理解并自然回应的语音智能体——非常适合实时翻译、多语言会议和跨语言沟通场景。

## 这是什么？

将"基于 TRTC Conversational AI 的实时会议翻译"打包成一个即插即用的 Skill：

```
你（在 IDE 的 AI 聊天窗口中说）：
  "帮我用 TRTC 做一个 AI 实时会议翻译"

AI（自动完成所有操作）：
  1. 检查你的运行环境
  2. 让你选择搭建模式（快速体验 / 集成到我的系统）
  3. 引导你完成 3 个密钥的配置（云服务凭证）
  4. 安装依赖并组装翻译能力
  5. 启动服务并给你一个浏览器地址，直接查看效果

你完全不需要打开终端或手动执行任何脚本。
```

## 两种方式开始

> 本 Skill 的核心能力是 **TRTC Conversational AI（语音优先）实时翻译**。

| 模式 | 适合谁 | 能得到什么 | 需要做什么 |
|------|--------|-----------|-----------|
| **快速体验** | 想先看看效果的新用户 | 一个完整的 Vue3 会议室 + AI 实时翻译（谁说话都有翻译 + 双语字幕 + 转写面板） | 配置 3 个密钥 |
| **集成到我的系统** | 已有会议室、直播间或应用、只想接入翻译能力的用户 | 后端 API 接口 + 集成示例代码（不生成 UI） | 配置 3 个密钥 |

> **无论选择哪种方式，AI 都会引导你走完每一步**——零编程经验也没问题。

## 唯一入口

[`SKILL.md`](./SKILL.md) — 由你的编程助手（CodeBuddy / Cursor / Claude Code）读取和执行。

> **任意位置安装**：本 Skill 可以放在项目子目录、`.agents/skills/`、`.codebuddy/skills/` 或任何位置——**不需要**放在工作区根目录。脚本会自动定位自身路径，Agent 只需使用绝对路径。

## 安装方式

通过 `npx` 安装 — 支持任意 IDE，无需插件市场。在项目根目录执行：

```bash
# 默认 — 自动检测已安装的 IDE 并安装
npx -y @tencent-rtc/trtc-agent-skills@latest add

# 强制为所有支持的 IDE 都安装
npx -y @tencent-rtc/trtc-agent-skills@latest add --ide all

# 只为某个指定的 IDE 安装
npx -y @tencent-rtc/trtc-agent-skills@latest add --ide cursor

# 重装前先清理旧的安装
npx -y @tencent-rtc/trtc-agent-skills@latest add --clean
```

## 触发关键词

- "实时翻译" / "AI 翻译" / "同声传译" / "会议翻译" / "TRTC 翻译"
- "real-time interpreter" / "real-time translation" / "AI interpreter"
- "TRTC Conversational AI" / "会议实时翻译" / "跨语言会议"
- "帮我用 TRTC 做一个 AI 实时会议翻译"
- "Help me build a real-time AI interpreter with TRTC"
- "把 AI 实时翻译能力接入我现有的直播间"

## 3 个密钥是什么？

要让翻译智能体跑起来，你需要 3 个云服务凭证。别担心——它们只是从相应网站复制粘贴的 3 个字符串：

> **TRTC 和腾讯云是什么关系？** TRTC 的对话式 AI 服务运行在腾讯云上。简单理解：TRTC 负责参会者与 AI 智能体之间的语音通话，腾讯云负责后台（权限校验、服务开通、计费等）。两者使用同一套登录体系，注册一次就能两边通用。

| 密钥 | 用途 | 获取地址 |
|------|------|---------|
| 密钥 1：TRTC 应用凭证 | 让翻译智能体能够进行语音通话 | https://console.trtc.io/?quickclaim=engine_trial&utm_source=github&utm_medium=skill&utm_campaign=Twitter%20AI%20%E4%B8%93%E9%A1%B9%20-%20AI%20Oral%20Coach&_channel_track_key=3WFHfiqw（注册并创建 **RTC Engine** 应用，支持 Conversational AI） |
| 密钥 2：腾讯云 API 密钥 | 证明你有权限使用 TRTC 语音和通话服务（登录态与 TRTC 账号自动同步） | https://console.tencentcloud.com/cam/capi?utm_source=github&utm_medium=skill&utm_campaign=Twitter%20AI%20%E4%B8%93%E9%A1%B9%20-%20AI%20Oral%20Coach&_channel_track_key=v0K1Q0DSE |
| 密钥 3：LLM API 密钥 | 翻译智能体的"大脑"——实时听懂并翻译语音 | 你注册的 AI 服务网站（如 OpenAI、DeepSeek 等） |

> AI 会一步步详细告诉你如何获取每个密钥。你的密钥信息仅用于本次配置会话——系统不会记录或泄露。

## 翻译能力有哪些？

| 能力 | 描述 | 快速体验 | 集成模式 |
|------|------|:---:|:---:|
| 对话骨架 | 语音通道 + UserSig 签发 + 凭证管理（骨架，必装） | ✅ 自动组装 | ✅ 默认包含 |
| 实时翻译 | 语言对驱动的实时翻译（STT → LLM 翻译 → TTS 播报 + 字幕） | ✅ 默认 | 🔘 可选 |
| 会议扇出 | 按参会人批量扇出翻译（房间内谁说话都有翻译） | ✅ 默认 | 🔘 可选 |
| 双语字幕 | 实时双语字幕显示（原文 + 译文并列显示） | ✅ 内置 | ✅ 内置 |
| 转写面板 | 整场会议的双语转写记录 | ✅ 内置 | ✅ 内置 |
| 房主控制 | 仅会议室主持人可以开关 AI 翻译（Demo 设计） | ✅ 内置 | 🔘 自定义鉴权 |

> 💡 `realtime-translation` 和 `meeting-ops` 能力共用同一套 `conversation-core` 骨架——替换语言对配置即可支持不同翻译方向。

## 支持的语言对

| 模式 ID | 源语言 | 目标语言 | STT 识别语种 | TTS 音色 | 翻译方向 |
|---------|--------|----------|-------------|----------|---------|
| `zh-en` | 中文 | 英语 | `zh` | `v-female-p9Xy7Q1L` | 中英双向（中文 ↔ 英文） |
| `zh-yue` | 中文 | 粤语 | `zh` | `v-female-k3P8sL0Q` | 普通话 ↔ 粤语双向 |
| `en-yue` | 英语 | 粤语 | `en` | `v-female-k3P8sL0Q` | 英文 ↔ 粤语双向 |

> 语言对可扩展——在 `modes.py` 中新增条目即可支持更多翻译方向。所有 TTS 音色均为 TRTC 对话式 AI 内置音色（`flow_01_turbo`），全程闭环在 TRTC 生态内。
>
> **需要更多语言？** TRTC Conversational AI 支持远超上述默认配置的 STT 语种和 TTS 音色。你可以：
> - 查看 [STT 支持语种](https://trtc.io/document/69592?product=conversationalai) 和 [TTS 音色列表](https://trtc.io/document/68340?product=conversationalai)，切换到覆盖目标语言的内置模型
> - 通过配置文档在 TRTC 生态内切换到第三方 STT/TTS 模型
> - [联系我们的技术团队](https://trtc.io/contact) 获取定制语言对方案——我们会帮你找到最合适的模型组合

## 进阶：自定义 TRTC Conversational AI

如果你想微调 AI 翻译智能体的声音行为或更换底层模型，请参阅 TRTC Conversational AI 官方文档：

### 调整声音参数（语速 / 音调 / 音色）

STT（语音识别）和 TTS（语音合成）均使用腾讯自研引擎。你可以通过以下文档调整声音参数：

| 阶段 | 文档 |
|------|------|
| STT（语音识别） | [STT 配置参数](https://trtc.io/document/69592?product=conversationalai) |
| TTS（语音合成） | [TTS 配置参数](https://trtc.io/document/68340?product=conversationalai) |

### 切换 STT / LLM / TTS 模型

如需更换底层 STT、LLM 或 TTS 模型，请查看各环节的模型总览并按照接入指引操作：

| 阶段 | 文档 |
|------|------|
| STT（语音识别） | [STT 模型总览](https://trtc.io/document/69592?product=conversationalai) |
| LLM（大语言模型） | [LLM 模型总览](https://trtc.io/document/68338?product=conversationalai) |
| TTS（语音合成） | [TTS 模型总览](https://trtc.io/document/68340?product=conversationalai) |

### STT 支持语种

当 `engine_model_type` 指定为 `bigmodel` 时，可指定音频语种。支持语种包括：`zh`（中文）、`en`（英语）、`yue`（粤语）、`ar`（阿拉伯语）、`de`（德语）、`fr`（法语）、`es`（西班牙语）、`pt`（葡萄牙语）、`id`（印尼语）、`it`（意大利语）、`ko`（韩语）、`ru`（俄语）、`th`（泰语）、`vi`（越南语）、`ja`（日语）、`tr`（土耳其语）、`hi`（印地语）、`ms`（马来语）、`nl`（荷兰语）、`sv`（瑞典语）、`da`（丹麦语）、`fi`（芬兰语）、`pl`（波兰语）、`cs`（捷克语）、`fil`（菲律宾语）、`fa`（波斯语）、`el`（希腊语）、`ro`（罗马尼亚语）、`hu`（匈牙利语）、`mk`（马其顿语）。

### 完整文档

如有其他配置需求，请从 [Conversational AI 总览](https://trtc.io/document/71130?product=conversationalai) 页面出发寻找相关文档。

## 目录结构

```
trtc-ai-realtime-interpreter/
├── SKILL.md                    # Agent 执行 SOP（唯一入口）
├── README.md                   # English（主文档）
├── README.zh-CN.md             # Chinese
├── README.ja.md                # Japanese
├── start.sh                    # 骨架启动脚本（venv + deps + FastAPI:8020）
├── capabilities/               # 原子能力包（随仓库发布，自动挂载）
│   ├── conversation-core/      # 骨架：FastAPI + 语音通道 + 凭证签发
│   ├── realtime-translation/   # 语言对翻译逻辑（STT/LLM/TTS）
│   └── meeting-ops/            # 多目标扇出编排（无内置权限）
├── scenarios/
│   └── meeting-interpreter/    # Path A 默认场景：Vue3 会议室 + AI 翻译叠加层
│       ├── recipe.yaml         # 组装配方
│       ├── backend/            # 场景专属后端（房主鉴权、HTTP 托管）
│       └── ui/                 # Vue3 前端（会议室、工具栏、转写面板）
├── auto_adapters/              # Path B：无 UI API 集成模板
│   ├── manifest.yaml
│   ├── python/
│   │   └── fastapi_reverse_proxy.py.tpl
│   └── integration_templates/
│       ├── generic-rest-api.md
│       └── room-owner-authz-note.md
└── scripts/                    # 凭证校验 / 能力安装 / 安装后检查 / 部署
    ├── verify-credentials.py
    ├── add-capability.py
    ├── post-install-patch.py
    ├── deploy-demo.sh
    └── lib/
```

## 常见问题

| 问题 | 解决方法 |
|------|---------|
| 密钥校验失败 | 回到配置步骤逐项核对——注意要用服务端的 SDKSecretKey（不是客户端的 STSecretKey） |
| TRTC_REGION 不匹配 | 检查 TRTC 应用所在站点：国际站应用必须用 `intl` |
| 8020 端口被占用 | 换端口或释放端口：`lsof -ti :8020 -sTCP:LISTEN \| xargs kill` |
| Python 版本太旧 | 去 [python.org](https://www.python.org/downloads/) 安装 Python 3.9+ |
| 缺少 Node.js / npm | 去 [nodejs.org](https://nodejs.org/) 安装 Node.js LTS 版本 |
| 浏览器打开是空白页 | 强制刷新：Mac `Cmd+Shift+R` / Windows `Ctrl+Shift+R` |
| 报"No such file"错误 | Agent 可能用了相对路径——从正确的 SKILL_ROOT 重新执行 |
| 多人同时说话，TTS 声音叠放 | v1 已知限制，多人同时说话时多路翻译的 TTS 播报会叠加 |
| 想接入自己已有的会议室系统 | 重新运行并选择 Path B（集成到我的系统） |

## 联系我们

需要技术支持或企业定价方案？请通过 [trtc.io/contact](https://trtc.io/contact) 提交你的联系方式，我们的团队会尽快回复。
