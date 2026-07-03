---
name: trtc-ai-service
description: >
  AI customer service scenario skill for TRTC Conversational AI. Guide users
  step-by-step through building an AI-powered customer service application —
  from zero to a working demo, or integrate AI service capabilities into an
  existing project. Use this skill when the user wants to "build an AI
  customer service agent", "set up intelligent Q&A", "create a smart客服
  system", or describes a complete AI service use case. This skill loads
  scenario files that define the sequence of capabilities to implement and
  guides the user through each step with code examples, UI components, and
  verification checkpoints.
---

# AI Customer Service Skill (v1.2)

> This document is the Coding Agent's execution SOP. It also serves as a user-friendly guide reference.
> For any natural-language intent involving "build / integrate AI customer service," the AI must **read this file first** before taking action.
> All script calls must strictly follow §12 Tool Whitelist.

## Entry points

This skill is reached two ways:

1. **Direct routing from `../trtc/SKILL.md`** — the primary path. The root skill has identified the user's intent as Conversational AI / AI customer service and routed here directly. No onboarding session is required; proceed to §0 below.

2. **Handoff from `../trtc-topic/SKILL.md`** — when the user has gone through onboarding and explicitly selected an AI service scenario. In this case, the scenario id is already resolved; skip to the relevant path section.

---

## 0. Path Baseline (SKILL_ROOT / PROJECT_ROOT) —— 🔴 Top Priority — Read First

All runtime assets of this Skill (`capabilities/`, `scripts/`, `scenarios/`, `auto_adapters/`,
`start.sh`) reside in the **Skill's own directory** and are **not necessarily** at the user's workspace root.
The Skill can be installed in arbitrary locations: a project subdirectory, `.agents/skills/`, `.codebuddy/skills/`,
and will work across IDEs (Claude Code / Codex / Cursor) in the future. Therefore, **never assume "Skill root == Workspace root."**

### 0.1 Definition of the Two Roots

| Variable | Meaning | How to Obtain |
|---|---|---|
| `SKILL_ROOT` | **Skill's own directory** (contains `SKILL.md` / `scripts/` / `capabilities/` …) | = The absolute path of the **Base directory** injected by the system when this Skill is loaded. The Agent must remember it. |
| `PROJECT_ROOT` | **User's current project root** (= workspace root; the integration target for Path B) | = The absolute path of the current workspace root. |

> Demo path (A) uses `SKILL_ROOT` (fetch capability sources + start core) and `PROJECT_ROOT` (where demo artifacts land);
> Integration path (B) uses `SKILL_ROOT` (fetch capability sources + start core) and `PROJECT_ROOT` (integration target).
> These two **may or may not be the same** — do not mix them up.

### 0.2 Hard Rules for Path Usage

1. **All commands that call Skill-bundled scripts / assets must use the absolute path of `SKILL_ROOT`**, e.g.:
   ```bash
   cd "$SKILL_ROOT" && python3 scripts/add-capability.py ...
   # or
   python3 "$SKILL_ROOT/scripts/add-capability.py" ...
   ```
   **Do not** write bare relative paths (e.g., `python3 scripts/...`) assuming they resolve against the workspace root — that was the root cause of bugs in previous versions.
2. For all command templates in this document that contain `$SKILL_ROOT` / `$PROJECT_ROOT`, the Agent **must substitute them with actual absolute paths** before execution.
3. The scripts themselves (`start.sh` / `add-capability.py` / `post-install-patch.py`) already self-locate
   (via `__file__` / `BASH_SOURCE`), so as long as you invoke them with their **absolute path**, they work regardless of cwd.
4. If `SKILL_ROOT` cannot be determined immediately, fall back to a one-shot detection (do not ask the user to move directories):
   ```bash
   find "$PWD" -maxdepth 4 -name SKILL.md -path '*ai-service*' 2>/dev/null | head -1
   ```
   If still not found, ask the user where the Skill is installed. **Never ask the user to move the Skill directory to the workspace top level.**

---

## 1. When to Use This Skill

**Trigger conditions** (activate this Skill if any match):
- The user message contains one of the §triggers.keywords
- The user message contains "TRTC" and refers to "customer service / after-sales / customer support"
- The user, in a session where this Skill is already loaded, explicitly expresses "let's start / run it / integrate it"

**Not applicable** (refuse and explain):
- Purely a general voice conversation demo (not customer service business) → direct to the conversation-core README
- Requires digital human / outbound phone calls → not in current scope
- User is in a non-TRTC ecosystem (Agora / Shengwang) → suggest the corresponding Skill

> **Product positioning note**: This Skill encapsulates **TRTC Conversational AI (voice)** capabilities. The selling point is "voice customer service."
> Therefore the demo scenario (Path A) is voice-first. If the user only wants plain text and merely reuses the RTC channel, advise them to configure it themselves.
> This Skill does **not** generate artifacts for text-only scenarios.

---

## 2. Interaction Language Detection (Hard Constraint Throughout the Process)

> **Purpose**: Throughout the setup process, all of the AI's guidance text, `ask_followup_question` questions / options,
> prompts, and summaries must **follow the natural language of the user's first prompt**. Do not hardcode Chinese.

**Detection rules** (complete after Skill start, before §3; store the result in the internal variable `interaction_lang`):
- Use the **message that triggered this Skill** as the basis for detection
- Predominantly Chinese → `interaction_lang = zh`
- Predominantly English (or other non-Chinese language) → `interaction_lang = en` (approximate other languages with English)
- If the user explicitly requests a language switch mid-session → update `interaction_lang` immediately and apply to all subsequent interactions

**Scope (must be followed)**:

| Scenario | Requirement |
|---|---|
| Path selection options | question and each option use `interaction_lang` |
| Path B Q&A dialogue | use `interaction_lang` |
| Three-Keys setup dialogue | use `interaction_lang` |
| Contract alignment options and checklist | use `interaction_lang` |
| Post-launch entry list / trial suggestions | use `interaction_lang` |
| Error recovery / warning messages | use `interaction_lang` |

**Relationship with artifact UI language** (only Path A involves UI):
- `interaction_lang` controls the language of the **setup process dialogue**.
- **Path A** artifact UI default language (`recipe.yaml metadata.language`) **defaults to following `interaction_lang`**,
  unless the user specifies otherwise.
- **Path B** generates no UI, so there is only "dialogue language," not "artifact UI language." Delivered code comments / READMEs use `interaction_lang`.

> Do not default to Chinese in conversations just because SKILL.md itself is originally written in Chinese. **Follow the user's language.**

---

## 3. Environment Check (Fully Automatic — No User Action Needed)

> **AI guidance text** (output the following in `interaction_lang`):

Before we officially start, the system will automatically check if your runtime environment meets the requirements. You don't need to do anything for this step — just wait a moment.

**Checks performed**:
- Python version >= 3.9
- Skill directory files are intact
- Whether the three keys (cloud service credentials) have been configured

If all checks pass, we'll automatically move to the next step. If something fails, the system will tell you exactly what's missing and how to fix it.

---

**AI execution actions** (substitute `$SKILL_ROOT` in all commands with the absolute path determined in §0 before execution):

### 3.1 Python ≥ 3.9
```bash
python3 -c "import sys; assert sys.version_info >= (3, 9), sys.version" && echo OK || echo BAD_PY
```
Fail → tell the user:
> Your Python version is too old. You need version 3.9 or above. You can download the latest version at https://www.python.org/downloads/. Once installed, we'll continue.

**Do not proceed** until the Python version is satisfied.

### 3.2 SKILL_ROOT Verification
```bash
test -f "$SKILL_ROOT/capabilities/conversation-core/manifest.yaml" && echo OK || echo MISSING
```
- OK → path baseline is correct. Continue.
- MISSING → `$SKILL_ROOT` was set incorrectly. Use the `find` fallback from §0.2 item 4 to re-determine `SKILL_ROOT`, then rerun this check. Only ask the user for the Skill install location if it still fails.

### 3.3 .env Status
```bash
test -f "$SKILL_ROOT/capabilities/conversation-core/.env" && echo OK || echo MISSING
```
- OK → Indicates the three keys have been configured before. Tell the user:
  > I see you've configured your keys before. We can reuse them directly. If you want to reconfigure, just let me know.
  Can skip §5 (unless the user explicitly wants to "reconfigure keys").
- MISSING → The first step must be §5 Three-Keys Configuration.

---

## 4. Path Selection

> **AI guidance text**:

Environment check passed! Now let's make a choice — how would you like to get started?

---

**First required action**: Use the `ask_followup_question` tool to present a **single-choice question**:

```json
[{
  "id": "path",
  "question": "How would you like to set up your AI customer service?",
  "options": [
    "Quick Start — Get the agent running right away. You'll see the results in your browser (a web chat window + ticket management dashboard). You'll need to configure 3 keys, and the system will automatically install default capabilities. You should see results within 2-3 minutes. Best for first-timers who want to see 'what this thing looks like'",
    "Integrate into My System (backend capabilities only) — If you already have your own website or app and want to plug in the AI customer service 'brain', choose this. The system will provide a set of API interfaces with no web UI generated. You'll need to configure 3 keys, then choose the interaction mode and additional capabilities"
  ],
  "multiSelect": false
}]
```

- Choose A → Go to §6 (Path A: Quick Start)
- Choose B → Go to §7 (Path B: Integrate into My System)

> Fallback when Coding Agent does not support `ask_followup_question`:
> List both paths in natural language and collect the user's answer from the conversation. **Do not make assumptions.**

**Key boundaries the AI should proactively explain**:
> Whichever you choose, I'll walk you through it step by step. Here's a quick summary of the two paths:
> - Quick Start: I'll generate a complete customer service web interface for you. You'll be able to see and experience it right in your browser.
> - Integrate into My System: I'll give you the AI customer service backend capabilities only (API interfaces). The UI is yours — I'll hand you the API docs and sample code, and your developers can connect to them directly.

---

## 5. Three-Keys Configuration

> **Trigger condition**: §3.3 returned MISSING, or a key was subsequently judged as failed by verify-credentials.py.
> Substitute `$SKILL_ROOT` in commands with absolute paths before execution.

---

> **AI guidance text**:

To get the customer service agent running, you'll need to configure 3 keys — they're the access passes for cloud services. Don't worry, I'll walk you through each one.

We'll go in this order: **first** register and create the voice agent on the TRTC standalone site (this is the "core"), **then** get the Tencent Cloud API Key (this is the "control plane" that issues temporary credentials), **last** the LLM API Key (this is the "brain").

---

### 5.1 Configuration Methods

You can configure keys in one of two ways:

**Method 1: Fill them in yourself**
In the `.env` file in the project root, find the corresponding configuration items and replace the values on the right side of the equals sign with your own. A complete configuration template is provided below — you can copy and paste the whole block into your `.env` file.

**Method 2: Send them to me and I'll fill them in**
Send each key's value through the chat, and I'll write them into the `.env` file for you. Your key information is only used for this configuration write. The system handles it securely — your keys will not be logged or leaked.

---

### 5.2 Complete Configuration Template (can be given to the user for copy-paste)

```bash
# ==========================================
# AI Customer Service Skill - Environment Variable Template
# Copy the entire block into your .env file and replace the values on the right side of the equals sign
# ==========================================

# --- Key 1: TRTC Application Credentials ---
# Get them here: https://console.trtc.io/?quickclaim=engine_trial (register & create an RTC Engine application — supports Conversational AI)
# (China-region accounts use: https://console.cloud.tencent.com/trtc)
TRTC_SDK_APP_ID=yourSDKAppID (e.g., 1400000000)
TRTC_SDK_SECRET_KEY=yourSDKSecretKey (64-character string)

# --- Key 2: Tencent Cloud API Credentials ---
# Get them here: https://console.tencentcloud.com/cam/capi (your TRTC login session syncs automatically)
TENCENT_CLOUD_SECRET_ID=yourSecretId
TENCENT_CLOUD_SECRET_KEY=yourSecretKey

# --- Key 3: LLM API Key ---
# Enter the API Key for the AI language model service you're using
LLM_API_KEY=yourAPIKey
LLM_API_URL=yourAPIEndpoint (fill in if using a non-OpenAI service)
LLM_MODEL_NAME=yourModelName (e.g., gpt-4o / deepseek-chat / claude-3-opus)
```

---

### 5.3 Key-by-Key Collection Process

#### Key 1: TRTC Application Credentials (SDKAppID / SDKSecretKey)

**The AI should say**:
> Let's start with Key 1 — TRTC Application Credentials. This is the foundation of the whole system: the application that powers the voice channel — it lets the customer service agent make voice calls and chat with voice.
>
> To get it, we'll go to the **TRTC standalone site** (Tencent RTC's international site) and create an RTC Engine application (supports Conversational AI) there:
> 1. Open this page: https://console.trtc.io/?quickclaim=engine_trial and register an account / log in (China-region accounts can use https://console.cloud.tencent.com/trtc instead)
> 2. After logging in, create an **RTC Engine** application (supports Conversational AI — this is the voice agent you'll be using)
> 3. Once the application is created, you'll find two pieces of information inside it:
>    - **SDKAppID**: a string of numbers
>    - **SDKSecretKey**: a long string of mixed letters and numbers (found in the "Server-side Integration" section)
> 4. ⚠️ Important: There may also be something called STSecretKey on the page — that one is for the client side. We don't want that. We need the **SDKSecretKey** (the server-side one)
>
> Fill the two values into the code block below. Make sure to replace the placeholder text (`yourSDKAppID` and `yourSDKSecretKey`), then **copy and send the entire block to me**:
>
> ```
> # My TRTC application credentials
> TRTC_SDK_APP_ID=yourSDKAppID
> TRTC_SDK_SECRET_KEY=yourSDKSecretKey
> ```

**After the user replies with the code block**, the AI must parse the values on the right side of the equals sign:
1. Validate: SDKAppID is an integer; SDKSecretKey must be 64 characters `[0-9a-f]`
   (**Special case**: if 128 characters detected and the first 64 equal the last 64 → auto-truncate to first 64 and inform the user)
2. Tool: `write_to_file("$SKILL_ROOT/capabilities/conversation-core/.env", <write TRTC_SDK_APP_ID=... + TRTC_SDK_SECRET_KEY=...>)` (default international site; do not write TRTC_REGION)
3. Do not echo the full key; only confirm "Received — length/format OK"
4. Tool: `execute_command("cd \"$SKILL_ROOT\" && python3 scripts/verify-credentials.py --type trtc")`
   > Note: At this point Tencent Cloud credentials are not yet configured, so the TRTC check runs in **local UserSig self-consistency mode** (no deep ownership check). The deep ownership check runs automatically after Key 2 (Tencent Cloud) is configured — see the re-verification step at the end of Key 2.
5. Parse stdout JSON:
   - `{"ok": true, ...}` → Tell the user "Key 1 verified successfully" and proceed to Key 2
   - `{"ok": false, "error": "E002"}` → Respond per the §5.5 error code table; ask the user to retry
   - `{"ok": false, "error": "E000"}` → Check if some value in the user's code block is still a placeholder; if so, prompt "I noticed a value still looks like a placeholder — please send the complete code block again with all values filled in"

#### Key 2: Tencent Cloud API Credentials (SecretId / SecretKey)

**The AI should say**:
> All set! Now Key 2 — Tencent Cloud API Credentials.
>
> **Why do we need this?** A quick note on the relationship between TRTC and Tencent Cloud:
> Tencent RTC (trtc.io) is Tencent Cloud's international Real-Time Communication brand. The TRTC Conversational AI service runs on top of Tencent Cloud's infrastructure. The **voice / media channel** is handled by TRTC (which you just configured in Key 1), but the **control plane** — issuing temporary credentials (STS), permission management (CAM), and billing — runs on Tencent Cloud. So we need a Tencent Cloud API Key to let the agent obtain short-lived access tokens securely.
>
> The good news: your TRTC account and Tencent Cloud account are connected through a unified login system. **You don't need to register again** — after registering on the TRTC standalone site in Key 1, your login state syncs automatically.
>
> To get it:
> 1. Open this page: https://console.tencentcloud.com/cam/capi (your TRTC login session will sync automatically — no separate signup needed)
> 2. You'll see a page called "API Key Management." There will be a **SecretId** and a **SecretKey** (you may need to click "Show" to see the full content)
>
> Fill the two values into the code block below. Make sure to replace the placeholder text (`yourSecretId` and `yourSecretKey`), then **copy and send the entire block to me**:
>
> ```
> # My Tencent Cloud API credentials
> TENCENT_CLOUD_SECRET_ID=yourSecretId
> TENCENT_CLOUD_SECRET_KEY=yourSecretKey
> ```

**After the user replies with the code block**, the AI must parse the values on the right side of the equals sign:
1. Validate format: SecretId is typically 36 characters, `^[A-Za-z0-9]+$`; SecretKey is not empty
2. Tool: `write_to_file` **append** `TENCENT_CLOUD_SECRET_ID=...` + `TENCENT_CLOUD_SECRET_KEY=...` + `TENCENT_CLOUD_REGION=ap-guangzhou` to the existing `.env` (do NOT overwrite Key 1's TRTC values)
3. Do not echo the full key; only confirm "Received — length/format OK"
4. Tool: `execute_command("cd \"$SKILL_ROOT\" && python3 scripts/verify-credentials.py --type tencent")`
5. Parse stdout JSON:
   - `{"ok": true, ...}` → Tell the user "Key 2 verified successfully"
   - `{"ok": false, "error": "E001"}` → Respond per the §5.5 error code table; ask the user to retry
   - `{"ok": false, "error": "E000"}` → Check if some value in the user's code block is still a placeholder; if so, prompt "I noticed a value still looks like a placeholder — please send the complete code block again with all values filled in"
6. **Re-verify TRTC deep ownership check** (now that Tencent Cloud creds are available, do a full ownership check on Key 1):
   - Tool: `execute_command("cd \"$SKILL_ROOT\" && python3 scripts/verify-credentials.py --type trtc")`
   - `{"ok": true, ...}` → Tell the user "TRTC deep ownership check also passed" and proceed to Key 3
   - `{"ok": false, "error": "E002"}` → Respond per §5.5 (e.g., SDKAppID may not belong to this account, or SDKSecretKey / STSecretKey mix-up); ask the user to go back and recheck Key 1's values
   - If value is still a placeholder, prompt to resend

#### Key 3: LLM API Key

**The AI should say**:
> Great! Last one — the LLM API Key. This key lets the customer service agent "think" — understand customer questions and generate replies. You'll need an account with an AI language model service provider.
>
> If you don't have an LLM account yet, you can pick one from the providers below, sign up, and get an API Key. (The API Key page link is listed for each — just click to go directly):
>
| Provider | Model Series | Get your API Key here |
|----------|-------------|----------------------|
| OpenAI | GPT Series | https://platform.openai.com/api-keys |
| Anthropic | Claude Series | https://console.anthropic.com/settings/keys |
| Google AI | Gemini Series | https://aistudio.google.com/apikey |
| DeepSeek | DeepSeek Series (cost-effective, strong Chinese) | https://platform.deepseek.com/api_keys |
| Together AI | Open-source model hosting | https://api.together.ai/settings/api-keys |
| Groq | High-performance inference | https://console.groq.com/keys |
| Cohere | Enterprise AI | https://dashboard.cohere.com/api-keys |
| Mistral AI | Mistral Series (EU provider) | https://console.mistral.ai/api-keys |

> Once you've chosen a provider and gotten your API Key, fill it into the code block below (replace the placeholder text), then **copy and send the entire block to me**:
>
> ```
> # My LLM API configuration
> LLM_API_KEY=yourAPIKey
> LLM_API_URL=yourAPIEndpoint
> LLM_MODEL=yourModelName
> ```
>
> Things to keep in mind:
> - If you're using **OpenAI**, you can delete the `LLM_API_URL` line (the default is OpenAI's endpoint)
> - If you're using another provider (e.g., DeepSeek, Claude, Gemini, etc.), you must fill in both `LLM_API_URL` and `LLM_MODEL`. Check your provider's documentation for the exact values — search for "API Base URL" and "Model Name"

**After the user replies with the code block**, the AI must parse the values on the right side of the equals sign:
1. Validate: `LLM_API_KEY` is not empty
2. If `LLM_API_URL` is empty or is a placeholder, default to `https://api.openai.com/v1`
3. If `LLM_MODEL` is empty or is a placeholder, default to `gpt-4o`
4. Tool: `write_to_file` append `LLM_API_KEY=` + `LLM_API_URL=...` + `LLM_MODEL=...`
5. Tool: `execute_command("cd \"$SKILL_ROOT\" && python3 scripts/verify-credentials.py --type llm")`
6. Parse stdout JSON:
   - `{"ok": true, ...}` → Tell the user "All three keys are ready — moving to the next step"
   - `{"ok": false, "error": "E003"}` → Respond per §5.5 error code table with hints
   - If value is still a Chinese placeholder, prompt "I see the code block still has placeholder text that hasn't been replaced — please fill in all values and resend"

---

### 5.4 Security Constraints (Red Lines — Violations Are Considered Defects)

| Red Line | Correct Approach |
|---|---|
| Do not pass keys as command-line arguments to any script | Write to .env via write_to_file, then call verify-credentials.py with no arguments |
| Do not echo the full key value in chat replies | Only confirm "Received + length/format OK" |
| Do not output keys to logs / stdout | verify-credentials.py automatically outputs only ok/error/message/latency_ms |
| Do not use `echo $SECRET` / `cat .env` | shell history / terminal logs will record it |
| After writing .env, its permissions must be 600 | execute_command("chmod 600 \"$SKILL_ROOT/capabilities/conversation-core/.env\"") |

---

### 5.5 Error Codes → AI Response Templates

| error | Meaning | What the AI should tell the user |
|---|---|---|
| E000 | Credential not configured / empty | "It looks like this entry in .env is empty or missing — please send it again" |
| E001 | Tencent Cloud API verification failed | "Tencent Cloud API verification failed. Common causes: ① Id/Key order might be swapped ② Key may have been disabled ③ STS service not enabled on your account. Please check at console.cloud.tencent.com/cam" |
| E002 | TRTC verification failed | "TRTC verification failed. Please double-check: ① Does the SDKAppID belong to your account ② Did you mix up SDKSecretKey and STSecretKey ③ China-region apps may need `TRTC_REGION=cn` added to .env" |
| E003 | LLM verification failed | "LLM verification failed. If you're using a non-OpenAI service, you may need to update the API endpoint. Which provider are you using?" |
| E004 | Network unreachable | "Cannot reach the verification server. Please check: ① Do you need a proxy ② Is there a corporate firewall ③ Is your network working. You can also skip deep verification and continue" |

---

## 6. Path A: Quick Start

> User selected A in §4.
> Default artifact: **Voice Customer Service UI** (TRTC real connection, FAQ silent RAG, handoff queue animation + simulated connection, product/order business panel).
> Substitute `$SKILL_ROOT` in all commands with absolute paths before execution.

---

> **AI guidance text** (Path A entry point):
> Alright, going with the Quick Start path! I'll set up the entire customer service system for you. You don't need to do anything — just wait a moment.
>
> This path will automatically install the following capabilities:
> - **Conversation capability**: The agent can actually understand what you say and respond (because real AI keys are configured)
> - **Human handoff**: You'll see the handoff flow and UI (using demo data)
> - **Knowledge base**: You'll see KB search results in action (using demo documents)
> - **Session summary**: Default-installed in Path A — when a handoff ticket is created, an LLM-generated summary of the conversation is written into the ticket Description so agents see the context immediately
>
> Once set up, you'll open your browser and see a full customer service chat interface and a ticket management dashboard.

---

### 6.0 Deployment Parameters (Adjustable)

| Parameter | Default | Description |
|---|---|---|
| Deployment directory | `$PROJECT_ROOT/ai-customer-service-demo/` | Where the demo UI lands (independent of the Skill folder, easy for later customization); use a different directory if the user requests it |
| Port | `3000` | If occupied or user specifies a different one: `bash "$SKILL_ROOT/start.sh" --port <N>`, then sync the port in all subsequent health checks / URLs |

---

### 6.1 Step Sequence (6 Steps)

**Step 1: Configure the Three Keys**
- Tool: `execute_command("test -f \"$SKILL_ROOT/capabilities/conversation-core/.env\" && echo OK || echo MISSING")`
- Returns OK → Proceed to Step 2
- Returns MISSING → Enter §5 Three-Keys sub-flow, then return to Step 2 when done

**Step 2: Assemble Capability Packages**

> **AI should tell the user**:
> Installing dependencies and assembling default capabilities — this should take about 30-60 seconds...

- Tool: `execute_command("cd \"$SKILL_ROOT\" && python3 scripts/add-capability.py knowledge-base human-handoff --apply --json")`
- Expected: JSON output with all `reports[*].errors == []`, no fatal `injection.error`
- Failure handling:
  - Circular dependency / version conflict → explain to user based on stderr output; stop
  - L2 (templates) → installed to templates directory; tell user where to manually inject
  - L3 (manual) → output the path `$SKILL_ROOT/auto_adapters/integration_templates/generic-frontend.md`

**Step 2.5: Post-Install Patch (Must Run)**
- Tool: `execute_command("cd \"$SKILL_ROOT\" && python3 scripts/post-install-patch.py")`
- Expected: returns `{"ok": true, ...}`
- This script does 3 things:
  - Fixes stale extension point injection errors
  - Appends recipe default capability config to `.env` (existing values untouched)
  - Verifies `server.py`'s `StaticFiles(html=True)`

**Step 3: UI Overlay (Must Run — Path A Exclusive) —— Default Voice Customer Service UI**
- Artifacts deployed to `$PROJECT_ROOT/ai-customer-service-demo/` (independent of Skill directory, easy for later edits)
- Tool (one command to create directory and copy):
  ```bash
  execute_command(
    "mkdir -p \"$PROJECT_ROOT\"/ai-customer-service-demo/admin && \
     cp \"$SKILL_ROOT\"/scenarios/customer-service/ui/voice-customer-service/{index.html,app.js,styles.css,data.js,mock-shop.json,tokens.css} \
        \"$PROJECT_ROOT\"/ai-customer-service-demo/ && \
     cp -R \"$SKILL_ROOT\"/scenarios/customer-service/ui/admin-board/. \
           \"$PROJECT_ROOT\"/ai-customer-service-demo/admin/ && \
     echo \"WEB_DEMO_DIR=$PROJECT_ROOT/ai-customer-service-demo\" >> \"$SKILL_ROOT\"/capabilities/conversation-core/.env"
  )
  ```
- Expected: `$PROJECT_ROOT/ai-customer-service-demo/` contains `index.html / app.js / styles.css / data.js / mock-shop.json / tokens.css` + `admin/` subdirectory, and `WEB_DEMO_DIR` is written to `.env`
- Failure handling: check that `$SKILL_ROOT/scenarios/customer-service/ui/voice-customer-service/` is intact

**Step 4: Proactively List business_contract** (enter §9)

**Step 5: Start the Demo**

> **AI should tell the user**:
> Starting the customer service system. The first launch needs to install some dependency packages and may take 30-60 seconds. Please wait...

- Tool: `execute_command("cd \"$SKILL_ROOT\" && nohup bash start.sh > /tmp/ai-cs-start.log 2>&1 &")`
- Tool: `execute_command("sleep 8 && curl -sS http://localhost:3000/api/v1/health")`
- First launch creates venv + runs pip install, **typically takes 30-60s**
  - If health check fails after sleep 8 → Tool: `execute_command("sleep 25 && curl -sS http://localhost:3000/api/v1/health")` try again
  - Still fails → `tail -80 /tmp/ai-cs-start.log` check for pip install errors / port conflicts
- Health check returns `{"status":"ok",...}` → Proceed to Step 6

**Step 6: Output Entry List + Trial Suggestions**

> **The AI should say**:
> All done! Your AI customer service agent is up and running. Open the following URLs in your browser to see it in action:

| Page | URL | Description |
|---|---|---|
| AI Voice Agent | http://localhost:3000 | (customer service chat interface) |
| Admin board | http://localhost:3000/static/admin/ | (ticket management dashboard) |
| API docs (Swagger) | http://localhost:3000/docs | (API documentation) |
| Health probe | http://localhost:3000/api/v1/health | (health check) |

```
Try saying / typing:
  · "How do I get a refund"        → AI replies; KB silently augments answer
  · "Talk to agent"                → handoff queue + 8s progress bar + simulated connect
  · Click any product / order card → auto-asks the AI about that item
```

> Note: The human handoff and knowledge base are using simulated data, so you won't see real business integration effects. If you want to connect to a real business system, you can start over and choose "B — Integrate into My System."

---

### 6.2 Don'ts

- ❌ Use bare relative paths to call scripts (must `cd "$SKILL_ROOT"` or use absolute paths — see §0)
- ❌ Skip .env check before assembling capability packages
- ❌ Pass any key via command-line arguments to scripts
- ❌ Modify `capabilities/*/src/core/` (this is the skeleton layer; do not touch)
- ❌ Skip Step 2.5 (not running post-install-patch.py leaves stale injection errors from add-capability → NameError on startup)
- ❌ Skip Step 3 (not running UI overlay leaves `/` at the conversation-core built-in voice self-check page → not the intended artifact)
- ❌ Say the admin board URL is `/admin/tickets` (**the correct path is `/static/admin/`**)
- ❌ Execute `git commit` / `git push` (unless the user explicitly requests it)
- ❌ Echo full key content in chat replies

---

## 7. Path B: Integrate into My System (Backend Capabilities Only)

> User selected B in §4.
> **Key positioning**: Integrate TRTC Conversational AI **backend capabilities** into the user's **existing project** (`PROJECT_ROOT`).
> - `conversation-core` is the core: must **end-to-end verify the voice conversation pipeline** (test until you can actually converse).
> - Other incremental capabilities (knowledge-base / human-handoff / session-summary / tool-calling):
>   Only deliver **interface specifications + mock implementations + sample code**. The user replaces them with their own systems as needed.
> - **This path NEVER generates any frontend UI** — the UI is the user's own frontend/backend responsibility.

---

> **AI guidance text** (Path B entry point — must explicitly state boundaries):
> Alright, going with the "Integrate into My System" path. This path will plug the AI customer service **backend capabilities** into your existing project.
>
> Here's what I'll do:
> - Install the voice conversation core (conversation-core) and run it end-to-end to confirm it can actually converse
> - For extra capabilities like knowledge base, human handoff, session summaries, etc., I'll only provide **interface specs + mock implementations + sample code**. You swap in your own real systems as needed
> - **I will not generate any web UI** — the UI is handled by your own project's frontend
>
> Now, let's walk through a few steps: first confirm your project, then pick capabilities, and finally choose the interaction mode for the agent.

---

### 7.1 Confirm Integration Target (PROJECT_ROOT & Tech Stack)

1. Confirm `PROJECT_ROOT` (default = current workspace root). If the user's project is in a subdirectory, have them specify it as `--target-project`.
2. Let the script auto-detect the project tech stack (no manual entry needed):
   ```bash
   cd "$SKILL_ROOT" && python3 scripts/add-capability.py --list --json
   ```
   Tech stack detection is triggered automatically by `--target-project` during Step 7.3 assembly (`stack_detector`).
   If auto-detection is inaccurate, override with `--tech-stack <react|vue|node|python|java|...>`.

### 7.2 Configure Three Keys
- Tool: `execute_command("test -f \"$SKILL_ROOT/capabilities/conversation-core/.env\" && echo OK || echo MISSING")`
- MISSING → Enter §5 to complete the three keys (voice core hard-depends on all three keys — all are mandatory).

### 7.3 Capability Selection (Optional Incremental Capabilities — Multi-Select)

> **The AI should say** (using `ask_followup_question` multi-select mode):
> Now let's decide what extra capabilities the agent should have. Besides the built-in voice conversation capability, you can add the following. You can pick multiple, or none at all. Without any extras, the agent will only have basic conversation ability.

| # | Capability Package | Description | What you'll get |
|---|---|---|---|
| 1 | Knowledge Base | FAQ / KB search | Upload a return policy PDF — the agent automatically answers "How do I return this?" |
| 2 | Human Handoff | Auto-escalate to a human when the bot can't handle it | Complex issues (complaints, refund disputes) are automatically routed to a human agent, with a ticket dashboard |
| 3 | Tool Calling | Let the agent query your system's data | Customer asks "Where's my order?" → agent queries your database and returns shipping status |
| 4 | Session Summary | Auto-generate a summary after each conversation | After each chat, a summary is written so you can review what the customer said and archive it |

```json
[{
  "id": "capabilities",
  "question": "Which additional capabilities do you need? (multi-select)",
  "options": [
    "① Knowledge Base — FAQ / KB search",
    "② Human Handoff — Escalate to human + ticket flow",
    "③ Tool Calling — Let AI call your business tools",
    "④ Session Summary — Auto-generate summaries after sessions",
    "(None — just basic conversation)"
  ],
  "multiSelect": true
}]
```

> Made your choice? Just tell me the numbers (e.g., "1, 2, 3" or "all").

**Assembly command** (renders incremental capability adapters / samples into the user's project):
```bash
cd "$SKILL_ROOT" && python3 scripts/add-capability.py <selected capabilities...> \
    --target-project "$PROJECT_ROOT" --apply --json
# If none selected, skip this command (only runs voice core)
```
- `--target-project` triggers `auto_adapters` three-tier fallback rendering:
  - L1: Based on detected tech stack, renders **room-entry components / backend proxy route examples** into `$PROJECT_ROOT`
  - L2: Renders to templates directory and lists TODOs
  - L3: Outputs generic integration guide for manual connection
- Parse the returned JSON and tell the user where the files landed

**Post-install patch (must run)**:
```bash
cd "$SKILL_ROOT" && python3 scripts/post-install-patch.py
```

### 7.4 I/O Modality Selection (Choose the Agent's "Communication Method")

> **The AI should say** (using `ask_followup_question` single-choice mode):
> Now let's decide the agent's "communication method" — how will your customer service agent interact with customers? Here are 4 options — **pick the one** that best fits your business:

| # | Modality | Plain Description | Best For |
|---|---|---|---|
| 1 | Text-only IM | Agent replies via text chat only | Web live chat, in-app messaging, WeChat customer service |
| 2 | Text + TTS | Agent replies in text, with text-to-speech read aloud to the customer | Need voice feedback but don't want a phone line — e.g., smart speakers, app voice assistants |
| 3 | Full Modality | Text and voice both available — the most complete interaction | High-end scenarios requiring both text and voice |
| 4 | Voice-only Call | Agent communicates only via voice call, no text interface | Call centers, 400-phone customer service, voice hotlines |

```json
[{
  "id": "modality",
  "question": "Which communication method?",
  "options": [
    "① Text-only IM — Chat via text",
    "② Text + TTS — Text replies + voice readout",
    "③ Full Modality — Both text and voice",
    "④ Voice-only Call — Voice call only"
  ],
  "multiSelect": false
}]
```

> Made your choice? Just tell me the number.

### 7.5 End-to-End Verification (Voice Core — No UI)

> Since no UI is provided, voice quality is verified by the user in their own frontend. The Skill-side acceptance criteria are as follows (all three passing = end-to-end verified):

1. **Health self-check**: `GET /api/v1/health` — three LEDs (tencent_cloud / trtc / llm) all green
2. **Control plane up**: `POST /api/v1/agent/start` returns `TaskId / SessionId` successfully
3. **Integration sample delivered**: Room-entry / control sample code rendered per the user's tech stack has landed in `$PROJECT_ROOT`

Start core:
```bash
cd "$SKILL_ROOT" && nohup bash start.sh > /tmp/ai-cs-start.log 2>&1 &
sleep 8 && curl -sS http://localhost:3000/api/v1/health
```

### 7.6 Final Deliverables

> **The AI should say**:
> Assembly complete! Your AI customer service backend capabilities are ready. Here's what has been delivered:

- `/api/v1/*` backend API contract (output in §9)
- Outbound contract checklist + mock descriptions + replacement guide for each incremental capability
- Integration sample code paths matching your tech stack
- Integration entry point: `/docs` (Swagger) after launch

> What you need to do next: hand the API checklist to your developers and have them follow the documentation to integrate the AI customer service capabilities into your website or app. If you run into issues during integration, come back anytime.

### 7.7 Don'ts (Path B)
- ❌ Generate any frontend UI / apply voice-customer-service / widget-floating UI (those are Path A only)
- ❌ Use bare relative paths to call scripts (see §0)
- ❌ Replace mock implementations with real business systems on behalf of the user (only provide specs + adapters; the user decides when to swap)
- ❌ Modify `capabilities/*/src/core/` skeleton layer

---

## 8. Capability Linking: Human Handoff ↔ Session Summary (Implemented)

> When **human-handoff and session-summary are both installed** they automatically link up — no extra configuration by the AI needed.
> In Path A, session-summary is **default-installed** (see `recipe.yaml` `install:`), so the linkage is active out of the box. In Path B it links up only if the user selected session-summary.

**Behavior**: When human-handoff **creates a ticket**, it best-effort triggers session-summary to generate an **LLM one-paragraph summary** of the conversation (from AI connect → handoff trigger) and writes it into the ticket's **`Description`** field. When an agent opens the ticket details on the dashboard, they **directly see** this conversation summary under "Conversation summary" — no separate "Session Summary" block, no manual "Generate Summary" click needed.

**Implementation notes (for maintainers)**:
- Linkage entry point: `capabilities/human-handoff/src/summary_link.py` (`attach_summary_to_ticket`)
- Summary generation: `capabilities/session-summary/src/summarizer.py` → `summarize_paragraph(record)` (LLM, uses `LLM_API_KEY` / `LLM_API_URL` / `LLM_MODEL`). Falls back to leaving the description unchanged if LLM is not configured or the session has no recorded turns.
- **Soft dependency**: Dynamically loads session-summary via conversation-core's `_capability_loader`; not installed / any exception → silently skip, **does not affect the main handoff flow**
- Dashboard rendering (Path A): `admin-board/app.js` renders the ticket `description` as "Conversation summary"; the legacy structured `session_summary` block has been removed
- The transcript is uploaded by the frontend right before `/handoff/request` via `POST /api/v1/summary/{session_id}/record`, so the recorder has the turns to summarize

> The LLM summary call runs synchronously inside the ticket-creation chain and may take a few seconds. This is acceptable because the Path A frontend fires `/handoff/request` **without awaiting** it (the handoff animation plays in parallel); the ticket `Description` is populated by the time the agent refreshes the board.

---

## 9. API Contract Alignment

> Trigger condition: mandatory after assembly is complete. Substitute `$SKILL_ROOT` in commands with absolute paths before execution.

### 9.1 List Outbound APIs for Current Capability Packages

Read `manifest.yaml.business_contract.external_apis` for each capability package.
**Only list entries where `direction == outbound`**, outputting in the following natural language format:

```
✓ Installed: conversation-core + knowledge-base + human-handoff.
This session uses mock / local implementations as demo data.

Our capability packages call the following external business APIs:

  1. POST   /tickets                      ← human-handoff ticket creation
  2. GET    /tickets/{ticket_id}          ← human-handoff ticket status query
  3. POST   /tickets/{ticket_id}/cancel   ← human-handoff ticket cancellation
  4. POST   /faq/search                   ← knowledge-base FAQ search
  5. GET    /faq                          ← knowledge-base FAQ list
  6. POST   /faq                          ← knowledge-base FAQ create/update
  7. DELETE /faq/{entry_id}               ← knowledge-base FAQ delete
```

> Path B reminder: The contract checklist is one of the **core deliverables** to the user. Even if the user chooses "run with mocks first," leave this checklist with them.

### 9.2 Ask the User

> **The AI should say**:
> Do you want to switch to a real ticketing / knowledge base system?
> - Connect to my own system and adapt the interfaces accordingly
> - Run with mock data for now: skip interface adaptation and start directly

Use `ask_followup_question` single-choice:
- Connect own system → Enter §9.3
- Run with mocks → Jump to §10 (do not change adapter config)

### 9.3 contract-adapt Flow

1. AI asks "Which capability package to align?" (multi-select: human-handoff / knowledge-base)
2. For each capability package:
   - AI asks "Paste your API description: ① curl command ② OpenAPI YAML file path"
   - After collecting, **write to temp files**:
     - curl → `write_to_file(/tmp/adapt_<cap>.curl.txt, <user's text>)`
     - OpenAPI → user already has a path; pass it directly
   - Tool: `execute_command("cd \"$SKILL_ROOT\" && python3 scripts/contract-adapt.py <cap> --curl-file /tmp/adapt_<cap>.curl.txt --json")`
     or `--openapi-file <path>`
3. Parse returned JSON:
   - `{"level":"L1","artifact":"<path>"}` → Tell the user "Generated user_custom.py — ready to enable"
   - `{"level":"L2","artifact":"<path>","todos":[...]}` → List TODOs for the user to fill in
   - `{"level":"L3","guide":"INTERFACE_ADAPT.md#section"}` → Have the user follow the documentation

### 9.4 Enable user_custom

`write_to_file` append to `$SKILL_ROOT/capabilities/conversation-core/.env`:
```
HH_ADAPTER=user_custom         # or KB_ADAPTER=user_custom
HH_REST_BASE_URL=https://...
HH_REST_TOKEN=...              # if applicable
```

---

## 10. Launch & Verification

> Default port is 3000. Adjust with `--port <N>` if needed. If port is changed, sync all URLs / health checks below.
> Substitute `$SKILL_ROOT` in commands with absolute paths before execution.

### 10.1 Launch
```bash
cd "$SKILL_ROOT" && nohup bash start.sh > /tmp/ai-cs-start.log 2>&1 &
# Custom port: cd "$SKILL_ROOT" && nohup bash start.sh --port 8080 > /tmp/ai-cs-start.log 2>&1 &
```

### 10.2 Health Self-Check (first launch needs ≥30s — pip install)
```bash
sleep 8 && curl -sS http://localhost:3000/api/v1/health
# If connection refused: wait longer
sleep 25 && curl -sS http://localhost:3000/api/v1/health
```
Expected: response contains `"status":"ok"`, three LEDs (tencent_cloud / trtc / llm) all ok.

### 10.3A Path A — All Green → Output Final Message
```
Setup complete. Open the following URLs:

  · AI Voice Agent     http://localhost:3000             (default)
  · Admin board        http://localhost:3000/static/admin/
  · API docs (Swagger) http://localhost:3000/docs
  · Health probe       http://localhost:3000/api/v1/health

To stop: lsof -ti :3000 -sTCP:LISTEN | xargs kill
```

> **Correct entry**: The admin dashboard path is `/static/admin/` (**not** `/admin/tickets` — that route does not exist).

### 10.3B Path B — Verification → Output Final Message (No UI)
```
Backend capabilities integrated. Verification:

  · Health probe       http://localhost:3000/api/v1/health   (3 LEDs green)
  · Control-plane      POST /api/v1/agent/start  → returns TaskId / SessionId
  · API docs (Swagger) http://localhost:3000/docs            (integration entry point)

Delivered to your project ($PROJECT_ROOT):
  · Integration sample code (room entry / control), invocation order: get_config → enter room → agent/start → agent/control → agent/stop
  · Outbound contract checklist + mock descriptions for each incremental capability (swap with your real system as needed)

UI is implemented by your own frontend. Verify voice quality from your frontend after entering a room.
To stop: lsof -ti :3000 -sTCP:LISTEN | xargs kill
```

---

## 11. Common Issues

If you encounter any of the following issues, here are the corresponding solutions:

| Issue | Cause | Solution |
|---|---|---|
| Key verification failed | Configured key expired or incorrect | Go back to §5 and recheck each key value. You can re-enter only the one that failed |
| Port is occupied | Port 3000 is in use by another program | Switch to a different port (e.g., `--port 8080`), or stop the program using port 3000 |
| Network unreachable | Corporate network or firewall restriction | Check if you need a proxy, or contact your network administrator to open the relevant domains |
| Python version too old | Python < 3.9 | Download the latest version from https://www.python.org/downloads/ |
| Error on startup | Dependency version conflict | The system will auto-fix it. If errors persist, send me the error message |
| Browser shows old UI (Path A) | Browser cached the old page | `Cmd+Shift+R` (Mac) or `Ctrl+Shift+R` (Windows) to force refresh |
| `/admin/tickets` returns 404 (Path A) | That route doesn't exist | The correct entry is `http://localhost:3000/static/admin/` |

---

### 11.1 Error Recovery Technical Details

#### Can't find assets / "No such file" / scripts won't run
- **Root cause**: Bare relative paths used; cwd is not `SKILL_ROOT` (most common issue in older versions).
- **Solution**: Re-determine the absolute `SKILL_ROOT` per §0. All commands must `cd "$SKILL_ROOT"` or use absolute paths. Rerun.
- **Never** ask the user to move the Skill directory to the workspace top level.

#### .env exists but keys are invalid
1. AI proactively asks "Reconfigure? Keep old values or overwrite all?"
2. Choose "reconfigure" → During §5 flow, only re-ask for the failed key (keep others)
3. Choose "overwrite all" → Backup .env as .env.bak, start from §5 Key 1

#### Port is occupied
- Tool: `execute_command("lsof -ti :3000 -sTCP:LISTEN")`
- Ask the user "Kill process PID xxx? Or use a different port?"
- Change port: `cd "$SKILL_ROOT" && bash start.sh --port 8080`
- Kill process: `kill <PID>` (requires explicit user consent)

#### add-capability reports circular dependency
- Parse "circular dependency among: [...]" from stderr
- Tell the user which capabilities conflict; guide them to modify **manifest.yaml.dependencies** and retry
- Do not modify any manifest yourself

#### LLM verification failed but user is using a non-OpenAI service
- Ask which service the user is using (DeepSeek / Qwen / Moonshot / Anthropic, etc.)
- Guide them to update `LLM_API_URL` and `LLM_MODEL`:
  - DeepSeek: `https://api.deepseek.com/chat/completions`, model: `deepseek-chat`
  - Others: Have the user provide the official base_url + chat completions path
- Rerun: `cd "$SKILL_ROOT" && python3 scripts/verify-credentials.py --type llm`

#### verify-credentials.py returns E004 (network unreachable)
- Ask if behind a corporate network / need a proxy
- Quick fix: Have the user append `HTTPS_PROXY=...` to .env
- TRTC deep verification failure can be downgraded: `--no-deep` for local UserSig self-consistency check only

#### `NameError: name 'session_id' is not defined` after startup
- **Root cause**: Stale injection position from older version
- **Solution**: Run `cd "$SKILL_ROOT" && python3 scripts/post-install-patch.py`
- Do not manually edit agent.py — let the patch script handle it

#### contract-adapt.py parse failure
- Outputs `{"level":"L3", ...}` → Guide the user to read the corresponding capability package's INTERFACE_ADAPT.md
- Do not ask the user to repaste curl more than 2 times. On the 3rd attempt, go directly to L3 manual flow

---

## 12. AI Tool Whitelist (Mandatory)

> Substitute all `$SKILL_ROOT` / `$PROJECT_ROOT` with absolute paths before execution. Always `cd "$SKILL_ROOT"` or use absolute paths when calling scripts.

### 12.1 Allowed Commands (execute_command)

| Command | Purpose |
|---|---|
| `python3 -c "import sys; assert sys.version_info >= (3,9)"` | Prerequisite check |
| `test -f "$SKILL_ROOT/<path>" && echo OK \|\| echo MISSING` | File existence check |
| `find "$PWD" -maxdepth 4 -name SKILL.md -path '*ai-service*'` | SKILL_ROOT fallback detection |
| `cd "$SKILL_ROOT" && python3 scripts/verify-credentials.py [--type tencent\|trtc\|llm] [--no-deep]` | Key verification |
| `cd "$SKILL_ROOT" && python3 scripts/add-capability.py <names> --apply --json [--target-project "$PROJECT_ROOT"] [--tech-stack ...]` | Capability assembly |
| `cd "$SKILL_ROOT" && python3 scripts/post-install-patch.py` | Post-install patch |
| `cd "$SKILL_ROOT" && python3 scripts/contract-adapt.py <name> [--curl-file ... \| --openapi-file ...] --json` | API contract adaptation |
| `cp "$SKILL_ROOT"/scenarios/customer-service/ui/voice-customer-service/{index.html,app.js,styles.css,data.js,mock-shop.json,tokens.css} "$PROJECT_ROOT"/ai-customer-service-demo/` | UI overlay (Path A only) |
| `cp -R "$SKILL_ROOT"/scenarios/customer-service/ui/admin-board/. "$PROJECT_ROOT"/ai-customer-service-demo/admin/` | Admin board mount (Path A only) |
| `mkdir -p "$PROJECT_ROOT"/ai-customer-service-demo/admin` | Create demo deployment directory (Path A only) |
| `echo "WEB_DEMO_DIR=<path>" >> "$SKILL_ROOT"/capabilities/conversation-core/.env` | Write demo directory path (Path A only) |
| `cd "$SKILL_ROOT" && bash start.sh [--port N] [--https]` | Launch |
| `cd "$SKILL_ROOT" && nohup bash start.sh > /tmp/ai-cs-start.log 2>&1 &` | Background launch |
| `sleep N && curl -sS http://localhost:3000/api/v1/health` | Health check |
| `tail -80 /tmp/ai-cs-start.log` | Startup failure diagnostics |
| `lsof -ti :3000 -sTCP:LISTEN` | Check port usage |
| `chmod 600 "$SKILL_ROOT/capabilities/conversation-core/.env"` | Tighten permissions |

### 12.2 Forbidden Commands

| Command | Reason Prohibited |
|---|---|
| `python3 scripts/setup-credentials.py validate-tencent-cloud --secret-id ...` | Key passed via command line → shell history leak |
| `echo $TENCENT_CLOUD_SECRET_ID` | shell history leak |
| `cat "$SKILL_ROOT/capabilities/conversation-core/.env"` | May leak via terminal recording / screenshots |
| `git add . && git commit` | Credentials may be committed by mistake |
| Any command with plaintext keys as arguments | Same as above |
| Bare relative paths to call scripts (`python3 scripts/...` without `cd "$SKILL_ROOT"`) | Wrong cwd assumption → can't find assets |

### 12.3 File Write Whitelist (write_to_file)

| Path | Purpose |
|---|---|
| `$SKILL_ROOT/capabilities/conversation-core/.env` | Key write |
| `$PROJECT_ROOT/<adapter rendered artifact>` | Path B: integration samples (written by script, not AI) |
| `$SKILL_ROOT/capabilities/<cap>/src/adapters/user_custom.py` | Generated by contract-adapt.py |
| `/tmp/adapt_<cap>.curl.txt` | Temporary storage for user's curl |
| `/tmp/ai-cs-start.log` | nohup startup log |

Other file writes require **explicit user confirmation** before writing.
**Special note**: `capabilities/conversation-core/src/agent.py` and `capabilities/conversation-core/src/server.py` are the skeleton layer. The AI should **not** directly edit them by hand.

---

## 13. Design Standards Reference (Path A UI Only)

> Path B generates no UI. This section does not apply to Path B.

Path A UI must follow `$SKILL_ROOT/scenarios/customer-service/ui/design-system/DESIGN_GUIDELINES.md`:

| Item | Mandatory Requirement |
|---|---|
| Theme | Light glassmorphism locked (soft purple + light pink + pale blue ambient over `#f7f3ff`; no dark mode toggle) |
| Colors | Everything via CSS variables from `tokens.css`; **no hardcoded hex values** |
| Font | `SF Pro / Inter / Helvetica Neue`, Chinese fallback to system default |
| Icons | Lucide / Phosphor style monoline SVG icons, sizes: 16/20/24/32 |
| Emoji | **Completely disabled** in the UI rendering layer (use SVG icons + text instead) |
| Glassmorphism panels | `backdrop-filter: blur(20px)` + `@supports` fallback |

### 13.1 Top Bar LED Tooltip Convention

The 3 LEDs in the top right each show a tooltip on hover:

| LED | Title | Explanation |
|---|---|---|
| Cloud | Tencent Cloud API | Control-plane (CAM/STS); used to issue temporary credentials |
| TRTC | TRTC (Real-Time Communication) | Data-plane media channel; carries voice streams / subtitles / custom messages |
| LLM | LLM provider | Inference engine; OpenAI-compatible protocol; swappable with DeepSeek / GPT / Claude, etc. |

---

> **Final Reminders** (for the Coding Agent to internalize):
> - 🔴 **Path baseline first**: Determine `SKILL_ROOT` (= injected Base directory) and `PROJECT_ROOT` per §0 before anything else.
>   Always `cd "$SKILL_ROOT"` or use absolute paths for all script/asset commands. **Never ask the user to move directories.**
> - At each step, first call the tool to get facts, then explain to the user (don't answer from memory)
> - Tool call failure → give the user a stderr summary; **do not** hide errors
> - Uncertain field / path → use `read_file` to check the manifest, then answer
> - Strictly follow §12 Tool Whitelist and §5.4 Security Red Lines throughout
> - **This Skill's selling point is voice**; text-only requests → advise the user to configure it themselves; do not generate artifacts
> - **Path A** must run all 6 steps. Never skip Step 2.5 (post-install-patch) or Step 3 (UI overlay)
> - **Path B** never generates any UI; core end-to-end verified + incremental capabilities provide specs/mocks/samples only
> - human-handoff legacy API field is `state` (values: `waiting/connected/closed/canceled/timeout`), not `status`/`queued`/`cancelled`
