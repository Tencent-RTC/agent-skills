# TRTC AI Integration

**English** | [简体中文](README.zh.md)

An agent skill provided by [TRTC](https://trtc.io/?utm_source=github&utm_medium=skill&utm_campaign=Twitter%20AI%20%E4%B8%93%E9%A1%B9%20-%20AI%20Oral%20Coach&_channel_track_key=HIzH2eVJ) (Tencent Real-Time Communication) to help developers integrate real-time audio/video, live streaming, instant messaging, and TIMPush offline push into their apps — from first setup to production-ready code.

Instead of reading through long documentation, you describe what you want to build in plain language. The skill routes your request to the right knowledge, asks a few clarifying questions, and walks you through the integration step by step.

You can use it to build scenarios like video conferencing, live streaming rooms, 1-on-1 video consultations, online classrooms, customer support chat, or mobile offline push — across Web, iOS, Android, Flutter, and more.

---

## About Tencent RTC

[Tencent RTC](https://trtc.io/?utm_source=github&utm_medium=skill&utm_campaign=Twitter%20AI%20%E4%B8%93%E9%A1%B9%20-%20AI%20Oral%20Coach&_channel_track_key=HIzH2eVJ) (Real-Time Communication) powers real-time audio, video, and conversational AI experiences for thousands of businesses worldwide. With a global edge network spanning 200+ countries and regions, TRTC delivers sub-300ms ultra-low latency at scale.

---

## Installation

Use the npx installer. Run it inside your project directory:

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

---

## What it does

The skill activates automatically when you mention TRTC or describe a real-time communication use case. No slash commands needed — just ask in plain language.

| | What it does | Example prompts |
|---|---|---|
| **Get started** | Guides you through demo setup, SDK integration, troubleshooting, or adding a new feature — step by step | • *"I want to add video conferencing to my web app"*<br>• *"I'm getting error 6206 when users join"*<br>• *"Conference is working — now I want to add screen sharing"* |
| **Scenario walkthrough** | Loads a complete feature scenario and walks you through each capability in order, with code and checkpoints | • *"Walk me through building a complete conference room from scratch"*<br>• *"Guide me through a 1-on-1 video consultation end to end"* |
| **AI customer service** | Builds a voice-first AI customer service agent from scratch — or wires the AI backend into your existing app. Covers credential setup, capability assembly (knowledge base, human handoff, tool calling, session summary), and launch | • *"Build me an AI customer service agent with TRTC"*<br>• *"I want to integrate AI customer service into my existing Node.js backend"*<br>• *"Help me set up TRTC Conversational AI"* |
| **AI oral coach** | Builds a voice-first AI oral English speaking coach from scratch — or wires the AI backend into your existing app. Covers credential setup, capability assembly (scenario roleplay, quick correction, reply suggestions, ability report, custom learning KB), and launch | • *"Build me an AI oral English coach with TRTC"*<br>• *"I want to integrate AI speaking practice into my existing app"*<br>• *"Help me set up an AI speaking coach"* |
| **AI realtime interpreter** | Builds a real-time AI meeting interpreter from scratch — or wires the translation backend into your existing app. Covers credential setup, capability assembly (realtime translation, meeting fanout, bilingual subtitles, transcription), and launch | • *"Build me a real-time AI interpreter with TRTC"*<br>• *"I want to add real-time translation to my meeting room"*<br>• *"Help me set up AI meeting interpretation"* |
| **Push offline push** | Guides TIMPush integration and troubleshooting via `trtc-push-mcp`, covering Android, iOS, Flutter, UniApp, vendor channel setup, APNs, badge, server API, and console limit checks | • *"Help me integrate TIMPush"*<br>• *"Integrate Tencent Cloud offline push"*<br>• *"registerPush failed with 800006"* |
| **Docs & lookup** | Answers factual questions from the official knowledge base with cited sources | • *"What does error code 6206 mean?"*<br>• *"How much does Conference cost per participant minute?"*<br>• *"What's the max number of participants?"* |

The skill saves your progress in the project. If you close the tool and come back later, it picks up where you left off.

---

## Supported Products & Platforms

| Product | Description | Availability |
|---------|-------------|--------------|
| **Conference** | Video conferencing — multi-party meetings, screen sharing, in-meeting chat | Web ✅ (Vue3 / React) |
| **Conversational AI** | Voice-first AI agents — AI customer service (voice agent, knowledge base, human handoff, tool calling, session summary), AI oral coach (scenario roleplay, quick correction, reply suggestions, ability report), and AI realtime interpreter (multilingual meeting interpretation, bilingual subtitles, fanout orchestration) | Web ✅ |
| **Live** | Interactive live streaming — anchor/audience roles, co-hosting, barrage, gifts, beauty filters | Coming soon |
| **Chat** | Instant messaging — messages, conversations, groups, user profiles | Web ✅ |
| **Push** | Tencent Cloud IM Push / offline push — Android/iOS push setup, vendor channels, APNs, Flutter, UniApp, badge, server API, and troubleshooting | Android / iOS / Flutter / UniApp ✅ |
| **Call** | Audio/video calling — 1-on-1 and group calls | Coming soon |
| **RTC Engine** | Low-level real-time audio/video engine — room management, publishing, subscribing | Coming soon |


---

## How It Works

When you describe what you want to build, the skill:

- **Identifies** your TRTC product and platform — from your message or by reading your project files
- **Asks** what you're trying to do: run a demo, start a new integration, troubleshoot an error, or add a feature to an existing project
- For integrations, **picks a scenario** from the knowledge base that matches your use case and shows you the full capability list — what will be implemented, in what order — before starting
- **Walks through** one capability at a time with production-ready code, waits for you to confirm it works, then moves to the next step
- **Saves your progress** to `.trtc-session.yaml` in your project root (auto-added to `.gitignore`) so you can resume in a later session without re-explaining what you're building

Step-by-step integration is currently available for **Conference on Web (Vue3 / React official RoomKit path)**, **Chat on Web**, **Conversational AI (AI customer service, AI oral coach & AI realtime interpreter)**, and **TIMPush offline push (Android / iOS / Flutter / UniApp)**. The Conversational AI skills use their own capability model — they do not follow the slice/scenario pipeline; instead they guide you through credential setup, capability selection, and launch in a self-contained flow. TIMPush uses the `trtc-push-mcp` workflow engine to drive platform detection, vendor setup, credential-safe local configuration, and troubleshooting. Docs lookup, error code search, and pricing questions work across all TRTC products.

### Knowledge base: Slices and Scenarios

The skill's knowledge is structured into two layers:

**Slices** are atomic capability units — one slice per feature, such as `conference/join-room`, `conference/screen-share`, or `live/barrage`. Each slice has two levels:
- A product-level overview (concepts, best practices, troubleshooting, cross-platform notes)
- A platform-level implementation (exact APIs, code samples, platform-specific gotchas)

**Scenarios** are curated sequences of slices for complete use cases. For example, the *Conference Room* scenario chains multiple slices — from authentication and room creation through screen sharing, member management, and cleanup — in the order a real implementation would follow.

---

## Links

- [TRTC Documentation](https://trtc.io/document)
- [TRTC Console (International)](https://console.trtc.io)
- [TRTC Console (China)](https://console.cloud.tencent.com)
- [Report an issue](https://github.com/Tencent-RTC/agent-skills/issues)

---

## Contact Us

Need technical support or enterprise pricing? Submit your contact information at [trtc.io/contact](https://trtc.io/contact) and our team will get back to you shortly.
