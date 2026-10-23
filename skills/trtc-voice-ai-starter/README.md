# TRTC Voice AI Starter Kit

**English** | [简体中文](README.zh-CN.md)

Build a real-time voice AI agent for your web app using Tencent RTC — from a working demo to full integration, guided entirely by your IDE's AI assistant. No terminal, no manual scripts.

---

## What is TRTC Voice AI Starter Kit?

TRTC Voice AI Starter Kit is an AI-powered developer tool that guides you through integrating [Tencent RTC Conversational AI](https://trtc.io/) into a web application. It works as a Skill inside Claude Code, Cursor, CodeBuddy, or Codex — your AI assistant handles everything from credentials to a running voice agent.

**What you get:**
- A voice agent your users can speak with directly in the browser — with live subtitles and AI status feedback
- A backend service that handles credential signing, AI orchestration, and event logging — keys never leave the server
- Provider flexibility from day one — STT, LLM and TTS are all swappable. Defaults are TRTC ASR and TRTC built-in TTS (no extra account); bring any OpenAI-compatible LLM
- First conversation in ~30 seconds

---

## Quick specs

| | |
|---|---|
| **Frontend** | React 18 + Vite + TypeScript |
| **Backend** | Node.js ≥ 18 / Fastify / TypeScript |
| **Package manager** | pnpm workspaces |
| **LLM** | Any OpenAI-compatible provider you already use (Hunyuan, OpenAI, DeepSeek, …) |
| **Default STT** | TRTC ASR (bigmodel, 28 languages) |
| **Default TTS** | TRTC built-in TTS (flow, no extra account) |
| **Latency** | Sub-300ms edge-to-edge via TRTC global network |
| **Voice AI API** | `StartAIConversation` — 5 supported regions |
| **Platform (v1)** | Web only (iOS / Android coming in v2) |

---

## What you can build

This skill serves as the unified entry point for all TRTC Conversational AI integration. When you describe your use case, the AI assistant routes you to the right path:

| Use case | What the AI builds |
|---|---|
| **AI Customer Service** | Voice bot with knowledge base Q&A, human handoff, and ticket management dashboard |
| **AI Oral Coach** | English speaking practice: scenario roleplay, real-time sentence correction, 4-dimension ability reports |
| **Real-time AI Interpreter** | Live meeting interpretation: bilingual subtitles, multi-language support, meeting fanout |
| **Voice AI starter kit** (this skill) | Clean foundation with full-stack defaults — run a voice agent in ~30 seconds and build your own use case on top |

---

## Supported providers

Switch STT, LLM, or TTS at any time by telling your AI assistant — no code changes needed.

**LLM (Language Model)**
| Provider | Notes |
|---|---|
| Tencent Hunyuan | Tencent's LLM, OpenAI-compatible endpoint |
| OpenAI | GPT-4o, GPT-4o-mini, etc. |
| Google Gemini | Gemini 1.5 Flash, Pro |
| Anthropic Claude | Claude 3 Haiku, Sonnet |
| DeepSeek | Best value for Chinese conversations |
| MiniMax | Chinese-optimized |
| Dify / Coze | Workflow-based LLM platforms ([Dify docs](https://trtc.io/document/79680.md) · [Coze docs](https://trtc.io/document/79681.md)) |

**STT (Speech-to-Text)**
| Provider | Languages |
|---|---|
| TRTC ASR _(default)_ | 28 languages via `bigmodel` engine |
| Azure AI Speech | 100+ languages |
| Deepgram | 30+ languages |
| Soniox | English-optimized |

**TTS (Text-to-Speech)**
| Provider | Notes |
|---|---|
| TRTC built-in TTS _(default, flow)_ | No extra account, multi-language voices ([voice list](https://trtc.io/document/79682)) |
| MiniMax | Multi-language, high naturalness |
| Azure AI Speech | 400+ voices, 140+ languages |
| ElevenLabs | Voice cloning, ultra-realistic |
| Cartesia | Low-latency, streaming-optimized |
| Inworld | Character-style voices |
| Custom | Bring your own HTTP TTS endpoint |

---

## How it works

The starter kit is delivered as an IDE Skill. Your AI assistant handles the entire setup — you stay in the chat window.

**Step 1 — Describe what you want.** Tell your IDE's AI assistant you want to build a voice AI agent. The skill activates automatically and asks which experience you want to build.

**Step 2 — Choose your scenario.** The AI presents four options:

1. Start from scratch with the core voice AI capability (this starter kit)
2. AI Customer Service — routes to `trtc-ai-service` skill
3. AI Oral Coach — routes to `trtc-ai-oral-coach` skill
4. Real-time AI Interpreter — routes to `trtc-ai-realtime-interpreter` skill

**Step 3 — Configure 3 keys.** The AI only asks for your SDKAppID in chat. Every secret — the TRTC SDKSecretKey, the Tencent Cloud API key, and your LLM key, URL and model — you type into `.env` yourself, so nothing sensitive passes through the chat. The AI tells you what each field is for and where to get it, then verifies them all.

**Step 4 — Choose Quick Start or Integrate.**
- **Quick Start**: The AI installs dependencies, starts the server, and gives you a browser URL. Done.
- **Integrate**: The AI delivers backend endpoints and React snippets you paste into your existing project.

**Step 5 — Talk to your agent.** Open `localhost:5173`, click the mic, and start talking.

---

## Requirements

- Node.js ≥ 18
- pnpm ≥ 8 (`npm install -g pnpm`)
- A Tencent Cloud account ([free tier available](https://console.trtc.io?utm_campaign=Agent-skills-general&_channel_track_key=tR91l0wy)) for the TRTC and Tencent Cloud API keys
- An API key from any OpenAI-compatible LLM provider

---

## Installation

Install via `npx` inside your project directory:

```bash
# Auto-detect installed IDEs (Claude Code, Cursor, CodeBuddy, Codex)
npx -y @tencent-rtc/trtc-agent-skills@latest add

# Specific IDE
npx -y @tencent-rtc/trtc-agent-skills@latest add --ide claude
npx -y @tencent-rtc/trtc-agent-skills@latest add --ide cursor

# Clean reinstall
npx -y @tencent-rtc/trtc-agent-skills@latest add --clean
```

Once installed, just describe what you want in your IDE chat. The skill activates automatically — no slash command needed.

---

## Frequently asked questions

**Do I need coding experience?**
No. The AI assistant guides you through every step. You never open a terminal manually.

**Which LLM does it use?**
Whichever OpenAI-compatible provider you already have — Hunyuan, OpenAI, DeepSeek, and others. Fill in its key, URL and model in `.env`; there is no default provider to sign up for.

**What languages does the voice agent support?**
Speech recognition defaults to English; ask the AI assistant to switch it (e.g. to Chinese) and it updates the recognition language and greeting for you. The agent replies in whatever language you speak. TRTC ASR's `bigmodel` engine supports 28 languages without changing provider; for wider coverage, switch to Azure STT (100+ languages). TTS language coverage depends on the provider — ElevenLabs and Azure cover the widest range.

**Is my API key secure?**
Keys are stored only in a local `.env` file and used exclusively on the server side. The client (browser) never sees any credentials.

**What's the difference between Quick Start and Integrate?**
Quick Start generates a complete React + Fastify demo you can run immediately. Integrate gives you the backend code and React snippets to add voice AI to your existing project — no demo UI is generated.

**Does it support real-time subtitles?**
Yes. The demo includes real-time subtitles via TRTC custom message callbacks.

**Is it production-ready?**
The starter kit is designed as a foundation. The backend structure, credential handling (server-side signing, no client exposure), and webhook verification are production-grade. UI and business logic are intentionally minimal — you build those for your use case.

**Can I use this on mobile (iOS / Android)?**
Not in v1 — the guided integration is Web-only. The backend works with any platform. See the official quickstarts for mobile: [iOS](https://trtc.io/document/69000.md) · [Android](https://trtc.io/document/69001.md). iOS / Android guided integration is planned for v2.

---

## About Tencent RTC

[Tencent RTC](https://trtc.io/) (Real-Time Communication) delivers real-time audio, video, and conversational AI to thousands of businesses globally. Its Conversational AI platform combines streaming STT, LLM orchestration, TTS, interruption handling, and turn detection in a single API call (`StartAIConversation`).

- Global edge network: 200+ countries and regions
- Latency: sub-300ms

---

## Links

- [Full Conversational AI documentation](https://trtc.io/llms/conversational-ai.txt) — AI-readable index of all docs
- [TRTC Console](https://console.trtc.io?utm_campaign=Agent-skills-general&_channel_track_key=tR91l0wy)
- [API reference: StartAIConversation](https://trtc.io/document/64963.md)
- [Report an issue](https://github.com/Tencent-RTC/agent-skills/issues)
- [Contact us](https://trtc.io/contact)
