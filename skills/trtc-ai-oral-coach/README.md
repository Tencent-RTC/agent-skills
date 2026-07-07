# AI Oral Coach Skill

> Build an AI English speaking coach powered by TRTC Conversational AI — zero code, voice-first. Two paths, both agent-driven: you just talk, the agent does the rest.

## Demo

https://github.com/user-attachments/assets/9e586749-d810-4c5a-bb27-356a3b74d486

## About Tencent RTC

[Tencent RTC](https://trtc.io) (Real-Time Communication) powers real-time audio, video, and conversational AI experiences for thousands of businesses worldwide. With a global edge network spanning 200+ countries and regions, TRTC delivers sub-300ms ultra-low latency at scale.

The **Conversational AI** capability enables developers to build voice agents that can listen, understand, and respond naturally — perfect for language learning, speaking practice, and interactive tutoring.

## What is this?

A plug-and-play Skill that builds an AI English speaking coach — packaged into a single agent-driven workflow:

```
You (in your IDE's AI chat window):
  "Build me an AI English speaking coach"

AI (does everything automatically):
  1. Checks your runtime environment
  2. Lets you choose Quick Experience or Integrate into My System
  3. Guides you through 3 keys setup (cloud service credentials)
  4. Installs dependencies and assembles coach capabilities
  5. Starts the service and gives you a browser URL

You never open a terminal or run a script manually.
```

## Two ways to start

| Mode | Who it's for | What you get | What you need |
|------|-------------|-------------|---------------|
| **Quick Experience** | First-timers who want to see it in action | Full 3-screen SPA (scenario practice + sentence correction + reply suggestions + 4-dimension report) | 3 keys |
| **Integrate into My System** | Users who already have an app and want backend capabilities | Backend API endpoints + integration samples (no UI) | 3 keys + choose coach capabilities |

## What are the 3 keys?

To get the coach running, you need 3 cloud service credentials:

| Key | Purpose | Where to find it |
|-----|---------|-----------------|
| 1: TRTC App Credentials | Voice channel for the coach | https://console.trtc.io/?quickclaim=engine_trial |
| 2: Tencent Cloud API Key | Backend permissions (login syncs with TRTC) | https://console.tencentcloud.com/cam/capi |
| 3: LLM API Key | The coach's "brain" — understand, correct, generate reports | Your AI provider (OpenAI, DeepSeek, etc.) |

## What capabilities does the coach have?

| Capability | Description | Quick Experience | Integration |
|------------|-------------|:---:|:---:|
| Scenario Roleplay | Scene × difficulty × style → dynamic roleplay | ✅ Default | 🔘 Optional |
| Quick Correct | Per-sentence speaking-style correction | ✅ Default | 🔘 Optional |
| Reply Suggestion | Conversation continuation hints | ✅ Default | 🔘 Optional |
| Ability Report | 4-dimension analysis report (en/zh bilingual) | ✅ Default | 🔘 Optional |
| Custom Learning KB | Connect your own teaching materials (Dify/Coze) | ❌ | 🔘 Optional |

> 💡 Evaluator capabilities (roleplay/correct/suggest/report) share a single `Evaluator` Port — swap LLM or prompt = "swap the brain", no core changes needed.

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

- "AI oral coach" / "AI English coach" / "speaking coach"
- "oral coach" / "english tutor bot" / "speaking practice"
- "TRTC + oral coach" / "TRTC + speaking practice"
- "帮我搭个 AI 英语口语陪练" / "AI口语陪练"

## Directory structure

```
ai-oral-coach/
├── SKILL.md                 # Agent execution SOP (lean)
├── README.md                # English (main)
├── README.zh-CN.md          # Chinese
├── README.ja.md             # Japanese
├── triggers.yaml            # Trigger word registry
├── start.sh                 # Bootstrap (venv + deps + FastAPI:8000)
├── capabilities/            # Atomic capabilities (shipped with repo, auto-mounted)
│   ├── conversation-core/   # Skeleton: FastAPI + voice pipeline (shared with AI CS)
│   ├── scenario-roleplay/   # Scene roleplay composer
│   ├── quick-correct/       # Per-sentence correction
│   ├── reply-suggestion/    # Conversation hints
│   ├── ability-report/      # 4-dimension report
│   └── custom-learning-kb/  # External KB adapter (Dify/Coze)
├── auto_adapters/            # Path B: API integration code templates (headless, no UI)
│   ├── manifest.yaml
│   ├── web/                 # JS/TS oral-coach-client.js
│   ├── python/              # Python coach_client.py
│   └── integration_templates/  # L3 fallback + KB spec
├── scenarios/speaking-coach/
│   ├── recipe.yaml          # Path A default assembly
│   └── ui/                  # 3-screen SPA (coach.html/i18n.js/tokens.css)
├── scripts/
│   ├── verify-credentials.py
│   └── add-capability.py
└── references/
    ├── evaluator-port.md
    └── design-specs.md
```

## FAQ

| Issue | Solution |
|-------|----------|
| Key verification failed | Go back and double-check each key value |
| Port 8000 is in use | Use a different port (`--port 8080`) or free port 8000 |
| Python version too low | Install Python 3.9+ from python.org |
| Browser shows blank page | Hard refresh: `Cmd+Shift+R` (Mac) / `Ctrl+Shift+R` (Windows) |
| Want to connect your own teaching materials | Re-run and choose Path B, opt in custom-learning-kb |

## Contact Us

Need technical support or enterprise pricing? Submit your contact information at [trtc.io/contact](https://trtc.io/contact) and our team will get back to you shortly.
