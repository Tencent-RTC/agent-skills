# TRTC AI Customer Service Skill

[English](README.md) | [中文](README.zh-CN.md) | [日本語](README.ja.md)

> A zero-code AI customer service builder. Just say a sentence in the chat window and the AI will guide you step by step to get your customer service system up and running — no terminal, no scripts, no coding required.

## Demo

https://github.com/user-attachments/assets/a2ad1d81-7282-42d1-b5ae-a0b9ec73933b

## About Tencent RTC

[Tencent RTC](https://trtc.io) (Real-Time Communication) powers real-time audio, video, and conversational AI experiences for thousands of businesses worldwide. With a global edge network spanning 200+ countries and regions, TRTC delivers sub-300ms ultra-low latency at scale.

The **Conversational AI** capability enables developers to build voice agents that can listen, understand, and respond naturally — perfect for customer service, sales assistance, and intelligent self-service scenarios.

## What is this?

Building an "AI customer service agent with TRTC Conversational AI" packaged into a plug-and-play Skill:

```
You (in your IDE's AI chat window):
  "Build me an AI customer service agent with TRTC"

AI (does everything automatically):
  1. Checks your runtime environment
  2. Lets you choose a setup mode (Quick Experience / Integrate into My System)
  3. Guides you through configuring 3 keys (cloud service credentials)
  4. Installs dependencies and assembles the customer service capabilities
  5. Starts the service and gives you a browser URL to see it in action

You never open a terminal or run a script manually.
```

## Two ways to start

> The core capability of this Skill is **TRTC Conversational AI (voice agent)**.

| Mode | Who it's for | What you get | What you need to do |
|------|-------------|-------------|---------------------|
| **Quick Experience** | First-timers who want to see what it looks like | A complete voice agent web UI + ticket management dashboard | Configure 3 keys |
| **Integrate into My System** | Users who already have a website or app and want to embed the AI agent's "brain" | Backend API endpoints + interface specs + sample code (no UI generated) | Configure 3 keys + choose capabilities and interaction modes |

**No matter which one you choose, the AI will walk you through every step** — zero programming experience needed.

## The only entry point

[`SKILL.md`](./SKILL.md) — Read and executed by your Coding Agent (CodeBuddy / Cursor / Claude Code).

> **Install anywhere**: This Skill can live in a project subdirectory, `.agents/skills/`, `.codebuddy/skills/`, or anywhere else —
> it does **not** need to be at the workspace root. Scripts are self-locating; the Agent just needs to use absolute paths.

### Installation

Install via `npx` — works with any IDE, no plugin marketplace required. Run it inside your project directory:

```bash
# Default — auto-detect installed IDEs (~/.{claude,cursor,codebuddy,codex}/)
# and install for each one found. Falls back to claude if none detected.
npx -y @tencent-rtc/trtc-agent-skills@latest add

# Force install for every supported IDE (even ones you don't have)
npx -y @tencent-rtc/trtc-agent-skills@latest add --ide all

# Install only for one specific IDE
npx -y @tencent-rtc/trtc-agent-skills@latest add --ide cursor

# Wipe a previous install before re-installing
npx -y @tencent-rtc/trtc-agent-skills@latest add --clean
```

### Trigger keywords

- "AI customer service" / "build customer service" / "customer service bot"
- "TRTC + customer service" / "voice agent + customer service"
- "Build me an AI customer service agent with TRTC"

## What are the 3 keys?

To get the customer service agent running, you need 3 cloud service credentials. Don't worry — they're just 3 strings you copy-paste from the corresponding websites.

> **How are TRTC and Tencent Cloud connected?** The TRTC Conversational AI service runs on Tencent Cloud. In simple terms: TRTC handles the voice calls between your customers and the AI agent, while Tencent Cloud handles the backend (permissions, service setup, billing, etc.). The two share the same login — register once and you're all set.

| Key | Purpose | Where to find it |
|-----|---------|-----------------|
| Key 1: TRTC Application Credentials | Lets the agent make calls and do voice chat | https://console.trtc.io/?quickclaim=engine_trial (register & create an **RTC Engine** app — supports Conversational AI) |
| Key 2: Tencent Cloud API Key | Proves you have permission to use Tencent Cloud voice & calling services (login syncs with your TRTC account) | https://console.tencentcloud.com/cam/capi |
| Key 3: LLM API Key | Lets the agent "think" — understand queries and respond | Your registered AI service website (e.g. OpenAI, DeepSeek, etc.) |

> The AI will tell you exactly how to get each key step by step. Your key info is only used for this configuration session — the system does not log or leak it.

## What capabilities does the agent have?

| Capability | Description | Quick Experience | Integration |
|------------|-------------|:---:|:---:|
| Conversation | Voice + text two-way communication | ✅ Auto-assembled | ✅ Default included |
| Knowledge Base | Upload docs, agent auto-retrieves and answers FAQ | ✅ Simulated demo | 🔘 Optional |
| Human Handoff | Complex issues auto-escalate to a human agent | ✅ Simulated demo | 🔘 Optional |
| Tool Calling | Agent can proactively query data from your system | ❌ Not supported | 🔘 Optional |
| Session Summary | Auto-generates a summary after each conversation | ✅ Simulated demo | 🔘 Optional |

> "Simulated demo" means: the UI and workflow are complete, but uses demo data without connecting to a real business system. For real integration, choose "Integrate into My System".

## Communication modes (optional for integration)

| Mode | Description | Best for |
|------|-------------|---------|
| Text-only IM | Agent replies via text chat | Web chat widgets, in-app messaging |
| Text + TTS | Agent types replies + reads them aloud | Smart speakers, voice assistants |
| Omni-modal | Text, voice, and video all supported | Advanced customer service scenarios |
| Voice-only Call | Agent communicates only via phone | Call centers, hotlines |

## Advanced: Customize TRTC Conversational AI

If you want to fine-tune the AI agent's voice behavior or change the underlying models, refer to the official TRTC Conversational AI documentation:

### Adjust voice parameters (speed / pitch / timbre)

Both STT (speech-to-text) and TTS (text-to-speech) are powered by Tencent's in-house engines. You can adjust voice parameters via the following documentation:

| Stage | Documentation |
|-------|--------------|
| STT (Speech-to-Text) | [STT configuration parameters](https://trtc.io/document/69592?product=conversationalai) |
| TTS (Text-to-Speech) | [TTS configuration parameters](https://trtc.io/document/68340?product=conversationalai) |

### Switch STT / LLM / TTS models

To change the underlying STT, LLM, or TTS models, check the model overview for each pipeline stage and follow the integration guide:

| Stage | Documentation |
|-------|--------------|
| STT (Speech-to-Text) | [STT Model Overview](https://trtc.io/document/69592?product=conversationalai) |
| LLM (Language Model) | [LLM Model Overview](https://trtc.io/document/68338?product=conversationalai) |
| TTS (Text-to-Speech) | [TTS Model Overview](https://trtc.io/document/68340?product=conversationalai) |

### STT supported languages

When `engine_model_type` is set to `bigmodel`, you can specify the audio language for STT. Supported languages: `zh` (Chinese), `en` (English), `yue` (Cantonese), `ar` (Arabic), `de` (German), `fr` (French), `es` (Spanish), `pt` (Portuguese), `id` (Indonesian), `it` (Italian), `ko` (Korean), `ru` (Russian), `th` (Thai), `vi` (Vietnamese), `ja` (Japanese), `tr` (Turkish), `hi` (Hindi), `ms` (Malay), `nl` (Dutch), `sv` (Swedish), `da` (Danish), `fi` (Finnish), `pl` (Polish), `cs` (Czech), `fil` (Filipino), `fa` (Persian), `el` (Greek), `ro` (Romanian), `hu` (Hungarian), `mk` (Macedonian).

### Full documentation

For any other configuration needs, start from the Conversational AI overview and navigate from there:

- [TRTC Conversational AI Overview](https://trtc.io/document/conversational-ai-overview?product=conversationalai)

## Directory structure

```
ai-service-skill/
├── SKILL.md                       # ★ The only entry point (triggered by Coding Agent)
├── start.sh                       # Bootstrap script (auto-install deps + start service)
│
├── scripts/                       # AI-invoked tool scripts
│   ├── verify-credentials.py      # 3-key verification
│   ├── setup-credentials.py       # Interactive developer setup
│   ├── add-capability.py          # Capability assembly
│   ├── contract-adapt.py          # Interface contract adaptation
│   └── lib/                       # Shared modules
│
├── capabilities/
│   ├── conversation-core/         # Generic Voice Agent skeleton
│   ├── knowledge-base/            # FAQ knowledge base retrieval
│   ├── tool-calling/              # Tool calling
│   ├── human-handoff/             # Human handoff + ticket management
│   ├── session-summary/           # Session summaries
│   └── digital-human/             # Digital human (placeholder)
│
├── scenarios/
│   ├── customer-service/          # Path A: Demo UI
│   └── custom-builder/            # Path B: Capability selection wizard
│
├── auto_adapters/                 # Tech stack adapters
└── tests/                         # Test suite
```

## FAQ

| Issue | Solution |
|-------|----------|
| Key verification failed | Go back to the key configuration step and double-check each key value |
| Port 3000 is in use | Use a different port (e.g. `--port 8080`) or stop the program occupying the port |
| Python version too low | Download and install Python 3.9+ from python.org |
| Browser shows blank page after startup | Hard refresh: `Cmd+Shift+R` (Mac) or `Ctrl+Shift+R` (Windows) |
| Want to connect a real business system | Re-run the workflow and choose "Integrate into My System" |

---

> **One last thing**: This Skill is designed so that anyone — even with zero coding experience — can get an AI customer service agent up and running. If you run into any issues along the way, just tell the AI in the chat window and it'll help you resolve them.

## Contact Us

Need technical support or enterprise pricing? Submit your contact information at [trtc.io/contact](https://trtc.io/contact) and our team will get back to you shortly.
