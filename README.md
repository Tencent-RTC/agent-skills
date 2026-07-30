# TRTC Agent Skills

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

- **Explore and evaluate** — Run a demo or understand the available integration options before changing your project.
- **Integrate capabilities** — Inspect your project, clarify requirements, and guide implementation step by step.
- **Extend existing integrations** — Add supported capabilities to an existing project without restarting the integration.
- **Troubleshoot issues** — Diagnose integration errors, configuration problems, and unexpected runtime behavior.
- **Find official information** — Answer questions about APIs, error codes, limits, pricing, and recommended practices with links to official documentation.
- **Resume previous work** — Save integration progress locally so you can continue in a later session.

---

## Supported Products & Platforms

| Product or scenario | Supported platforms | Guided capabilities | Sample prompts |
|---|---|---|---|
| **Conference** | Web (Vue 3 / React) | Demo setup, conference integration, screen sharing, in-meeting chat, feature extension, and troubleshooting | • *"Add video conferencing to my React app"*<br>• *"Walk me through building a complete conference room from scratch"*<br>• *"Conference is working — now add screen sharing"*<br>• *"Users get error 6206 when joining the room"* |
| **Conversational AI: Customer Service** | Web | Voice agent setup, knowledge base, human handoff, tool calling, session summary, and integration with an existing backend | • *"Build an AI customer service agent with TRTC"*<br>• *"Add voice-based AI support to my website"*<br>• *"Connect AI customer service to my existing Node.js backend"*<br>• *"Add knowledge-base answers and human handoff to my voice agent"* |
| **Conversational AI: Oral Coach** | Web | Scenario roleplay, quick correction, reply suggestions, ability reports, custom learning knowledge, and integration with an existing app | • *"Build an AI oral English coach with TRTC"*<br>• *"Add AI speaking practice to my existing app"* |
| **Conversational AI: Realtime Interpreter** | Web | Realtime translation, multilingual meeting interpretation, bilingual subtitles, transcription, and meeting fanout | • *"Build a real-time AI interpreter with TRTC"*<br>• *"Add real-time translation to my meeting room"*<br>• *"Show bilingual subtitles during a video conference"* |
| **Chat** | Web | Chat integration, messages, conversations, groups, user profiles, feature extension, and troubleshooting | • *"Add instant messaging to my web app"*<br>• *"Build a customer support chat page"*<br>• *"Add group chat to my existing React app"*<br>• *"Help me troubleshoot messages that are not being received"* |
| **Push** | Android / iOS / Flutter / UniApp | TIMPush setup, vendor channels, APNs, badges, server APIs, console limit checks, and troubleshooting | • *"Help me integrate TIMPush into my Android app"*<br>• *"Set up APNs offline push for my iOS app"*<br>• *"Configure vendor push channels for my Flutter app"*<br>• *"Add unread-message badges to push notifications"*<br>• *"`registerPush` failed with error 800006"* |
| **Call** | Flutter | Demo experience, 1-on-1 and group audio/video calls, embedding calls into an existing app, feature extension, and troubleshooting | • *"Let me try the Flutter calling demo"*<br>• *"Add 1-on-1 video calling to my Flutter app"*<br>• *"Add group audio calls to my existing app"*<br>• *"The incoming call screen is not appearing"* |
| **Live** | Coming soon | Guided integration is not yet available | • *"Show me the documentation for audience co-hosting"*<br>• *"What live-streaming capabilities does Tencent RTC provide?"* |
| **RTC Engine** | Coming soon | Guided integration is not yet available | • *"How do I publish and subscribe to audio and video tracks?"*<br>• *"Show me the RTC Engine room-management documentation"* |

Documentation lookup, error-code search, pricing questions, and product-limit questions are available across all Tencent RTC products, even when guided integration is not yet supported.

---

## How It Works

1. **Understand your request**  
   The skill identifies your goal, such as evaluating a demo, starting an integration, adding a capability, troubleshooting an issue, or looking up documentation.

2. **Inspect your project**  
   When project access is available, it detects the framework, platform, existing dependencies, and current integration state.

3. **Confirm the integration path**  
   It asks only the questions needed to determine the appropriate product, platform, and implementation approach.

4. **Guide and verify the implementation**  
   For supported workflows, it explains the planned changes, implements one capability at a time, and verifies the result before continuing.

5. **Save progress**  
   Integration progress is stored in `.trtc-session.yaml`, allowing a later session to continue from the previous checkpoint.

---

## Links

- [TRTC Documentation](https://trtc.io/document)
- [TRTC Console (International)](https://console.trtc.io)
- [TRTC Console (China)](https://console.cloud.tencent.com)
- [Report an issue](https://github.com/Tencent-RTC/agent-skills/issues)

---

## Contact Us

Need technical support or enterprise pricing? Submit your contact information at [trtc.io/contact](https://trtc.io/contact) and our team will get back to you shortly.
