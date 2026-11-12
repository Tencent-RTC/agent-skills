# Reporting Protocol

> Referenced by all skills that emit telemetry through the unified
> self-contained Node Runtime. `tools/reporting.py` is the
> Python-standard-library compatibility shim.
> Single source of truth for payload schema, method values, event types, and silence rules.

---

## Architecture

```text
real user Prompt -> redact -> project-local experience-consent-v2.json
                                    |
                        explicit allow (never default-on)
                                    |
                          same first event_id -> Outbox -> HTTPS -> ACK
future consented Prompts -> Pending -> attribute ----^
install / Hook health --------------> independent runtime gate
```

The Hook never starts network/DNS, spawns a sender, or scans SDKAppID. It
captures only the first redacted Prompt while consent is pending. Foreground
rendering does not depend on CLS availability or Hooks being active.
After explicit agreement, the held first Prompt is written to Outbox before
its local payload is removed. A restart reuses the original event ID; Sender
persists ACK before cleanup and retries transport failures with backoff.
A response lost after server acceptance can still cause a physical HTTP retry;
the receiving/analysis layer deduplicates by event_id.

```text
consent: pending -> allowed | denied
notice:  0 -> 1 (initial) -> 2 (one reminder maximum)
first:   held -> released | expired | discarded
```

The single hold file is outside global Pending/Outbox, so older runtimes
cannot drain it. Its redacted payload expires after seven days and is deleted
on the next runtime entry; the empty record prevents a later Prompt from
replacing the first. Other pre-consent Prompts are neither queued nor backfilled.
The runtime is shipped as telemetry.cjs; user machines do not need a build,
Python packages, MCP, or runtime node_modules for reporting.

---

## Transport

| Property | Value |
|----------|-------|
| Runtime | `skills/trtc/runtime/telemetry.cjs` |
| Queue | Codex: project-local private spool; other hosts: user-level durable `telemetry/outbox/` |
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

The default destination is the original Nanjing CLS topic
`a1310e66-a3f5-4572-a1c3-7a327a27496d` on
`https://ap-nanjing.cls.tencentcs.com`. Endpoint and topic environment overrides
remain supported. Queued events do not freeze a destination: the next eligible
send uses the active configuration while preserving their event IDs and consent.
Changing the topic does not change a host's network permissions.

### Codex sandbox delivery

New and upgraded Codex installations bind all commands to
`<project>/.trtc-skill-state/codex-runtime` (or the existing `.trtc-reporting`
directory). Installation transfers only that project's eligible Codex events,
preserves event IDs and ACKs, and reuses its device identity. Other IDE queues
remain in their original location. The V2 binding redirects cached old Hook
commands to the same spool; runtime commands never perform the migration.

`CODEX_SANDBOX_NETWORK_DISABLED=1` is an inherited network hint, not an
upload result. After explicit consent, foreground commands attempt ordinary
HTTPS within their existing deadline; host network policy still applies.
Permission/DNS-denied attempts retain the event and actual error without
adding backoff that would suppress a later permitted caller. Timeouts, TLS
and server failures retain normal backoff. Once the current event is ACKed,
spare foreground budget (at most 300 ms) can retry older consented Outbox
events, so delivery does not depend solely on a local Stop hook being run.
A permitted Stop sender remains a recovery path. A Stop payload need not contain `ide`:
the installed `--ide codex` flag defines its session hash. Interrupted Pending
turns are recovered in a bounded batch using their own attribution receipts.

Local `prompt/queued` is not upload confirmation; `prompt/acknowledged`
requires exact-event ACK evidence. Consent controls retain the frozen markers,
and no reply, silence or settings value can create consent. No sandbox policy
is broadened by this installation. The dedicated check is
`npm run test:codex-sandbox`; it uses an actual macOS sandbox and local HTTPS
receiver. This protocol check does not attest to GUI rendering.

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
reporting requires explicit agreement without an install-time question. Before the
installed foreground `prompt --input-stdin --require-input` path sends, the
Root dispatcher makes a bounded local route decision. A validated
`route_hint` (plus known `product`/`framework`) is persisted with the same
event and used immediately; only when no reliable route exists does the event
use `unknown`. Before agreement the path holds only the first Prompt locally. After agreement
it stages and performs a bounded send before the model answer. The final owner `invoke` (or the post-answer Host Stop fallback)
may enrich the same still-pending event, or retries it when the foreground send
was not acknowledged; it never creates a second event for an already
acknowledged Prompt.
Host Stop is a lifecycle fallback, not a router: it never derives `skillname`
or product from free-form Prompt text. It uses only a validated dispatcher route
hint already attached to the event; otherwise the event stays unattributed
(`unknown`) until the real owner invoke supplies the answer-layer metadata. For
Codex foreground calls, an available host-thread hint isolates the project/IDE
binding locally, but it is not treated as a per-turn exactly-once identity; a
host session or turn id remains authoritative when supplied. When any IDE lacks
a reliable session/turn identity (including multiple or stale local bindings),
the runtime uses a stable project+IDE anonymous fallback solely to keep the
Prompt deliverable. The fallback key is retained only in private
`__correlation_key` state, `userid` is omitted from the CLS payload, and no
Context from another live conversation is borrowed. This lowers session-level
analytics precision but does not block Prompt delivery.
All four IDEs share the Prompt input gate on Hook, foreground and legacy
Prompt sending paths before consent state, queues, recovery or SDK scans.
Known host `internal` / `is_internal` and internal provenance metadata are
filtered for Claude, Codex, Cursor and CodeBuddy. CodeBuddy's complete native
`<question_answer><questions><question_item>` envelope is normalized to its
selected answers only. Assistant questions and XML wrappers never become
Prompt text; malformed/empty native envelopes are skipped without consuming
a first-Prompt slot. Parsing is bounded and has no DTD, external-entity or I/O
support. Plain answers, surrounding user prose, code fences and explicit
`user_initiated: true` pasted examples remain reportable. A selected business
answer never implicitly creates privacy agreement.

Claude and Codex Hook and foreground Prompt paths also discard host-generated
internal tasks before staging, deferred sends, notice recovery, or SDKAppID
resolution. Host-supplied `internal`/`is_internal` and recognized
`host_source`/`event_source`/`host_kind` provenance take priority. Without that
metadata, Claude filters complete `<task-notification>` envelopes containing
task ID, status, and summary; Codex filters the background Overview template
and the app-generated “suggested next user message” request shown in the empty
composer. Codex template matching normalizes CRLF and leading presentation
whitespace, including a BOM, before the staging path trims the text. These
callbacks never count as the first user Prompt. Explicit
`user_initiated: true` metadata keeps user-authored text reportable even if it
matches one of these templates. Quoted notifications, pasted-content wrappers,
excerpts, and notifications accompanied by user prose remain reportable.
Natural-language controls such as
“关闭体验上报” and “turn off experience reporting” update the preference locally
and are never staged or uploaded.
`--prompt-reporting off` disables
locally-redacted prompts and workflow results. `--no-report` persistently disables
experience reporting, separately-consented runtime uploads, and anonymous install
statistics. Nested packages inherit the nearest saved parent-project preference.
`TRTC_PROMPT_REPORTING=off` disables experience reporting; `on` still requires consent;
`TRTC_REPORTING=on|off` is the diagnostic global override.

### Explicit consent and one reminder (V2)

Experience sending is OFF until a durable explicit agreement is present.
Installation / Hook activation statistics remain eligible under their separate
runtime settings. The initial Prompt is redacted and held locally. When Runtime
returns NOTICE_REQUIRED, the next user-visible assistant message renders the
exact fixed notice before another Skill/flow handoff, business question or
business tool/network work. Reading the fixed localized notice is the only
permitted intervening tool when the command returned only a marker. A short
business answer already ready may precede the fixed block in that same message;
otherwise emit ONLY the standalone notice as the final response and END THE TURN.
Wait for a real user reply: no more handoff, business tools/questions, or owner
invoke in that turn. After ALLOWED or DISABLED, resume the paused task without
reporting the control reply or replaying the original Prompt. Consent is optional;
no new notice after the two-presentation limit means business resumes with
experience reporting still OFF. Never
wait for plan approval, integration completion or the whole workflow. Collapsed
tool stdout is not a visible privacy question. Already-rendered notices are not
repeated in the final answer or reclaimed across a handoff.
The first unanswered business input gets at most one reminder at the same
first-visible-message boundary; an ambiguous privacy reply is consumed and
gets a returned reminder as the final response, then the turn ends.
A new business message returning a reminder has the same bounded-wait behavior.
After two presentations total, silence/ambiguity leaves reporting OFF and
ordinary business continues without further prompts. No control reply is
uploaded, including a reply with an invalid or missing receipt.

Notice delivery and consent live in the project-local
experience-consent-v2.json file. Hook, foreground, tool fallback and Stop cannot
each consume a presentation for the same logical user turn. Stop never claims
a notice. CodeBuddy's visible tool fallback shares the same turn, quota and end-of-turn
wait: when it has already rendered the notice, do not copy the notice again
or continue business work in that same turn.
Foreground delivery is claimed atomically; a failed local write cannot authorize
sending. There is no defaulted authorization state.

A control classification is supplied by the model only when the notice is
visible in the current conversation and the user is answering it. Natural
agreement ("可以", "没问题") is allow; clear refusal is deny; uncertainty is
ambiguous. Runtime requires the same project and matches reliable session IDs
when both exist. Without a reliable session ID the model verifies the
conversation context. The complete fixed notice, including its two labels,
is presentation replay, not a control response. Cursor cancels its synthetic
submission before model input.

The stdin envelope always includes text (verbatim), control_choice, cwd, ide.
Only a valid, fresh V2 notice can change preferences. Explicit classifications
with a missing/corrupt/expired/mismatched receipt are skipped, never staged.
V1 default-on/unanswered/defaulted states do not count as agreement. Existing
explicit V1 agreements remain usable. V1 refusals/global-off records are
preserved conservatively, since their global disable provenance cannot always
be distinguished; the upgrade never silently re-enables a channel.

A new allow persists continuation_choice=allowed, version=2 and a private
experience_consent_id. Queued experience events must carry that generation,
so an old default-on backlog cannot be released by later agreement. Allow
never overrides all_reporting_disabled or TRTC_REPORTING=off. Generic
preference/settings/env "on" never manufactures agreement.
A new deny persists continuation_choice=denied (version=2), disables only
experience reporting, deletes the held Prompt and purges non-runtime queues.
It does not set all_reporting_disabled or create a global deny tombstone.
Explicit preference --enabled off --scope all / --no-report disables both.

| Frozen stdout marker | Meaning |
|---|---|
| TRTC_REPORTING_NOTICE_REQUIRED_V1 | Render fixed notice (initial or sole reminder) |
| TRTC_REPORTING_ALLOWED_V1 | Explicit agreement durably persisted |
| TRTC_REPORTING_DISABLED_V1 | Experience refusal durably persisted |
| TRTC_REPORTING_ALLOW_RETRY_V1 / TRTC_REPORTING_DISABLE_RETRY_V1 | Choice write failed; never claim success |
| TRTC_REPORTING_CHOICE_RETRY_V1 | Control state unavailable |

All four IDEs retain foreground rendering at the first-visible-message boundary. Claude,
Cursor and Codex Stop remain silent; CodeBuddy's visible fallback shares the
project-local quota. The notice JSON generates the JS/MD projections.
No consent fields, local authorization IDs, receipt state, or new CLS fields
are added to the wire. SDKAppID business setup remains available before consent;
telemetry resolution/capture is gated until agreement.

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
| `install_status` | `"completed"` / `"partial"` / `"failed"` | Core Node install status; `partial` means an IDE Hook failed while the foreground fallback remains usable |
| `installed_ides` | Actual IDE array | JSON-stringified only at the CLS boundary |
| `hook_results` | Per-IDE static install result | JSON-stringified only at the CLS boundary; not activation proof |
| `os` | `"darwin"` / `"win32"` / `"linux"` | `os.platform()` |

### SDKAppID collection

When an integration flow receives an SDKAppID directly from the user, it calls
`reporting.py capture-sdkappid --input-stdin` only after the current flow has
successfully saved that value. The helper accepts one allowlisted JSON object
on stdin and creates a V2 `method="event"`, `text="sdkappid_collected"`
record with `sdkappid` at the top level. It includes only known product,
framework, owner skill, IDE, and collection source metadata. It never resolves
an SDKAppID from project files, dependencies, `.env`, session state, or caches,
and does not include SecretKey or prompt text.

Root's normal collection flow and domain fallbacks share this event. A domain
fallback emits it only when that fallback has newly received and saved the ID;
reusing the ID already captured by Root does not create another event. The
event is in the experience scope, so saved privacy preferences and the global
deny gate apply. The Runtime persists to Outbox before its bounded foreground
send. A non-2xx response keeps the same `event_id`; a later foreground call in
the same project and IDE retries it within the seven-day Outbox retention
window. Delivery remains best-effort and does not block integration.

This event records collection only. It does not determine whether an app is
new, whether SDK usage occurred, or whether an integration generated usage.

---

## Payload Schema

Compatibility callers pass one complete JSON object with `reporting.py send
--json`; the shim validates it and streams the normalized object to the local
Node Runtime over stdin. Do not split one logical event across multiple helper
calls or pass Prompt/answer content directly to `telemetry.cjs` argv flags.

### Fixed fields (same across all events)

| Key | Value | Notes |
|-----|-------|-------|
| `product` | `chat` / `call` / `live` / `conference` / `rtc-engine` / `tim-push` / `ai-service` / `oral-coach` / `realtime-interpreter` / `conversational-ai` / `unknown` | From structured session state or an explicit helper payload; the transport writes this value to CLS `type`. Values are not validated against this list (see below) — a new value must be added here and to `PRODUCT_BY_SKILL` together |
| `framework` | `vue3` / `react` / `android` / `ios` / `android+ios` / `flutter` / `web` / `unity` / `unknown` | See Framework mapping below; the transport writes this value to CLS `framework` |
| `version` | Installed package version for shared routed-Prompt reporting; Chat docs-query may use its Skill version | |
| `sdkappid` | SDKAppID when uniquely resolved; otherwise omitted | Existing Prompt attribution uses the bounded project resolver below. `sdkappid_collected` requires the value explicitly passed by the current flow. It is an application identifier, not the anonymous user ID |
| `sessionid` | `sess_{local hash}` when a reliable host session/turn id is available; `null` for anonymous fallback events | Reliable host IDs are hashed locally and mapped to CLS `userid`. Anonymous fallback events keep a private `__correlation_key` for local dedupe/queue recovery and omit `userid` rather than presenting a project bucket as a user session |
| `ide` | `claude` / `cursor` / `codebuddy` / `codex` / `unknown` | Actual host that fired the conversation Hook. The value is explicitly marked by the installed Hook and is never inferred by AI or by scanning installed IDE directories |
| `method` | `"prompt"`, `"event"`, or `"feedback"` | See Method enum below |
| `text` | The content to report | Format depends on `method` |

**All keys are lowercase** (`sessionid`, not `sessionId`).

### Conversation identity

The official npx installer wires each host Prompt event directly to the
self-contained `telemetry.cjs hook` entry point. The Hook performs no upload,
stays stdout/stderr-silent for ordinary Prompts, binds local state to the current
IDE conversation, and stages the locally-redacted Prompt for post-route attribution.
Cursor renders the notice as a separate fixed block in the next visible
FINAL assistant response, then ends the turn to await the reply; an already-ready short
answer may precede it in that message. Its Stop hook never emits `followup_message` or consumes foreground
presentation attempts. An unanswered real user turn can claim the one
remaining reminder. The Python command returns the localized canonical text
alongside its marker, claiming at most two presentation attempts on the same
receipt. The notice never enters the composer or creates a synthetic user turn.
Legacy complete fixed notice replay remains a presentation exception: before any
reporting state handling, `beforeSubmitPrompt` prints
`{"continue":false,"user_message":"<fixed localized notice>"}` to cancel the
synthetic submission. Merely omitting a telemetry event does not stop Cursor
from sending that message to the model. The full projection is matched with
presentation whitespace ignored; an option label or additional user reply is
not a replay. No preference or notice transition occurs for the full notice,
even if a model incorrectly attaches `control_choice:"ambiguous"`.
Older installations and plugin templates may still enter through the Python
standard-library `reporting.py bind-session` compatibility shim until they are
reinstalled; both paths share the same local receipt and event-id dedupe:

- Claude, Codex, and CodeBuddy use hook input `session_id`.
- Cursor uses hook input `conversation_id`.
- npx-installed Hooks carry a fixed `--ide` marker and execute the installed
  Node Runtime directly. Plugin-mode/legacy Claude and CodeBuddy use
  their host-provided plugin-root environment variable as the deterministic
  fallback.
- Claude, Cursor and Codex keep Stop silent and render the fixed notice
  as the final response and ends the turn before business tools/questions. Claude and Cursor claim at most two
  foreground presentations for the same pending receipt; Stop cannot consume
  that budget or start a model continuation to display the notice.
  Cursor's
  `beforeSubmitPrompt` cancellation remains only a guard for legacy replays.
  The pending choice remains available for the real user. CodeBuddy's foreground
  dispatcher is the first-use renderer: its next visible assistant message emits
  the exact generated notice from `continuation-notice.md` as a separate final block
  and waits for the user instead of continuing business in that turn,
  regardless of whether a post-answer channel is available. CodeBuddy
  Stop (and its narrowly matched `PostToolUse` fallback for
  `ask_followup_question`/`AskUserQuestion`) is recovery/flush only; it must
  not be the first renderer and no `stopHookFeedback` or hidden
  `systemMessage` is required for visibility.
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
The Hook never flushes it. A later foreground `prompt`/`invoke`/Sender uploads it, so
activation can be delayed when the user never enters a routed Skill flow.

The shared Runtime checks `product` and `framework` only for format before
transport: a value that fails `SAFE_NAME_RE` (`^[A-Za-z0-9._+-]{1,128}$`) is
dropped and the field falls back to the owner's `PRODUCT_BY_SKILL` entry or
`"unknown"`. There is **no allow-list** — any well-formed value, including one
not listed in the table above, reaches CLS unchanged. Keep the table above and
`PRODUCT_BY_SKILL` in `telemetry.js` in sync by hand, and check CLS dashboards
or alerts that filter on a fixed list of `type` values when adding one.
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
| `"prompt"` | User's original message or selected option, durably staged on entry and sent immediately by the required foreground path; the later Dispatcher/owner step only adds attribution or retries the same event | Plain text after local sensitive-data redaction, plus `skillname` only when emitted by `reporting.py invoke`. Before showing a clarification / confirmation / option question, record that exact assistant question with `reporting.py context --question ...`; then still render the fixed choices with `AskUserQuestion`. For the user's selected option / confirmation, report `引导问题：...\n用户选择：...`, e.g. `引导问题：你选择的是通用会议场景（适用于小班课、多人视频等场景）。确认以此为基础集成吗？\n用户选择：是的，继续`. Do not summarize or translate user-provided text. The helper caps the redacted UTF-8 payload at 32 KiB, retaining the beginning and end with a `[TRUNCATED FOR REPORTING]` marker. |
| `"event"` | Skill behavior/milestone events; SDKAppID capture uses the dedicated helper | Usually a JSON string: `{"type":"<event-type>","data":{...}}`; `sdkappid_collected` is the fixed event text |
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
| `sdkappid_collected` | Current integration flow successfully saves an SDKAppID explicitly provided by the user | Top-level `sdkappid`; optional known `product`, `framework`, `skillname`, and `collection_source` |

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

Make a bounded local route decision before staging the current user Prompt. The
decision may attach a validated `route_hint` and known `product`/`framework`;
it must not read the owner Skill, call the network, or scan SDKAppID. In the
installed foreground path, `--require-input` stages and performs the bounded
send with that snapshot before the normal answer:

```bash
# Pseudocode: JSON-serialize the object and pipe it to stdin. Route fields are
# optional; omit them when the local decision is not reliable.
python3 "<current trtc skill root>/tools/reporting.py" prompt --input-stdin --require-input
# {"text": prompt, "cwd": project_root, "ide": ide,
#  "route_hint": "<validated owner>", "product": "<known product>",
#  "framework": "<known platform>"}

python3 "<current trtc skill root>/tools/reporting.py" invoke \
  --skillname "<routed skill name>" \
  --product "<classified product or unknown>" \
  --framework "<classified platform or unknown>"
```

Do not interpolate raw prompt text into shell JSON or command arguments. With
`--require-input`, the first command emits no ordinary stdout but performs a
bounded local capture (and, only after explicit consent, a send attempt); its stdout is reserved
for the frozen C20 control markers. An empty or malformed foreground pipe fails
non-zero, so the dispatcher must retry with the same JSON instead of treating a
missing Prompt as success. Without `--require-input`, the compatibility path
only stages locally. The second command emits or retries the same staged Prompt
for `(sessionid, reporting_turn_id, skillname)`, with the routed Skill in
top-level `skillname` when attribution is available. It may enrich an
unacknowledged event, but an already acknowledged event is idempotent and is
never sent as a duplicate. The local invocation identifier remains private
implementation state and is never written to CLS.

The foreground `prompt --input-stdin --require-input` and `invoke` stdout marker
`TRTC_REPORTING_NOTICE_REQUIRED_V1` must be consumed in the next visible
assistant message, before another handoff, business question or business tool.
The foreground integration MUST render the same generated notice immediately
and accept a privacy reply on the next applicable prompt entry; it never waits
for the entire integration or repeats an already-rendered notice. A returned
notice ends the current turn; only a later real user reply resumes the task
according to the bounded reminder and allow/deny rules. The two fixed continuation labels are sent through the same stdin protocol. They are control messages only
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

### Release contract checks

The reporting model is opt-in: explicit agreement is required before any
experience upload. The install phase does not add new install-time questions.
An unresolved sdkappid is omitted entirely; zero is never a sentinel. Notice
text, tombstones and control markers never enter CLS wire.

Consented events use `telemetry/pending/` then `telemetry/outbox/` with a bounded
foreground flush. Only CLS 2xx is treated as delivery; the ACK is persisted
before cleanup. Declining before consent discards the held first Prompt.

The V2 choices are **同意上报** and **关闭上报** (English: **Share data** and **Don’t share**). Earlier V2 labels remain compatible for replies to a valid active notice.
