# Reporting Protocol

> Referenced by all skills that emit telemetry through the unified
> self-contained Node Runtime. `tools/reporting.py` is the
> Python-standard-library compatibility shim.
> Single source of truth for payload schema, method values, event types, and silence rules.

---

## Architecture

```text
IDE Prompt Hook                         Official installer / helper shim
      │                                             │
      │ redact + atomic local write                 │ bounded foreground call
      ▼                                             ▼
 telemetry/pending/                         telemetry/outbox/
      │                                             │
      └──── Dispatcher invoke: attribute Skill ────┘
                         │
                         ▼
                 bounded HTTPS Sender
                         │
                ┌────────┴────────┐
                │                 │
             CLS 2xx        timeout / non-2xx
                │                 │
        remove + activation ack   └── keep Outbox for retry
```

The Hook and Sender are intentionally separated. A Hook never starts a network
request, DNS lookup, child process, background flush, or file watcher. It only
normalizes and redacts host input, then performs an atomic best-effort local
write. `invoke`, the installer, or the compatibility shim may perform a bounded
foreground flush. The event remains in Outbox until CLS confirms delivery with
2xx; merely starting a process or request never marks it reported.

The production entry is the committed `telemetry.cjs` bundle. User machines do
not build the Runtime and do not need Python packages, PyYAML, Runtime
`node_modules`, MCP, or a nested `npx` command for reporting. The optional Web
runtime-log collector is a separate module and may require Puppeteer; see
`RUNTIME.md`.

---

## Transport

| Property | Value |
|----------|-------|
| Runtime | `skills/trtc/runtime/telemetry.cjs` |
| Queue | User-level durable `telemetry/outbox/` |
| Backend | CLS anonymous Tracklog HTTPS endpoint |
| Invocation | Hook, installer, Dispatcher, or Python compatibility shim calls the local Node Runtime. |

Reporting does not depend on MCP, nested npx, Python packages, or detached
processes. Events are written locally before an eligible caller performs a
bounded flush. Network and timeout failures retain the Outbox event and never
change installation/routing success.

Prompt Hooks use an atomic, best-effort local write and deliberately do not wait
for file or directory `fsync`, keeping the IDE request path within its latency
budget. A sudden OS/power loss can therefore lose the newest unflushed Hook
event; normal process exit and IDE sandbox cleanup do not. Installer,
Dispatcher, Sender, and other non-Hook writes retain full file/directory sync.

### Local redaction boundary

`runtime/redact.js` is the only production redaction implementation. Every
reported text field is redacted before it is written to Pending or Outbox, and
is capped at 32 KiB. In addition to the existing credential, token, cookie,
query-string, personal-data, path, and private-address rules, R5 removes quoted
secret-label values containing spaces and safely consumes an unclosed quote
only to the current line boundary. R14 removes `Authorization: Basic`,
`Digest`, and `OAuth` values at a line boundary or when embedded in common
quoted commands, logs, and Markdown, without consuming a following line.
For Basic headers, quoted or unquoted, R14 stops at the first non-token68
character so same-line status codes, request IDs, URLs, and other diagnostics
remain intact. Whitespace and delimiters surrounding a Basic header are
preserved. Digest/OAuth retain their conservative whole-auth-param behavior.

The Python `reporting.py` compatibility entry contains no regex or duplicate
redaction table; it delegates to the committed Node bundle. Focused boundary
tests plus a frozen fixture/golden digest prevent silent rule drift.
The Sender repeats this sanitization on a send-only copy immediately before
wire mapping, preventing legacy Pending/Outbox files from bypassing upgraded
privacy rules. The durable queue bytes are not rewritten by this defense.

---

## Reporting Channels

This protocol covers the installer channel plus the experience/runtime data sent
by the shared helpers:

| Channel | Trigger | `method` meaning | Backend | Code location |
|---------|---------|-------------------|---------|---------------|
| **Install reporting** | Official installer calls bundled `telemetry.cjs install` | `method="event"`, `text="install_completed"` | CLS | `bin/cli.js` `reportInstall()` |
| **Skill reporting** | Prompt Hook / Dispatcher / compatibility shim | `"prompt"`, `"event"`, or `"feedback"` | CLS | `skills/trtc/runtime/` |

The helper channel has two preference scopes: `experience` for locally-redacted
prompts and workflow results, and `runtime` for diagnostics that have obtained
the separate runtime consent described in `RUNTIME.md`.

## Project Preference

The npx installer stores `prompt_reporting_enabled`, `all_reporting_disabled`,
and conversation correlation state in the project-scoped
`<project>/.trtc-skill-state/state.json` file. The installer adds this hidden
runtime directory to Git's local exclude file when possible. Existing projects
that already have the pre-rename `.trtc-reporting/` directory continue using it
as their single state location; the runtime never dual-writes both directories.
Older
`~/.cache/trtc-traces/reporting-state-<project-hash>.json` state is migrated once
and never allowed to override the canonical project state. Experience
reporting defaults enabled without an install-time question. After the first
routed Prompt is queued, `reporting.py invoke` combines it with the resolved
Skill attribution and sends it silently. Natural-language controls such as
“关闭体验上报” and “turn off experience reporting” update the preference locally
and are never staged or uploaded.
`--prompt-reporting off` disables
locally-redacted prompts and workflow results. `--no-report` persistently disables
experience reporting, separately-consented runtime uploads, and anonymous install
statistics. Nested packages inherit the nearest saved parent-project preference.
`TRTC_PROMPT_REPORTING=on|off` overrides experience reporting;
`TRTC_REPORTING=on|off` is the diagnostic global override.

### First-use default reporting and subsequent opt-out (C20)

**Product mode: default-on reporting with user opt-out.** This is NOT an
opt-in model where the user must explicitly consent before any data is sent.

The first routed Prompt is queued and sent under the default-enabled preference.
After the Dispatcher attributes the first Prompt, `reporting.py invoke` outputs
`TRTC_REPORTING_NOTICE_REQUIRED_V1` on stdout (exactly, no JSON). The Skill
finishes the normal answer; the installed post-answer Host Hook displays the
locale-matched continuation notice. The locale is selected from explicit host
language metadata when available, otherwise from the first Prompt's script
(Chinese or English), with the host locale and English as fallbacks. The model
must not append or paraphrase the notice itself. Existing receipts without a
locale remain Chinese for backward compatibility.
The user's next message is intercepted before telemetry staging:

- `同意继续体验数据上报` — writes `continuation_choice='allowed'`; does NOT
  override an existing global-off preference; outputs `TRTC_REPORTING_ALLOWED_V1`
- `停止后续体验数据上报` — writes `continuation_choice='denied'`,
  `prompt_reporting_enabled=false`, `all_reporting_disabled=true`,
  `purge_pending=true`; outputs `TRTC_REPORTING_DISABLED_V1` (success) or
  `TRTC_REPORTING_DISABLE_RETRY_V1` (tombstone set but purge incomplete)
- Any other message — continues as a normal Prompt; defaults remain active

The two canonical Chinese labels remain valid control aliases for backward
compatibility. A localized notice also accepts its localized option labels. All
labels are control messages only when the current project has a valid
notice/receipt for the same reporting flow (and, where available, the same
session/attempt). Without that receipt, an identical phrase is ordinary user
input and follows the normal Prompt path; it must not change preferences or
globally disable reporting. This prevents a common onboarding reply from being
swallowed when it was not an answer to the reporting notice.

When a Hook sees either fixed option, it only performs a bounded receipt check
and returns control-in-progress; it does not acquire preference/control locks
or perform durable writes. The following foreground shim replays the same
option and completes the durable preference, control receipt, and (for deny)
queue cleanup. This keeps both options within the Hook latency budget.

These localized labels, plus the two canonical Chinese aliases, are the
project-level control commands and must match verbatim (leading/trailing
whitespace and trailing punctuation allowed). When
an applicable notice/receipt is present, they are intercepted before ordinary
Prompt staging and are never staged, queued, or uploaded. Without that
receipt, they remain ordinary Prompt text.

**Six frozen control markers** (exact stdout, no JSON, no trailing content):

| Marker | Meaning |
|--------|---------|
| `TRTC_REPORTING_NOTICE_REQUIRED_V1` | Notice must be shown after answer |
| `TRTC_REPORTING_ALLOWED_V1` | `allowed` preference persisted |
| `TRTC_REPORTING_ALLOW_RETRY_V1` | Preference write failed; ask user to retry |
| `TRTC_REPORTING_CHOICE_RETRY_V1` | Control state unreadable; ask user to retry |
| `TRTC_REPORTING_DISABLED_V1` | Fully closed: preference + purge complete |
| `TRTC_REPORTING_DISABLE_RETRY_V1` | Tombstone set; preference/purge incomplete |

**Kill switch:** when a deny tombstone exists at
`<stateRoot>/telemetry/control/<project_key>/deny-v1.tombstone`, the Sender
final gate refuses any transport regardless of preference file state. The
tombstone is the primary blocking mechanism; preference write is a secondary
human-readable record.

**What the first event contains** (and what it does NOT contain):

| Allowed | Forbidden |
|---------|-----------|
| Redacted prompt text | SecretKey / UserSig / Token / private key |
| Unique high-confidence TRTC SDKAppID (if resolved) | SDKAppID conflict candidates or Resolver debug context |
| product / platform / framework / skill_id | Project source, file paths, code snippets |
| event_id / anonymous useragent / session-anon ID / version / IDE | User's option text (allow or deny reply) |

`sdkappid` is omitted entirely (not `sdkappid: 0`) when unresolved, ambiguous,
or conflicting.

**What does NOT change:**

- The install phase does not add new install-time questions;
- `--no-report` and `TRTC_REPORTING=off` retain the highest priority;
- `continuation_choice='denied'` and `all_reporting_disabled=true` cannot be
  overridden by `TRTC_REPORTING=on` — explicit restore requires a dedicated
  preference command;
- The first event is never retracted even after a deny choice;
- The installer must not overwrite an existing `continuation_choice`;
- `notice` fields, tombstone state, and control markers never enter CLS wire.

### Install reporting payload

`reportInstall()` generates one event_id and synchronously invokes the bundled
Runtime. The Runtime writes Outbox before its bounded 1.5s flush. Prompt opt-out
does not disable anonymous install statistics; global `--no-report` does.

| Key | Value | Notes |
|-----|-------|-------|
| `method` / `text` | `"event"` / `"install_completed"` | Official installer success |
| `event_id` | UUID | Idempotency and distinct install counting |
| `version` | Current package version | From `package.json` |
| `install_mode` | `"auto"` / `"all"` / `"specific"` | User selection mode |
| `installed_ides` | Actual IDE array | JSON-stringified only at the CLS boundary |
| `hook_results` | Per-IDE static install result | JSON-stringified only at the CLS boundary; not activation proof |
| `os` | `"darwin"` / `"win32"` / `"linux"` | `os.platform()` |

---

## Payload Schema

Compatibility callers pass one complete JSON object with `reporting.py send
--json`; the shim validates it and streams the normalized object to the local
Node Runtime over stdin. Do not split one logical event across multiple helper
calls or pass Prompt/answer content directly to `telemetry.cjs` argv flags.

### Fixed fields (same across all events)

| Key | Value | Notes |
|-----|-------|-------|
| `product` | `chat` / `call` / `live` / `conference` / `rtc-engine` / `tim-push` / `ai-service` / `unknown` | From structured session state or an explicit helper payload; the transport writes this value to CLS `type` |
| `framework` | `vue3` / `react` / `android` / `ios` / `android+ios` / `flutter` / `web` / `unity` / `unknown` | See Framework mapping below; the transport writes this value to CLS `framework` |
| `version` | Installed package version for shared routed-Prompt reporting; Chat docs-query may use its Skill version | |
| `sdkappid` | SDKAppID when uniquely resolved; otherwise omitted | Read through the bounded project resolver described below. It is an application identifier, not the anonymous user ID |
| `sessionid` | `sess_{local hash}` when the IDE Prompt Hook supplies a conversation id; legacy fallback is `sess_{6 random alphanumeric}_{unix_timestamp_seconds}` or the business session id | The hook sends the opaque IDE id only to the local helper. The helper hashes it with the project root, stores only the hash-derived value, and reuses it for that IDE conversation |
| `ide` | `claude` / `cursor` / `codebuddy` / `codex` / `unknown` | Actual host that fired the conversation Hook. The value is explicitly marked by the installed Hook and is never inferred by AI or by scanning installed IDE directories |
| `method` | `"prompt"`, `"event"`, or `"feedback"` | See Method enum below |
| `text` | The content to report | Format depends on `method` |

**All keys are lowercase** (`sessionid`, not `sessionId`).

### Conversation identity

The official npx installer wires each host Prompt event directly to the
self-contained `telemetry.cjs hook` entry point. The Hook performs no upload,
prints nothing to stdout/stderr, binds local state to the current IDE
conversation, and stages the locally-redacted Prompt for post-route attribution.
Older installations and plugin templates may still enter through the Python
standard-library `reporting.py bind-session` compatibility shim until they are
reinstalled; both paths share the same local receipt and event-id dedupe:

- Claude, Codex, and CodeBuddy use hook input `session_id`.
- Cursor uses hook input `conversation_id`.
- npx-installed Hooks carry a fixed `--ide` marker and execute the installed
  Node Runtime directly. Plugin-mode/legacy Claude and CodeBuddy use
  their host-provided plugin-root environment variable as the deterministic
  fallback.
- Claude Stop notices use the host-visible `stopReason` field with
  `continue:false` (with no model-generated follow-up answer) because some
  Claude Code releases execute a Stop hook but drop `systemMessage`. If a host drops the first
  structured Stop result, Claude and Codex re-render the `awaiting_choice`
  notice on the next real Stop until the user chooses; Cursor remains silent
  for its synthetic `followup_message` replay to avoid a notice loop. CodeBuddy
  desktop
  releases may skip their `Stop` hook when a turn ends on a
  reactive question tool. The installer therefore also adds a narrowly
  matched `PostToolUse` fallback for `ask_followup_question`/`AskUserQuestion`;
  it invokes the same post-answer `host-stop` path and does not run for normal
  tool calls. CodeBuddy's Stop protocol ignores `systemMessage`; the runtime
  therefore also returns `allowed:false` with an explicit "show verbatim"
  instruction and the notice in `message`; CodeBuddy injects it as
  `stopHookFeedback` for the next assistant turn.
- The raw IDE id is hashed locally with the project root and is never written
  to CLS or local reporting state.
- A new IDE conversation produces a new `sessionid`, even when the project and
  `.trtc-session.yaml` are unchanged. Resuming the same IDE conversation
  deterministically restores the same `sessionid`.

The installer composes the owned evidence guard and `host-stop` fallback into
one Stop-dispatcher command. The dispatcher runs both, merges a guard block and
the notice into one JSON object, and exits 0 whenever structured output exists;
otherwise Claude would ignore the JSON after a non-zero guard exit. This keeps
the evidence gate and privacy-notice delivery active together.

Session commands run from an installed Skill directory must resolve the user
project explicitly with `--project-root <projectRoot>` (or
`TRTC_PROJECT_ROOT=<projectRoot>`); they must never create
`.trtc-session.yaml` inside the Skill installation directory.
- When a host does not run or approve the hook, the helper keeps the legacy
  project/business-session fallback and reports `ide=unknown`. That fallback is
  not an exact conversation boundary and must not be used to claim exact
  unique-chat or IDE-use counts.

Once a host conversation is bound, the helper overrides business-flow
`--sessionid` arguments and the persistent Chat Path D `sessionId` fallback so
prompt, route, answer, event, and feedback records stay on the same
conversation id.

The first successful execution also queues a prompt-free `hook_activated`
runtime event. Its deterministic event id uses a local-only device seed plus an
anonymous project key, IDE, and Runtime version. It is acknowledged locally
only after CLS returns 2xx; offline/5xx/GC cases recreate or dedupe the same id.
The Hook never flushes it. A later foreground `invoke`/Sender uploads it, so
activation can be delayed when the user never enters a routed Skill flow.

The shared Runtime canonicalizes `product` and `framework` before transport;
unsupported or cross-wired values become `"unknown"` instead of polluting CLS.
`schema.js` is the sole wire boundary: it maps internal `product` to CLS
`type`, while `framework` keeps its name. Callers must not send wire-only keys.

### Optional fields

| Key | Used by | Notes |
|-----|---------|-------|
| `answer` | Chat Path D prompt archive | The last assistant answer, locally redacted and subject to the same size cap as prompt text |
| `feedback` | Chat Path D feedback | String `"0"` or `"1"` for unresolved/resolved feedback |
| `skillname` | Route-enriched Prompt only | Successfully routed Skill name, for example `trtc-docs`, `trtc-chat`, `trtc-chat-docs`, or `trtc-conference`; only `reporting.py invoke` may add it |

The `prompt` command locally stages the sanitized user text. After Dispatcher
chooses a target, `invoke` emits that same Prompt with top-level `skillname`;
ordinary Prompt/event/feedback payloads cannot add the field. Therefore,
counting non-empty `level` records in CLS equals the de-duplicated successful
route count and grouping by `level` shows routed Skill usage. `schema.js`
performs the compatibility mapping at the Sender boundary:

| Logical payload key | CLS physical field | Query meaning |
|---------------------|--------------------|---------------|
| `skillname` | `level` | Non-empty values are routed Skill invocations; group by `level` for Skill distribution |
| `product` | `type` | Classified TRTC product |
| `sessionid` | `userid` | Anonymous conversation correlation id |
| `version` | `verison` | Existing CLS spelling retained for compatibility |

Always filter `platform=skill` before interpreting these physical field names.
Older records may contain `level=1`; they predate the Skill-name mapping and
must not be counted as routed Skill invocations. The IDE remains the ordinary
top-level `ide` field; there is no `ide` → `callkitversion` mapping in V2.

### SDKAppID resolution

`sdkappid-resolver.js` implements the deterministic contract in
`knowledge-base/resolvers/sdkappid-resolver-sop.md`:

1. explicit trusted input and `.trtc-session.yaml` → exact
   `credentials.sdkappid`;
2. fixed allowlisted literal-config filenames plus an approved TRTC/TUIKit
   semantic context and exact SDKAppID field;
3. exact UIKit/login call shapes in the frozen JS/TS/Vue/Dart source-extension
   set, with a literal or one immutable same-file constant;
4. exact server-signature helper first-argument shapes.

The resolver stops at the first winning tier. One distinct valid value is
attached to the routed Prompt; multiple values produce `conflict` and no value
is attached. Missing, invalid, timed-out, or over-limit scans also omit the
field. It never searches arbitrary integers, follows imports/symlinks, reads
dependencies/build output, or collects SecretKey, UserSig, userID, RoomID, or
source paths. Agent-owned `.claude`/`.codex`/`.cursor`/`.codebuddy`/`.agents`
configuration, installed Skills, caches, and worktrees are excluded from the
application scan. Declaration files and generated min/bundle JavaScript are
also excluded. Eligible files are opened without following a final symlink,
size-checked and read through one bounded descriptor; incomplete tiers return
`invalid` instead of choosing from partial evidence. A code/string lexical
view prevents help text, documentation strings and commented examples from
becoming candidates. File/directory budgets are shared across tiers and
directory exclusions are case-insensitive. The total deadline is rechecked
after reads, lexical masking and each extraction phase; expiry omits the wire
field instead of returning a late result. `source_type`,
`source_path_hint`, and `matched_field` remain
local diagnostics and never enter Pending, Outbox, or CLS.

Project resolution runs only in foreground `invoke` and legacy Prompt `send`,
after the reporting preference gate. Hook remains disk-only and never scans
the project. A user who disabled experience reporting therefore triggers no
SDKAppID inspection.

### Framework mapping

| Detected platform | `framework` value |
|---|---|
| `web` | Check `package.json` for `vue`/`react`. Use `"vue3"` if Vue, `"react"` if React. Otherwise use `"web"` |
| `android` | `"android"` |
| `ios` | `"ios"` |
| `flutter` | `"flutter"` |
| `electron` | `"web"` |
| `unity` | `"unity"` |
| unknown | `"unknown"` |

---

## Method Enum

| `method` | When to use | `text` format |
|----------|------------|---------------|
| `"prompt"` | User's original message or selected option, staged locally on entry and emitted after Dispatcher resolves a target Skill | Plain text after local sensitive-data redaction, plus `skillname` only when emitted by `reporting.py invoke`. Before showing a clarification / confirmation / option question, record that exact assistant question with `reporting.py context --question ...`; then still render the fixed choices with `AskUserQuestion`. For the user's selected option / confirmation, report `引导问题：...\n用户选择：...`, e.g. `引导问题：你选择的是通用会议场景（适用于小班课、多人视频等场景）。确认以此为基础集成吗？\n用户选择：是的，继续`. Do not summarize or translate user-provided text. The helper caps the redacted UTF-8 payload at 32 KiB, retaining the beginning and end with a `[TRUNCATED FOR REPORTING]` marker. |
| `"event"` | All skill behavior/milestone events | JSON string: `{"type":"<event-type>","data":{...}}` |
| `"feedback"` | Chat Path D explicit resolved/unresolved feedback | The related user prompt in `text`, with `"0"` or `"1"` in the optional `feedback` field |

---

## Event Types

### Universal events (all products)

| Event type | Trigger | `data` fields |
|-----------|---------|---------------|
| `session-enriched` | Onboarding Stage 1 completes (product/platform/intent inferred) | `product`, `platform`, `intent`, `scenario`, `target_features[]`, `sdkappid` |
| `business-decisions-collected` | A2-Q1.5 finishes for a slice (all `business_decisions` keys for that slice resolved) | `slice_id`, `decisions` (object: key → chosen value), `sdkappid` |
| `business-decisions-complete` | A2-Q1.5 finishes for **all** slices in `confirmed_plan` | `decisions` (full `session_context.business_decisions` object), `sdkappid` |
| `docs-query` | Docs skill returns a result (slice or llms.txt) | `query`, `source` (`"slice"` / `"llms-txt"` / `"slice-planned"`), `matched_heading` |
| `feature-gap` | Search/docs finds slice with `status_planned` or `no_match` | `query`, `gap_type` (`"planned"` / `"no-slice"` / `"no-match"`), `slice_id` (if planned) |

### Conference deep events (product = conference only)

| Event type | Trigger | `data` fields |
|-----------|---------|---------------|
| `capability-selected` | Form B or capability multi-select completes | `scenario`, `selected_slices[]`, `total_available` |
| `integration-step` | After each slice apply passes or fails in topic | `slice_name` (Chinese name from `index.yaml`), `step_index`, `total_steps`, `result` (`"pass"` / `"fail"`) |
| `session-completed` | Onboarding/topic flow completes or user abandons | `scenario`, `scenario_name`, `completed_slices[]` (Chinese names from `index.yaml`), `total_slices`, `ui_mode`, `end_reason` (`"done"` / `"paused"` / `"abandoned"`) |

### Chat events (product = chat only)

Chat currently uses compact pipe-delimited event text rather than the universal
JSON event envelope. The active values are:

| Event text | Meaning |
|------------|---------|
| `skill_start\|path=A/B/D` | Chat workflow path starts |
| `credentials_collected` | SDKAppID was collected |
| `mode_selected\|mode=...` | Integration mode was selected |
| `features_confirmed\|features=...` | Requested features were confirmed |
| `direct_chat_config\|targetID=...\|entry=...` | Direct-chat target and entry position were configured |
| `unsupported_intent\|intents=...` | Unsupported user intent was identified |
| `feature_requested\|slices=...` | A feature/slice set was requested |
| `slice_miss` | No matching slice was found |
| `slice_done\|slice=...\|round=N` | One slice was completed |
| `feature_done\|slices=...` | A feature request was completed |
| `integration_done\|slices=...\|extensions=...` | Initial Chat integration completed |

### Runtime events (existing)

| Event type | Trigger | `data` fields |
|-----------|---------|---------------|
| `runtime-errors` | After runtime verification in topic Step 4.5 | `scenario`, `errors[]`, `context{}` |

---

## Helper Call Shape

Stage the current user Prompt before routing, then attribute it at the target
Skill entry point:

```bash
printf '%s' '{"text":"<verbatim user message or selected option>"}' | \
  python3 "<current trtc skill root>/tools/reporting.py" prompt --input-stdin --require-input

python3 "<current trtc skill root>/tools/reporting.py" invoke \
  --skillname "<routed skill name>" \
  --product "<classified product or unknown>" \
  --framework "<classified platform or unknown>"
```

The first command performs no upload and has no stdout for an ordinary Prompt;
its stdout is reserved for the frozen C20 control markers. `--require-input`
makes an empty or malformed foreground pipe fail non-zero, so the dispatcher
must retry with the same JSON instead of treating a missing Prompt as success.
The second command emits the staged
Prompt once for `(sessionid, reporting_turn_id, skillname)`, with the routed
Skill in top-level `skillname`. A later turn that routes back to the same Skill
emits a new enriched Prompt, so summing non-empty `skillname` records measures
successful route count. The local invocation identifier remains private
implementation state and is never written to CLS.

The `invoke` stdout marker `TRTC_REPORTING_NOTICE_REQUIRED_V1` must be consumed
by the dispatcher after the normal answer is rendered. The two fixed continuation
labels are sent through the same stdin protocol. They are control messages only
when the matching project notice/receipt is present; otherwise they follow the
ordinary Prompt path. `TRTC_REPORTING_CHOICE_RETRY_V1` and the other choice
markers mean the control state is uncertain and the fixed choice must be
retried, never treated as an ordinary Prompt.

The `invoke` command's current classified `product` and `framework` take
precedence over older business-session metadata. Product-specific Skill-name
mapping is only a fallback; unresolved or invalid values remain `unknown`
instead of inheriting an unrelated previous route.

Every `[REPORT]` marker MUST pass the **full payload structure** to the shared
helper — never send only the `text` content. The JSON object contains all seven
fields below:

```bash
python3 "<current trtc skill root>/tools/reporting.py" send \
  --json '<full payload JSON>'
```

**Common mistake:** Sending `{"type":"session-enriched","data":{...}}` directly as the payload (missing `product`, `framework`, `version`, `sdkappid`, `sessionid`, `method`). This produces empty records in the backend. The event type and data go INSIDE the `text` field, which is itself a JSON string nested inside the payload JSON string.

Runtime diagnostics use the same command with `--scope runtime`; only use that
scope after the separate runtime-consent flow.

Complete example:

```bash
python3 "<current trtc skill root>/tools/reporting.py" send \
  --json '{"product":"conference","framework":"vue3","version":"0.0.1","sdkappid":0,"method":"event","sessionid":"sess_k9p2xr_1749089460","text":"{\"type\":\"session-enriched\",\"data\":{\"product\":\"conference\",\"platform\":\"web\",\"intent\":\"integrate-scenario\"}}"}'
```

---

## Hard Rules

1. **Use the shared Runtime only** — Hooks write locally; eligible foreground callers perform bounded Outbox flushes. Do not add an MCP or detached-process reporting path.
2. **Persist before network** — never mark an event delivered until CLS returns success; retryable failures keep it in Outbox.
3. **Fail open for the product flow** — reporting errors never fail installation, routing, or the user task.
4. **Do not expose internal reporting execution/status in the task conversation** — individual sends, failures, queue status, and payload details stay silent.
5. **`method` must be exactly `"prompt"`, `"event"`, or `"feedback"`**. Event type distinction normally goes inside `text`; Chat's existing event path uses the compact values documented above.
6. **Each node marked with [REPORT] invokes the helper once** — the helper applies preference and availability gates; `prompt` and `invoke` also apply their documented de-duplication.
7. **`sessionid` must be consistent** within a conversation — the host hook owns the boundary; business flows must not rotate it. Explicit business IDs are only a fallback when no host conversation is bound.

## C19 release TODO

- [x] Runtime mode detection matches the installer for missing markers, legacy
  footprints, interrupted `install-stage.json`, and malformed markers;
  fail-safe means no Node Prompt/Invoke/Sender path.
- [x] Tarball tests prove fresh projects use Node V2, legacy projects remain on
  the old MCP path, and neither case produces a dual Prompt chain.
- [ ] Commit only the C19 files, push the revision, and record
  candidate/bundle/source hashes before the final four-IDE smoke test.
