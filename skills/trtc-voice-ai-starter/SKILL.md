---
name: trtc-voice-ai-starter
version: 1.0.0
description: >
  Use when the user has a conversational AI / voice agent integration
  intent but has NOT explicitly named a specific scenario at the
  dispatcher level. Triggers on: "TRTC conversational AI", "AI 对话",
  "voice agent", "build voice AI", "AI 对话接入", "对话式 AI 怎么接",
  "搭建 AI 对话", "AI 语音对话", "AI 语音聊天", "语音 AI", "voice AI quickstart",
  "AI 语音助手", "voice AI 骨架",
  "TRTC voice AI", "voice agent demo", "AI 对话从零开始".
  Do NOT trigger when: (a) user already named a scenario explicitly —
  dispatcher routes those directly; (b) target platform is iOS / Android /
  Flutter — Web-only, route to trtc-docs; (c) user only needs standalone
  STT / TTS APIs without a conversation loop — route to trtc-docs.
---

# TRTC Voice AI Starter Kit

---

## §0 AGENTS.md Priority

If the user's CWD has a `template/`-generated `AGENTS.md`:
- Architecture / convention questions → trust `AGENTS.md`
- Skill workflow / setup questions → trust this file
- Safety red lines → both must agree; mismatch = bug, warn user

---

## §1 Entry Guards

Check before §5. If any row matches, stop and redirect immediately.

| Condition | Action |
|---|---|
| User mentioned **iOS** as target | Tell user: "Guided integration is currently available for Web only. For iOS, you can follow the official documentation to implement it yourself: https://trtc.io/document/69000.md" Stop. |
| User mentioned **Android** as target | Tell user: "Guided integration is currently available for Web only. For Android, you can follow the official documentation to implement it yourself: https://trtc.io/document/69001.md" Stop. |

---

## §2 Interaction Language Detection

Detect once from the triggering message. Store as `interaction_lang` (`zh` or `en`).
All AI guidance text, options, and summaries follow `interaction_lang`. Update if user switches.

---

## §3 Prompt Reporting

Host bootstrap handles reporting. On `TRTC_REPORTING_NOTICE_REQUIRED_V1`: finish answer first, host hook displays `runtime/continuation-notice.md`. Fallback: stdin prompt once if host did not record.

---

## §4 Path Baseline

| Variable | Meaning |
|---|---|
| `SKILL_ROOT` | This skill's directory (contains `SKILL.md`) |
| `TEMPLATE_ROOT` | `$SKILL_ROOT/template` |
| `PROJECT_ROOT` | User's workspace root |

Fallback if `SKILL_ROOT` unknown:
```bash
find "$PWD" -maxdepth 5 -name SKILL.md -path '*voice-ai-starter*' 2>/dev/null | head -1
```
Always substitute path variables with absolute paths. Never ask user to move directories.

---

## §5 Scene Identification and Routing

**First action after language detection** — run before any environment checks. Present a single-choice question in `interaction_lang`:

**If `interaction_lang == zh`:**
> "你好！在开始之前，先告诉我你想搭建哪种 AI 语音对话体验，我来帮你选择最合适的方式。"

选项：
1. **从零跑通 AI 对话** — 快速实现 AI 语音对话的核心能力，你可以在此基础上按自己的需求继续开发
2. **AI 客服助手** — 搭建一个能接待用户、回答常见问题、必要时转接人工的 AI 语音客服系统
3. **AI 口语陪练** — 用 AI 辅助英语口语练习，支持场景对话、实时纠错和学习能力报告
4. **会议实时口译** — 给多方视频会议接入 AI 实时口译，生成双语字幕，支持多种语言

**If `interaction_lang == en`:**
> "Before we dive in — which voice AI experience are you looking to build? I'll guide you through the right path."

Options:
1. **Get started with voice AI** — Quickly get the core voice AI capability running, then build your own use case on top
2. **AI Customer Service** — Build a voice AI customer service agent with knowledge base Q&A, human handoff, and ticket management
3. **AI Oral Coach** — AI-powered English speaking practice: scenario roleplay, real-time correction, and ability reports
4. **Real-time AI Interpreter** — Add live AI interpretation to meetings: bilingual subtitles and multi-language support

**Routing** — the option number, the label and the target must be read off a
single row. Do not renumber this table without renumbering the option lists
above it: an earlier revision had the numbers shifted by one against the
labels, which silently sent "get started" users into the customer-service
skill.

| Option | Label (zh / en) | Target | Owner frontmatter name | `product` |
|---|---|---|---|---|
| 1 | 从零跑通 AI 对话 / Get started with voice AI | §5.1 below — stay in this skill | `trtc-voice-ai-starter` | `conversational-ai` |
| 2 | AI 客服助手 / AI Customer Service | `../trtc-ai-service/SKILL.md` | `trtc-ai-customer-service-skill` | `ai-service` |
| 3 | AI 口语陪练 / AI Oral Coach | `../trtc-ai-oral-coach/SKILL.md` | `ai-oral-coach-skill` | `oral-coach` |
| 4 | 会议实时口译 / Real-time AI Interpreter | `../trtc-ai-realtime-interpreter/SKILL.md` | `trtc-ai-realtime-interpreter` | `realtime-interpreter` |

- Option 1 → continue to §5.1.
- Options 2–4 → Read the target `SKILL.md` and execute it. **Stop** — do not
  continue into §5.1 or any later section of this file.
- The paths are relative to this skill's own directory, so the `../` prefix is
  required; `trtc-ai-service/SKILL.md` does not resolve from here.
- The final reporting `invoke` must use the **owner frontmatter name** from the
  table, never the directory name or the `product` value.

### §5.1 Path Selection

Present a single-choice question in `interaction_lang`:

```json
[{
  "id": "path",
  "question": "How would you like to get started?",
  "options": [
    "Quick Start — working demo in browser in ~30 seconds",
    "Integrate — backend API + React snippets for your existing project"
  ],
  "multiSelect": false
}]
```
- Quick Start → §8
- Integrate → §9

---

## §6 Environment Check

**Check A · .env status** (run after scene selection, before §7)
```bash
test -f "$TEMPLATE_ROOT/.env" && echo FOUND || echo MISSING
```
- FOUND → run `node "$TEMPLATE_ROOT/scripts/verify-credentials.mjs" --type all`.
  `ok:true` → keys configured before; confirm reuse, or go to §7 if user wants
  to reconfigure. `ok:false` → §7 (only the failing fields need attention).
- MISSING → must complete §7 before proceeding

**Check B · Runtime readiness** (run only immediately before `start.sh` in §8 Step 4)
```bash
cd "$TEMPLATE_ROOT" && bash start.sh --check
```
Script verifies Node ≥ 18, pnpm, and project structure. Show output to user and stop if not OK.

---

## §7 Three Keys Configuration

> Triggered when §6 Check A is not OK, or any key fails verify.

Key 1 and Key 2 come from the same Tencent Cloud account. Key 3 comes from
whichever LLM provider the user already uses.

**Only the SDKAppID is collected in chat.** Every secret (SDKSecretKey,
SecretId / SecretKey, LLM API key) and the LLM URL / model are filled in by the
user directly in `.env`. Never ask the user to send any of them in the chat.

### §7.1 Keys

Use `interaction_lang` throughout. Run the steps in order — Steps 2 and 3 edit
`.env` while it still holds no secrets.

**Step 1 · Prepare `.env`.** Run the `.gitignore` check in §7.4 first, then:
```bash
cd "$TEMPLATE_ROOT" && (test -f .env || cp .env.example .env) && chmod 600 .env
```

**Step 2 · Collect the SDKAppID (chat).** Explain Key 1's purpose (table
below), point the user to the TRTC console (links below) → Create Application →
select **Conversational AI** type → choose region (doc: 69002), and ask them to
send the **SDKAppID** only. It must be all digits; write it to
`TRTC_SDK_APP_ID` in `.env`.

**Console links — copy VERBATIM, never strip or rebuild the query string:**

| Purpose | `interaction_lang == zh` (show both) | `interaction_lang == en` (show only this) |
|---|---|---|
| Key 1 · TRTC (SDKAppID + SDKSecretKey) | 国内站：https://console.cloud.tencent.com/trtc/app?utm_campaign=skill&_channel_track_key=lDTHxeje<br>海外站：https://console.trtc.io?utm_campaign=Agent-skills-general&_channel_track_key=tR91l0wy | https://console.trtc.io?utm_campaign=Agent-skills-general&_channel_track_key=tR91l0wy |
| Key 2 · Tencent Cloud API | 国内站：https://console.cloud.tencent.com/cam/capi?utm_term=cam%E5%AF%86%E9%92%A5-%E5%9B%BD%E5%86%85&utm_campaign=skill&_channel_track_key=hTRQ0ctd<br>海外站：https://console.tencentcloud.com/cam/capi?utm_term=cam%E5%AF%86%E9%92%A5&utm_campaign=skill&_channel_track_key=zb44We6s | https://console.tencentcloud.com/cam/capi?utm_term=cam%E5%AF%86%E9%92%A5&utm_campaign=skill&_channel_track_key=zb44We6s |

For English users, never show the 国内站 links. For Chinese users, tell them
to use the same site for Key 1 and Key 2, and that the site must match the
region chosen in §7.1.1 (`ap-guangzhou` = 国内站, the other four = 海外站).

**Step 3 · Region.** Run §7.1.1 and write `TENCENT_CLOUD_REGION`.

**Step 4 · User fills in the rest.** Give the user the absolute path of
`$TEMPLATE_ROOT/.env`, the fields below with their purpose and where to get
them, and ask them to save the file and reply when done (e.g. "填好了" / "done").
Then go to §7.2.

| # | Key | Purpose — tell user this | Where to get it | Fields the user fills in `.env` |
|---|---|---|---|---|
| 1 | TRTC | Voice channel. SDKAppID identifies your TRTC application (already collected in Step 2); SDKSecretKey is used on the server to sign room-entry tokens. ⚠️ You need **SDKSecretKey** (server-side), not STSecretKey (client-side) — they look similar but are different. | Same application page in the Key 1 console link above | `TRTC_SDK_SECRET_KEY` |
| 2 | Tencent Cloud API | Control plane — used to call `StartAIConversation` and the other backend APIs. Same Tencent Cloud account as Key 1, no separate registration needed. | Key 2 console link above | `TENCENT_CLOUD_SECRET_ID` · `TENCENT_CLOUD_SECRET_KEY` |
| 3 | LLM | The AI "brain" — understands what the user says and generates replies. Any OpenAI-compatible provider works; use the one you already have. | That provider's console. URL / model examples are in the comments of `.env` and in `references/provider-config.md` | `LLM_API_KEY` · `LLM_API_URL` · `LLM_MODEL` |

Do not pick an LLM provider for the user. If they ask which to use, list the
options from `references/provider-config.md` without recommending a default.

### §7.1.1 Region Selection

`StartAIConversation` only supports 5 regions (per [API doc](https://trtc.io/document/64963)):

Present a single-choice question in `interaction_lang`:

- If `interaction_lang == zh` → show all 5 options:
  ```
  ap-guangzhou  (中国大陆)
  ap-singapore  (新加坡)
  ap-tokyo      (日韩)
  na-ashburn    (美东)
  na-siliconvalley (美西)
  ```
- If `interaction_lang == en` → show 4 options (omit `ap-guangzhou`):
  ```
  ap-singapore  (Southeast Asia / Singapore)
  ap-tokyo      (Northeast Asia / Tokyo)
  na-ashburn    (East US / Virginia)
  na-siliconvalley (West US / Silicon Valley)
  ```

Write `TENCENT_CLOUD_REGION=<selected>` to `.env`.

### §7.2 Verify

Run after the user says `.env` is filled in:
```bash
node "$TEMPLATE_ROOT/scripts/verify-credentials.mjs" --type all
```

Parse stdout JSON:
- Success: `{"ok":true,"type":"...","message":"..."}`
- Failure: `{"ok":false,"errors":[{"code":"E001","message":"..."}]}`
Read `errors[0].code` for the error code. Multiple errors may be present —
report every failing field at once, ask the user to fix them in `.env`, then
re-run.

### §7.3 Error Codes

| Code | Cause | Tell user |
|---|---|---|
| E000 | `.env` missing | "`.env` was not found — I'll recreate it from `.env.example`" (re-run §7.1 Step 1) |
| E001 | TRTC failed | "Check in `.env`: ① SDKAppID belongs to your account ② SDKSecretKey vs STSecretKey" |
| E002 | Tencent Cloud API failed | "Check in `.env`: ① SecretId/Key swapped ② Key disabled ③ STS not enabled" |
| E003 | LLM failed | "Check in `.env`: `LLM_API_KEY`, `LLM_API_URL` and `LLM_MODEL` must all be filled in and belong to the same provider" |
| E004 | Network unreachable | "Check proxy / firewall. The TRTC API host for your region must be reachable on :443 — `trtc.tencentcloudapi.com` for `ap-guangzhou`, `trtc.intl.tencentcloudapi.com` otherwise" |

### §7.4 Security Red Lines

**Handling the keys**
- Never ask for a secret in chat. Only the SDKAppID (not a secret) is
  collected there; the user types every secret into `.env` themselves.
- If the user pastes a secret into chat anyway, do not repeat it — ask them to
  put it in `.env` instead.
- Never pass keys as CLI args, and never read or print secret values from `.env`
- `chmod 600 "$TEMPLATE_ROOT/.env"` after creating it

**Defaults that are safe only on localhost.** The template ships two endpoints
that are deliberately open for local development. Both log a warning on every
startup. If the user binds the server to anything other than localhost — a LAN
address, a container, a tunnel, a cloud host — state these before proceeding:

| `.env` | Default | What the default means |
|---|---|---|
| `USERSIG_AUTH_TOKEN` | empty | `GET /userSig` is **unauthenticated**: anyone who can reach the port mints room credentials for any `userId`, billed to the user's account. Set it (`openssl rand -hex 32`) before exposing the port. |
| `WEBHOOK_SIGNING_SECRET` | empty | `/webhook/agent-events` **rejects every delivery** (fail-closed). Set the secret to receive events. Never set `WEBHOOK_ALLOW_UNSIGNED=true` on a public URL. |

- Never put `USERSIG_AUTH_TOKEN` in a `VITE_*` variable or anywhere in `web/` —
  Vite compiles those into the JS bundle, where they are world-readable.
- `USERSIG_EXPIRE_SECONDS` defaults to 7200 (2h). Do not raise it to "avoid
  re-fetching"; the client can simply ask for another signature.
- `template/.env` holds real credentials. Never copy it into the user's
  project, a snippet, a log, or a commit — only `.env.example` is shippable.
- **Confirm `.env` is ignored before writing any key into it.** The published
  package carries no `.gitignore` (npm strips that exact filename), so a
  landed template often has none. Run this in the directory that will hold
  the `.env`, and fix it before writing secrets:
  ```bash
  git rev-parse --is-inside-work-tree 2>/dev/null \
    && (git check-ignore -q .env && echo IGNORED || echo "NOT IGNORED — add .env to .gitignore first")
  ```

---

## §8 Path A · Quick Start

> Reached after user selected **Quick Start** in §5.

**Step 1 · Keys** — §6 Check A; if MISSING → §7.

**Step 2 · Install** — `cd "$TEMPLATE_ROOT" && pnpm install` (first run ~30s)

**Step 3 · Localize defaults to `interaction_lang`**

| `interaction_lang` | `STT_LANGUAGE` | `AGENT_GREETING` | `TTS_VOICE_ID` |
|---|---|---|---|
| `zh` | `zh` | `你好，我能帮你做什么？` | `female-kefu-xiaoyue` (Chinese female) |
| `en` | `en` | `Hello, how can I help you today?` | `v-female-p9Xy7Q1L` (English female) |

Write to `.env` if still at `.env.example` defaults. Ask before overwriting custom values.

**Step 4 · Start**
```bash
cd "$TEMPLATE_ROOT" && nohup bash start.sh > /tmp/voice-ai-starter.log 2>&1 &
sleep 6 && curl -sS http://localhost:3000/health
```
Expected: `{"status":"ok","timestamp":"...","env":{"trtc":"ok","tencent":"ok","llm":"ok"}}`
Retry with 20s if refused. Still fails → `tail -50 /tmp/voice-ai-starter.log`

**Step 5 · Hand off URLs**
```
· Demo:    http://localhost:5173
· Swagger: http://localhost:3000/docs
· Health:  http://localhost:3000/health
```
Stop: `lsof -ti :3000 -sTCP:LISTEN | xargs kill && lsof -ti :5173 -sTCP:LISTEN | xargs kill`

**Step 6 · Discovery guidance** (append to Step 5, in `interaction_lang`)

Tell user they can ask the AI assistant to:
- Switch TTS provider / support a different language
- Switch LLM provider

Both are `.env`-only changes. Do not offer code changes (new endpoints, UI
changes) here — Quick Start only edits `.env`; see §11 if the user asks.

---

## §9 Path B · Integrate into My System

**Step 1** — Confirm `PROJECT_ROOT` (default: workspace root).

**Step 2** — §7 three keys.

**Step 3** — Deliver server code. Ask preference:
  - (a) Copy `$TEMPLATE_ROOT/server/` → `$PROJECT_ROOT/voice-ai-server/`
  - (b) Output 8-endpoint implementations as inline code snippets

Either way, the keys end up in a `.env` inside **the user's own git repo**.
Before writing it, verify it is ignored there — the template's own
`.gitignore` is not published, so do not assume one exists:
```bash
cd "$PROJECT_ROOT" && (git check-ignore -q voice-ai-server/.env \
  && echo IGNORED || echo "NOT IGNORED — append 'voice-ai-server/.env' to .gitignore")
```
If it is not ignored, append the rule and re-check before writing any key.

**Step 3.5 · Security preamble — MANDATORY, state all four before Step 4.**

The template's defaults are tuned for a localhost demo. Path B means this code
goes into a real system, so these four are not optional advice — deliver them
with the code, in `interaction_lang`:

1. **`GET /userSig` must not be copied as-is.** It accepts `userId` as a query
   parameter, so any caller can request credentials for any identity. In the
   user's system, derive `userId` from their existing authenticated session and
   delete the parameter. `USERSIG_AUTH_TOKEN` is a stopgap for
   server-to-server calls, not a substitute for this.
2. **Keep `USERSIG_EXPIRE_SECONDS` short** (default 7200). A UserSig is a
   bearer token for a TRTC identity.
3. **`WEBHOOK_SIGNING_SECRET` must match the key configured in the TRTC
   console** (up to 32 chars, letters and digits). The signature contract is
   `Sign: base64(hmac-sha256(key, raw body))` —
   [doc 68331](https://trtc.io/document/68331), verified against the test
   vector published there. Two things matter when porting it: the raw body
   must be used **unmodified** (Tencent sends tab-indented JSON;
   re-serialising it breaks the HMAC), and handlers must be **idempotent** —
   Tencent retries immediately, then every 10s for up to a minute, and expects
   a response within 5 seconds. Never use `WEBHOOK_ALLOW_UNSIGNED=true`
   outside localhost.
4. **Keep the override allow-list** (`config/overrides.ts`). The three
   `*Overrides` objects on `POST /agent/start` reach the Tencent API directly;
   without the allow-list a caller can supply its own `APIKey` / `APIUrl` and
   redirect the agent's LLM or TTS traffic while the user pays for the task.

Also tell the user that **CORS is hardcoded to `http://localhost:5173`**
(`server/src/index.ts`) and must be changed to their own origin.

**Step 4** — Output React integration snippets covering: userSig fetch → TRTC room join (`trtc-sdk-v5`) → `POST /agent/start` → `onCustomMessage` subscription (Status/Subtitle/Metric/Error) → `POST /agent/stop`.

**Step 5** — Webhook guidance: ngrok for local dev; register URL in TRTC console.

**Verified** when: `GET /health` returns 3 green LEDs + `POST /agent/start` returns `taskId`.

---

## §10 Provider and Language Switching

When the user wants to switch LLM / STT / TTS provider, **or change the language
the user speaks** (a *language change*, e.g. "能不能识别日语"):

1. Identify the change: provider switch (`category` llm / stt / tts) or language change, and the target
2. Look up required `.env` keys and values in `references/provider-config.md`
3. Check which keys are missing from `.env` — ask the user to fill secrets in
   `.env` themselves (§7.4); non-secret values (URL, model, provider name) you
   may write directly
4. Write the non-secret values to `.env`
5. Restart server: run the Stop command from §8 Step 5, then §8 Step 4 (start + health check)
6. If an agent session is active: `POST /agent/stop` → `POST /agent/start`
7. Confirm to user

For a language change, edit `.env` directly (`switch-provider.mjs` only handles
provider switches); steps 3–4 also cover `AGENT_GREETING`, and the user must be
told about the TTS voice fallback — `references/provider-config.md` § Changing
the recognition language lists exactly what to write and what to warn about.

> Full per-provider key reference: `$SKILL_ROOT/references/provider-config.md`

---

## §11 Extension Capability Routing

When the user asks about a capability outside the main path — bot status
polling, standalone STT / TTS, custom context or memory, custom TTS engine,
bilingual subtitles / translation, barge-in tuning, or any change to the
template's code (new backend endpoint, UI change) — read
`$SKILL_ROOT/references/extensions.md` and follow it. In Path A, never write
`server/src/` or `web/src/` (§14); that file says what to deliver instead.

Multi-party meeting transcription is out of scope: read
`../trtc-ai-realtime-interpreter/SKILL.md` and execute it (path relative to
this skill, as in §5).

---

## §12 Quick Reference

### Table 1 · Backend Endpoints
```
GET  /userSig?userId=X      → UserSig
POST /agent/start           → StartAIConversation  (64963)
POST /agent/stop            → StopAIConversation   (65296)
POST /agent/control         → ControlAIConversation(64965)
POST /agent/update          → UpdateAIConversation (64962)
POST /transcription/start   → StartAITranscription (79873)
POST /transcription/stop    → StopAITranscription
POST /webhook/agent-events  → Server Webhook       (68331)
GET  /health                → Health check
```

### Table 2 · Client Callbacks (TRTC onCustomMessage, cmdID=1)
```
type 10000  SubtitleCallback  doc 68333  payload: {text: string, end: bool}
type 10001  StatusCallback    doc 68332  payload: {state: 1=listening 2=thinking 3=speaking 4=interrupted}
            MetricCallback    doc 68334  LLM / TTS / STT latency per turn
            ErrorCallback     doc 68335  bot-side errors
```
Client → bot (cmdID=2): type 20000 = push text · type 20001 = interrupt signal

### Table 3 · Default Config (verified against working implementation)
```json
STTConfig: { "Language": "en", "VadLevel": 3, "VadSilenceTime": 1000 }
LLMConfig: {
  "LLMType": "openai",
  "Model": "${LLM_MODEL}",
  "APIUrl": "${LLM_API_URL}",
  "APIKey": "${LLM_API_KEY}",
  "Streaming": true,
  "History": 20,
  "Temperature": 0.4
}
TTSConfig: {
  "TTSType": "flow",
  "Model": "flow_01_turbo",
  "VoiceId": "v-female-p9Xy7Q1L",
  "Speed": 1.0,
  "Volume": 1.0,
  "Pitch": 0,
  "Language": "en"
}
```
Detailed config docs: 69592 (STT) · 68338 (LLM) · 68340 (TTS) · 79682 (flow TTS voices)

### Table 4 · .env Key Names
```
TRTC_SDK_APP_ID              TRTC_SDK_SECRET_KEY
TENCENT_CLOUD_SECRET_ID      TENCENT_CLOUD_SECRET_KEY
TENCENT_CLOUD_REGION         (one of 5 values — selected via §7.1.1)
TENCENT_CLOUD_ENDPOINT       (optional; derived from region if unset)
LLM_API_KEY                  LLM_API_URL
LLM_MODEL                    (no default — user's own provider)
STT_PROVIDER                 STT_LANGUAGE
TTS_PROVIDER                 TTS_VOICE_ID
AGENT_GREETING               AGENT_SYSTEM_PROMPT
```
Security-relevant (see §7.4 — defaults are localhost-only):
```
USERSIG_EXPIRE_SECONDS       (default 7200 = 2h, max 86400)
USERSIG_AUTH_TOKEN           (empty = /userSig is unauthenticated)
WEBHOOK_SIGNING_SECRET       (empty = all deliveries rejected)
WEBHOOK_ALLOW_UNSIGNED       (default false; localhost testing only)
WEBHOOK_LOG_MAX_BYTES        (default 10485760 = 10 MB)
```

Error codes → see §7.3 for full table and AI response templates.

---

## §13 Common Issues

| Issue | Solution |
|---|---|
| Port 3000 / 5173 occupied | `lsof -ti :PORT -sTCP:LISTEN \| xargs kill` |
| pnpm not found | `npm install -g pnpm` |
| LLM API error | Check `LLM_API_URL` matches provider endpoint and `LLM_API_KEY` is valid |
| No audio from bot | `TTS_VOICE_ID` is not valid for the current `TTS_PROVIDER`, or (providers other than flow/azure) the voice does not speak `STT_LANGUAGE` — see `references/provider-config.md` § Changing the recognition language |
| `/agent/start` → 400 `TTS_VOICE_ID_REQUIRED` | `TTS_PROVIDER` needs its own voice and `TTS_VOICE_ID` is unset or still a Flow ID. Ask the user for a voice from that provider's library, write it, restart (§10 step 5) |
| Speech recognized as the wrong language, or not at all | `STT_LANGUAGE` is not one of the 28 codes the Tencent engine accepts, or `.env` was edited without restarting — `tsx watch` does not reload it. See `references/provider-config.md` § Changing the recognition language |
| Bilingual subtitles not showing | Set `AGENT_LANGUAGE` and `BILINGUAL_TARGET_LANG` in `.env`, then call `POST /transcription/start` (see `references/extensions.md` § Bilingual Subtitles) |
| Webhook events not arriving | ① Is `WEBHOOK_SIGNING_SECRET` set, and does it match the console key exactly? Empty = every delivery rejected by design (§7.4). ② Check the server log: `"reason":"missing_signature"` means the `Sign` header was absent, `"bad_signature"` means the key differs or the body was modified in transit by a proxy. ③ Use ngrok for local dev; register the URL in the TRTC console |
| `GET /userSig` returns 401 | `USERSIG_AUTH_TOKEN` is set, so the caller must send `Authorization: Bearer <token>`. The web demo deliberately does not send it — unset the variable for local use (§7.4) |
| `POST /agent/start` returns 400 `roomId must match pattern` | `roomId` must be a numeric string, 1–4294967294 (`RoomIdType: 0`). The string room `"123"` and the numeric room `123` are different rooms in TRTC |
| `POST /agent/start` returns 400 `must NOT have additional properties` | Unknown body fields are rejected, not ignored — check for a typo in the field name |
| Agent voice/prompt override silently ignored | Credential and endpoint fields (`APIKey`, `APIUrl`, `TTSType`, …) are stripped from `*Overrides` by design; the server logs `"rejected":[...]`. Change them in `.env` instead |
| Authentication error from the Tencent API | `TENCENT_CLOUD_REGION` must match the site your account is on — `ap-guangzhou` is the China site, the other four are international. The endpoint is derived from it |

---

## §14 AI Tool Whitelist

### Allowed
```
node "$TEMPLATE_ROOT/scripts/verify-credentials.mjs" [--type trtc|tencent|llm|all]
node "$TEMPLATE_ROOT/scripts/switch-provider.mjs" --category X --to Y
cd "$TEMPLATE_ROOT" && (test -f .env || cp .env.example .env) && chmod 600 .env
cd "$TEMPLATE_ROOT" && pnpm install
cd "$TEMPLATE_ROOT" && bash start.sh --check
cd "$TEMPLATE_ROOT" && nohup bash start.sh > /tmp/voice-ai-starter.log 2>&1 &
sleep N && curl -sS http://localhost:3000/health
tail -50 /tmp/voice-ai-starter.log
lsof -ti :PORT -sTCP:LISTEN
chmod 600 "$TEMPLATE_ROOT/.env"
cp -R "$TEMPLATE_ROOT/server" "$PROJECT_ROOT/voice-ai-server"
find "$PWD" -maxdepth 5 -name SKILL.md -path '*voice-ai-starter*'
```

### Forbidden
```
Keys as CLI args (history leak)
cat "$TEMPLATE_ROOT/.env" (exposure risk)
git add/commit without user consent
Bare relative paths without cd "$TEMPLATE_ROOT"
```

### File Write Whitelist
```
$TEMPLATE_ROOT/.env
/tmp/voice-ai-starter.log
$PROJECT_ROOT/voice-ai-server/   (Path B only)
```

---

## §15 Design Standards (Path A UI Only)

UI style rules live with the code: `template/AGENTS.md` §D item 4 and the
header of `web/src/styles/tokens.css`; `pnpm --filter web test` enforces them.

---

> Full API reference: https://trtc.io/llms/conversational-ai.txt
