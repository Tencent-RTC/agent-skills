# TRTC AI 客服 Skill

[English](README.md) | [中文](README.zh-CN.md) | [日本語](README.ja.md)

> 零代码 AI 客服搭建器。只需在聊天窗口中说一句话，AI 会一步步引导你完成客服系统的搭建——无需终端、无需脚本、无需编程。

## 演示

https://github.com/user-attachments/assets/a2ad1d81-7282-42d1-b5ae-a0b9ec73933b

## 关于 Tencent RTC

[Tencent RTC](https://trtc.io)（实时音视频）为全球数千家企业提供实时音频、视频和对话式 AI 体验。依托覆盖 200+ 国家和地区的全球边缘网络，TRTC 提供低于 300ms 的超低延迟大规模实时通信能力。

**Conversational AI** 能力让开发者可以构建能够聆听、理解并自然回应的语音智能体——非常适合客服、销售辅助和智能自助服务场景。

## 这是什么？

将"基于 TRTC Conversational AI 的 AI 客服智能体"打包成一个即插即用的 Skill：

```
你（在 IDE 的 AI 聊天窗口中说）：
  "帮我用 TRTC 搭建一个 AI 客服"

AI（自动完成所有操作）：
  1. 检查你的运行环境
  2. 让你选择搭建模式（快速体验 / 集成到我的系统）
  3. 引导你完成 3 个密钥的配置（云服务凭证）
  4. 安装依赖并组装客服能力
  5. 启动服务并给你一个浏览器地址，直接查看效果

你完全不需要打开终端或手动执行任何脚本。
```

## 两种方式开始

> 本 Skill 的核心能力是 **TRTC Conversational AI（语音智能体）**。

| 模式 | 适合谁 | 能得到什么 | 需要做什么 |
|------|--------|-----------|-----------|
| **快速体验** | 想先看看效果的新用户 | 一个完整的语音智能体 Web 界面 + 工单管理后台 | 配置 3 个密钥 |
| **集成到我的系统** | 已有网站或应用、想嵌入 AI 智能体"大脑"的用户 | 后端 API 接口 + 接口规范 + 示例代码（不生成 UI） | 配置 3 个密钥 + 选择能力和交互模式 |

**无论选择哪种方式，AI 都会引导你走完每一步**——零编程经验也没问题。

## 唯一入口

[`SKILL.md`](./SKILL.md) — 由你的编程助手（CodeBuddy / Cursor / Claude Code）读取和执行。

> **任意位置安装**：本 Skill 可以放在项目子目录、`.agents/skills/`、`.codebuddy/skills/` 或任何位置——
> **不需要**放在工作区根目录。脚本会自动定位自身路径，Agent 只需使用绝对路径。

### 安装方式

通过 `npx` 安装 — 支持任意 IDE，无需插件市场。在项目根目录执行：

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

- "AI客服" / "搭建客服" / "客服机器人"
- "TRTC + 客服" / "语音智能体 + 客服"
- "帮我用 TRTC 搭建一个 AI 客服"

## 3 个密钥是什么？

要让客服智能体跑起来，你需要 3 个云服务凭证。别担心——它们只是从相应网站复制粘贴的 3 个字符串：

> **TRTC 和腾讯云是什么关系？** TRTC 的语音智能体服务运行在腾讯云上。简单理解：TRTC 负责客户与 AI 智能体之间的语音通话，腾讯云负责后台（权限校验、服务开通、计费等）。两者使用同一套登录体系，注册一次就能两边通用。

| 密钥 | 用途 | 获取地址 |
|------|------|---------|
| 密钥 1：TRTC 应用凭证 | 让智能体能够拨打电话和进行语音聊天 | https://console.trtc.io/?quickclaim=engine_trial（注册并创建 **RTC Engine** 应用，支持 Conversational AI） |
| 密钥 2：Tencent Cloud API Key | 证明你有权限使用 TRTC 语音和通话服务（登录态与 TRTC 账号自动同步） | https://console.tencentcloud.com/cam/capi |
| 密钥 3：LLM API Key | 让智能体能够"思考"——理解用户问题并回复 | 你注册的 AI 服务网站（如 OpenAI、DeepSeek 等） |

> AI 会一步步详细告诉你如何获取每个密钥。你的密钥信息仅用于本次配置会话——系统不会记录或泄露。

## 智能体有哪些能力？

| 能力 | 描述 | 快速体验 | 集成模式 |
|------|------|:---:|:---:|
| 对话 | 语音 + 文字双向交流 | ✅ 自动组装 | ✅ 默认包含 |
| 知识库 | 上传文档，智能体自动检索并回答常见问题 | ✅ 模拟演示 | 🔘 可选 |
| 人工转接 | 复杂问题自动转接至人工客服 | ✅ 模拟演示 | 🔘 可选 |
| 工具调用 | 智能体可主动查询你的系统中的数据 | ❌ 不支持 | 🔘 可选 |
| 会话摘要 | 每次对话后自动生成摘要 | ✅ 模拟演示 | 🔘 可选 |

> "模拟演示"指：界面和工作流是完整的，但使用的是演示数据，未接入真实业务系统。如需真实接入，请选择"集成到我的系统"。

## 通信模式（集成模式可选）

| 模式 | 描述 | 适用场景 |
|------|------|---------|
| 纯文字即时消息 | 智能体通过文字聊天回复 | 网页聊天插件、应用内消息 |
| 文字 + TTS | 智能体打字回复 + 语音朗读 | 智能音箱、语音助手 |
| 全模态 | 文字、语音、视频全部支持 | 高级客服场景 |
| 纯语音通话 | 智能体仅通过电话沟通 | 呼叫中心、热线 |

## 进阶：自定义 TRTC Conversational AI

如果你想微调 AI 智能体的语音行为或更换底层模型，请参阅 TRTC Conversational AI 官方文档：

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

如有其他配置需求，请从 Conversational AI 总览页出发寻找相应答案：

- [TRTC Conversational AI 总览](https://trtc.io/document/conversational-ai-overview?product=conversationalai)

## 目录结构

```
ai-service-skill/
├── SKILL.md                       # ★ 唯一入口（由编程助手触发）
├── start.sh                       # 启动脚本（自动安装依赖 + 启动服务）
│
├── scripts/                       # AI 调用的工具脚本
│   ├── verify-credentials.py      # 三密钥验证
│   ├── setup-credentials.py       # 交互式开发者配置
│   ├── add-capability.py          # 能力组装
│   ├── contract-adapt.py          # 接口契约适配
│   └── lib/                       # 共享模块
│
├── capabilities/
│   ├── conversation-core/         # 通用语音智能体骨架
│   ├── knowledge-base/            # FAQ 知识库检索
│   ├── tool-calling/              # 工具调用
│   ├── human-handoff/             # 人工转接 + 工单管理
│   ├── session-summary/           # 会话摘要
│   └── digital-human/             # 数字人（占位）
│
├── scenarios/
│   ├── customer-service/          # 路径 A：演示界面
│   └── custom-builder/            # 路径 B：能力选择向导
│
├── auto_adapters/                 # 技术栈适配器
└── tests/                         # 测试套件
```

## 常见问题

| 问题 | 解决方案 |
|------|---------|
| 密钥验证失败 | 返回密钥配置步骤，仔细检查每个密钥值 |
| 端口 3000 被占用 | 使用其他端口（如 `--port 8080`）或停止占用端口的程序 |
| Python 版本过低 | 从 python.org 下载安装 Python 3.9+ |
| 启动后浏览器显示空白页 | 强制刷新：`Cmd+Shift+R`（Mac）或 `Ctrl+Shift+R`（Windows） |
| 想接入真实业务系统 | 重新运行工作流，选择"集成到我的系统" |

---

> **最后再说一句**：本 Skill 的设计目标是让任何人——即使完全不会编程——都能搭起一个 AI 客服智能体。如果在过程中遇到任何问题，直接在聊天窗口中告诉 AI，它会帮你解决。

## 联系我们

如需技术支持或企业定制优惠，可访问 [trtc.io/contact](https://trtc.io/contact) 提交联系方式，我们的团队将尽快与您联系。
