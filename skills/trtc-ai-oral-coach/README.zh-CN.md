# AI 口语陪练 Skill

> 基于腾讯云 TRTC Conversational AI 构建 AI 英语口语陪练 —— 零代码、voice-first。两条路径均由 Agent 全程驱动：你只管说话，其余交给 Agent。

## Demo

https://github.com/user-attachments/assets/9e586749-d810-4c5a-bb27-356a3b74d486

## 关于 Tencent RTC

[Tencent RTC](https://trtc.io)（实时音视频通信）为全球数千家企业提供实时音频、视频和对话式 AI 能力，全球边缘网络覆盖 200+ 国家和地区，端到端延迟低于 300ms。

**Conversational AI** 能力让开发者可以构建能听、能理解、能自然回应的语音智能体 —— 特别适合语言学习、口语练习和互动教学场景。

## 这是什么？

一个开箱即用的 Skill，把「用 TRTC 搭建 AI 英语口语陪练」打包成 Agent 全程驱动的工作流：

```
你（在 IDE 的 AI 聊天窗口里）：
  "帮我搭个 AI 英语口语陪练"

AI（全程自动处理）：
  1. 检查运行环境
  2. 让你选快速体验还是集成到自己的系统
  3. 一步步带你配 3 把钥匙（云服务凭据）
  4. 安装依赖、装配教练能力
  5. 启动服务并给你浏览器入口地址

你全程不用打开终端、不用手动跑脚本。
```

## 两种开始方式

| 模式 | 适合谁 | 你能拿到什么 | 你需要做的 |
|------|--------|-------------|-----------|
| **快速体验** | 想先看看效果的人 | 完整的三屏 SPA（场景陪练 + 单句纠正 + 接话建议 + 4维报告） | 配 3 把钥匙 |
| **集成到我的系统** | 已有 App，想接入后端能力 | 后端 API 接口 + 集成示例（不生成 UI） | 配 3 把钥匙 + 选择教练能力 |

## 3 把钥匙是什么？

要让教练开口说话，需要配 3 个云服务凭据：

| 钥匙 | 用途 | 在哪里获取 |
|------|------|-----------|
| 1: TRTC 应用凭据 | 教练的语音通道 | https://console.trtc.io/?quickclaim=engine_trial |
| 2: 腾讯云 API 密钥 | 后台权限（和 TRTC 同一套登录，不用重新注册） | https://console.tencentcloud.com/cam/capi |
| 3: LLM API Key | 教练的"大脑"——听懂你、纠正你、出报告 | 你的 AI 服务商（OpenAI、DeepSeek 等） |

## 教练有哪些能力？

| 能力 | 说明 | 快速体验 | 集成模式 |
|------|------|:---:|:---:|
| 场景角色扮演 | 场景×难度×风格 → 动态角色对话 | ✅ 默认安装 | 🔘 可选 |
| 单句纠正 | 逐句口语风格纠正 | ✅ 默认安装 | 🔘 可选 |
| 接话建议 | 对话接续提示 | ✅ 默认安装 | 🔘 可选 |
| 能力报告 | 4维分析报告（中英双语） | ✅ 默认安装 | 🔘 可选 |
| 自有知识库 | 接入你自己的教研内容（Dify/Coze） | ❌ | 🔘 可选 |

> 💡 评估类能力（角色扮演/纠正/建议/报告）共用一个 `Evaluator` Port —— 换 LLM 或 prompt 即「换大脑」，不改骨架代码。

## 安装

通过 `npx` 安装，支持所有主流 IDE，在项目目录下运行：

```bash
# 默认 —— 自动检测已安装的 IDE 并逐一安装
npx -y @tencent-rtc/trtc-agent-skills@latest add

# 强制安装所有支持的 IDE
npx -y @tencent-rtc/trtc-agent-skills@latest add --ide all

# 只安装某一个 IDE
npx -y @tencent-rtc/trtc-agent-skills@latest add --ide cursor

# 清除旧安装后重新安装
npx -y @tencent-rtc/trtc-agent-skills@latest add --clean
```

## 触发关键词

- "AI口语陪练" / "AI英语陪练" / "口语教练"
- "oral coach" / "english tutor" / "speaking practice"
- "帮我搭个英语口语陪练" / "用 TRTC 做个口语教练"

## 目录结构

```
ai-oral-coach/
├── SKILL.md                 # Agent 执行 SOP（精炼版）
├── README.md                # 英文版（主 README）
├── README.zh-CN.md          # 本文件
├── README.ja.md             # 日文版
├── triggers.yaml            # 触发词注册文件
├── start.sh                 # 启动脚本（建 venv + 装依赖 + 起 FastAPI:8000）
├── capabilities/            # 能力原子化（随仓库发布，core 预接线自动挂载）
│   ├── conversation-core/   # 骨架：FastAPI + 语音管线（与 AI 客服共享）
│   ├── scenario-roleplay/   # 场景角色扮演
│   ├── quick-correct/       # 单句纠正
│   ├── reply-suggestion/    # 接话建议
│   ├── ability-report/      # 4维能力报告
│   └── custom-learning-kb/  # 外部知识库适配（Dify/Coze）
├── auto_adapters/            # Path B：API 接入代码模板（无 UI，纯代码）
│   ├── manifest.yaml
│   ├── web/                 # JS/TS oral-coach-client.js
│   ├── python/              # Python coach_client.py
│   └── integration_templates/  # L3 降级指南 + KB 规范
├── scenarios/speaking-coach/
│   ├── recipe.yaml          # Path A 默认装配清单
│   └── ui/                  # 三屏 SPA（coach.html / i18n.js / tokens.css）
├── scripts/
│   ├── verify-credentials.py
│   └── add-capability.py
└── references/
    ├── evaluator-port.md
    └── design-specs.md
```

## 常见问题

| 问题 | 解决方案 |
|------|---------|
| 密钥校验失败 | 回到密钥配置步骤，逐一检查每个 key 的值 |
| 8000 端口被占用 | 换个端口（`--port 8080`）或释放 8000 端口 |
| Python 版本太低 | 从 python.org 安装 Python 3.9+ |
| 启动后浏览器白屏 | 强制刷新：`Cmd+Shift+R`（Mac）/ `Ctrl+Shift+R`（Windows） |
| 想接入自己的教材内容 | 重走流程选"集成到我的系统"，勾选 custom-learning-kb |

## 联系我们

需要技术支持或企业方案？通过 [trtc.io/contact](https://trtc.io/contact) 提交联系方式，我们的团队会尽快与您联系。
