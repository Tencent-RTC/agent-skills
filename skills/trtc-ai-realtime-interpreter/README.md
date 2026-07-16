# TRTC AI Realtime Interpreter Skill

[English](README.md) | [中文](README.zh-CN.md) | [日本語](README.ja.md)

> Build an AI real-time meeting interpreter powered by TRTC Conversational AI — zero code, voice-first. Two paths, both agent-driven: you just talk, the agent does the rest.

## About Tencent RTC

[Tencent RTC](https://trtc.io/?utm_source=github&utm_medium=skill&utm_campaign=Twitter%20AI%20%E4%B8%93%E9%A1%B9%20-%20AI%20Oral%20Coach&_channel_track_key=HIzH2eVJ) (Real-Time Communication) powers real-time audio, video, and conversational AI experiences for thousands of businesses worldwide. With a global edge network spanning 200+ countries and regions, TRTC delivers sub-300ms ultra-low latency at scale.

The **Conversational AI** capability enables developers to build voice agents that can listen, understand, and respond naturally — perfect for real-time interpretation, multilingual meetings, and cross-language communication scenarios.

## What is this?

A plug-and-play Skill that builds an AI real-time meeting interpreter — packaged into a single agent-driven workflow:

```
You (in your IDE's AI chat window):
  "Help me build a real-time AI interpreter with TRTC"

AI (does everything automatically):
  1. Checks your runtime environment
  2. Lets you choose Quick Experience or Integrate into My System
  3. Guides you through 3 keys setup (cloud service credentials)
  4. Installs dependencies and assembles interpreter capabilities
  5. Starts the service and gives you a browser URL

You never open a terminal or run a script manually.
```

## Two ways to start

> The core capability of this Skill is **TRTC Conversational AI (voice-first) real-time interpretation**.

| Mode | Who it's for | What you get | What you need |
|------|-------------|-------------|---------------|
| **Quick Experience** | First-timers who want to see it in action | A complete Vue3 meeting room + AI interpreter (anyone speaks → translated + bilingual subtitles + transcription panel) | 3 keys |
| **Integrate into My System** | Users who already have a meeting room, live room, or app and want backend interpretation | Backend API endpoints + integration samples (no UI generated) | 3 keys |

> **No matter which path you choose, the AI walks you through every step** — zero coding experience needed.

## The only entry point

[`SKILL.md`](./SKILL.md) — Read and executed by your Coding Agent (CodeBuddy / Cursor / Claude Code).

> **Install anywhere**: This Skill can live in a project subdirectory, `.agents/skills/`, `.codebuddy/skills/`, or any location — it does **not** need to be at the workspace root. Scripts self-locate and the agent only needs absolute paths.

## Installation

Install via `npx` — works with any IDE, no plugin marketplace required. Run inside your project directory:

```bash
# Default — auto-detect installed IDEs and install for each one found
npx -y @tencent-rtc/trtc-agent-skills@latest add

# Force install for every supported IDE
npx -y @tencent-rtc/trtc-agent-skills@latest add --ide all

# Install only for one specific IDE
npx -y @tencent-rtc/trtc-agent-skills@latest add --ide cursor

# Wipe a previous install before re-installing
npx -y @tencent-rtc/trtc-agent-skills@latest add --clean
```

## Trigger keywords

- "实时翻译" / "AI 翻译" / "同声传译" / "会议翻译" / "TRTC 翻译"
- "real-time interpreter" / "real-time translation" / "AI interpreter"
- "TRTC Conversational AI" / "会议实时翻译" / "跨语言会议"
- "帮我用 TRTC 做一个 AI 实时会议翻译"
- "Help me build a real-time AI interpreter with TRTC"
- "把 AI 实时翻译能力接入我现有的直播间"

## What are the 3 keys?

To get the interpreter running, you need 3 cloud service credentials. Don't worry — they're just 3 strings you copy and paste from the respective websites:

> **How are TRTC and Tencent Cloud related?** TRTC's Conversational AI service runs on Tencent Cloud. Simply put: TRTC handles the voice calls between participants and the AI agent, while Tencent Cloud handles the backend (permissions, service activation, billing, etc.). Both share the same login — register once and use both.

| Key | Purpose | Where to find it |
|-----|---------|-----------------|
| 1: TRTC App Credentials | Voice channel for the interpreter | https://console.trtc.io/?quickclaim=engine_trial&utm_source=github&utm_medium=skill&utm_campaign=Twitter%20AI%20%E4%B8%93%E9%A1%B9%20-%20AI%20Oral%20Coach&_channel_track_key=3WFHfiqw (Sign up and create an **RTC Engine** app — supports Conversational AI) |
| 2: Tencent Cloud API Key | Backend permissions (login syncs with TRTC) | https://console.tencentcloud.com/cam/capi?utm_source=github&utm_medium=skill&utm_campaign=Twitter%20AI%20%E4%B8%93%E9%A1%B9%20-%20AI%20Oral%20Coach&_channel_track_key=v0K1Q0DSE |
| 3: LLM API Key | The interpreter's "brain" — understand and translate speech in real time | Your AI provider (OpenAI, DeepSeek, etc.) |

> The AI will guide you step-by-step on how to obtain each key. Your key information is only used during this setup session — the system does not record or leak it.

## What capabilities does the interpreter have?

| Capability | Description | Quick Experience | Integration |
|------------|-------------|:---:|:---:|
| Conversation Core | Voice pipeline + UserSig signer + credential management (skeleton, required) | ✅ Auto-assembled | ✅ Default included |
| Realtime Translation | Language-pair-driven real-time translation (STT → LLM translate → TTS + subtitle) | ✅ Default | 🔘 Optional |
| Meeting Ops | Multi-participant fanout orchestration (translate for everyone in the room) | ✅ Default | 🔘 Optional |
| Bilingual Subtitles | Real-time bilingual subtitle display (original + translation side by side) | ✅ Built-in | ✅ Built-in |
| Transcription Panel | Session transcription history with bilingual view | ✅ Built-in | ✅ Built-in |
| Host-only Control | Only the room host can toggle AI interpretation (demo design) | ✅ Built-in | 🔘 Your own auth |

> 💡 `realtime-translation` and `meeting-ops` capabilities share the same `conversation-core` skeleton — swap the language pair configuration to support different translation directions.

## Supported language pairs

| Mode ID | Source Language | Target Language | STT Language | TTS Voice | Direction |
|---------|----------------|-----------------|--------------|-----------|-----------|
| `zh-en` | Chinese | English | `zh` | `v-female-p9Xy7Q1L` | Bidirectional (zh ↔ en) |
| `zh-yue` | Chinese | Cantonese | `zh` | `v-female-k3P8sL0Q` | Bidirectional (Mandarin ↔ Cantonese) |
| `en-yue` | English | Cantonese | `en` | `v-female-k3P8sL0Q` | Bidirectional (en ↔ Cantonese) |

> Language pairs are extensible — add more entries in `modes.py` to support additional translation directions. All TTS voices are built-in TRTC Conversational AI voices (`flow_01_turbo`), fully contained within the TRTC ecosystem.
>
> **Need more languages?** TRTC Conversational AI supports a wide range of STT languages and TTS voices beyond the defaults above. You can:
> - Check the [STT supported languages](https://trtc.io/document/69592?product=conversationalai) and [TTS voice list](https://trtc.io/document/68340?product=conversationalai) to switch to built-in models that cover your target languages
> - Switch to third-party STT/TTS models within the TRTC ecosystem via the configuration docs
> - [Contact our technical team](https://trtc.io/contact) for custom language pair requirements — we'll help you find the right model combination

## Advanced: Customize TRTC Conversational AI

If you want to fine-tune the AI interpreter's voice behavior or change the underlying models, refer to the official TRTC Conversational AI documentation:

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

When `engine_model_type` is set to `bigmodel`, you can specify the audio language for STT. Supported languages include: `zh` (Chinese), `en` (English), `yue` (Cantonese), `ar` (Arabic), `de` (German), `fr` (French), `es` (Spanish), `pt` (Portuguese), `id` (Indonesian), `it` (Italian), `ko` (Korean), `ru` (Russian), `th` (Thai), `vi` (Vietnamese), `ja` (Japanese), `tr` (Turkish), `hi` (Hindi), `ms` (Malay), `nl` (Dutch), `sv` (Swedish), `da` (Danish), `fi` (Finnish), `pl` (Polish), `cs` (Czech), `fil` (Filipino), `fa` (Persian), `el` (Greek), `ro` (Romanian), `hu` (Hungarian), `mk` (Macedonian).

### Complete documentation

For other configuration needs, start from the [Conversational AI Overview](https://trtc.io/document/71130?product=conversationalai) page.

## Directory structure

```
trtc-ai-realtime-interpreter/
├── SKILL.md                    # Agent execution SOP (the only entry point)
├── README.md                   # English (main)
├── README.zh-CN.md             # Chinese
├── README.ja.md                # Japanese
├── start.sh                    # Bootstrap (venv + deps + FastAPI:8020)
├── capabilities/               # Atomic capabilities (shipped with repo, auto-mounted)
│   ├── conversation-core/      # Skeleton: FastAPI + voice pipeline + credential signer
│   ├── realtime-translation/   # Language-pair translation logic (STT/LLM/TTS)
│   └── meeting-ops/            # Multi-target fanout orchestration (no auth built-in)
├── scenarios/
│   └── meeting-interpreter/    # Path A default: Vue3 meeting room + AI interpreter overlay
│       ├── recipe.yaml         # Assembly recipe
│       ├── backend/            # Scenario-specific backend (host auth, HTTP serve)
│       └── ui/                 # Vue3 frontend (conference room, toolbar, transcript)
├── auto_adapters/              # Path B: headless API integration templates
│   ├── manifest.yaml
│   ├── python/
│   │   └── fastapi_reverse_proxy.py.tpl
│   └── integration_templates/
│       ├── generic-rest-api.md
│       └── room-owner-authz-note.md
└── scripts/                    # Verify credentials / add capability / post-install patch / deploy
    ├── verify-credentials.py
    ├── add-capability.py
    ├── post-install-patch.py
    ├── deploy-demo.sh
    └── lib/
```

## FAQ

| Issue | Solution |
|-------|----------|
| Key verification failed | Go back and double-check each key value — make sure you're using the server-side SDKSecretKey (not STSecretKey) |
| TRTC_REGION mismatch | Check your TRTC app region: international site apps must use `intl` |
| Port 8020 is in use | Use a different port or free port 8020: `lsof -ti :8020 -sTCP:LISTEN \| xargs kill` |
| Python version too low | Install Python 3.9+ from [python.org](https://www.python.org/downloads/) |
| Node.js / npm missing | Install Node.js LTS from [nodejs.org](https://nodejs.org/) |
| Browser shows blank page | Hard refresh: `Cmd+Shift+R` (Mac) / `Ctrl+Shift+R` (Windows) |
| "No such file" errors | The agent may have used a relative path — re-run from the correct SKILL_ROOT |
| Multiple TTS voices overlapping | Known v1 limitation when multiple participants speak simultaneously |
| Want to connect your own meeting system | Re-run and choose Path B (Integrate into My System) |

## Contact Us

Need technical support or enterprise pricing? Submit your contact information at [trtc.io/contact](https://trtc.io/contact) and our team will get back to you shortly.
