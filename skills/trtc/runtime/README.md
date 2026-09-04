# TRTC Skill Runtime

Two independent modules live in this directory:

| Module | Purpose | Entry file(s) |
|---|---|---|
| **A. Runtime-error collection** | When a user accepts Step 4.5 verification, capture browser console / platform logs, filter runtime errors, and write local diagnostic files. This module never uploads directly. | `telemetry_collector.py`, `telemetry-bridge.mjs`, `lib/platforms.py` |
| **B. V2 Telemetry (this file group)** | Prompt Hook / install / sub-Skill invocation reporting. Self-contained Node runtime that writes to local Outbox and flushes to CLS. | `telemetry.js` (entry), `identity.js`, `outbox.js`, `state.js`, `sender.js`, `redact.js`, `schema.js`, `normalize-hook.js`, `adapters/*.js`, `telemetry.cjs` (esbuild bundle) |

The two modules are orthogonal — they capture different things at different times and share only this directory location.

## V2 Telemetry (Module B)

Design spec: `reporting-plan/reporting-optimization-plan-v2-hooks.md` (V2.3).

Execution tracking: `reporting-plan/rollout/2026-08-05-reporting-v2-p0-execution.md`.

The architecture and operating contracts are documented in `REPORTING.md` and
`RUNTIME.md`.

### Module map

```
telemetry.js       CLI entry: hook / invoke / install / event / preference / send
identity.js        useragent generation, cross-platform atomic create, identity_scope fallback
outbox.js          atomic pending → outbox → rejected transitions, 7-day gc
state.js           promote(event_id, evidence) — hook-generated event_id carries end-to-end
sender.js          direct HTTPS POST to CLS (Node built-in https), retry with jitter
redact.js          Node-owned local redaction: 14 rules + 32KB truncation, fixture/golden gated
schema.js          event enums + CLS field mapping boundary (version→verison etc.)
preference.js      project-scoped opt-in/out, Python-state compatibility, control prompt detection
project-state.js   selects `.trtc-skill-state` for new Node V2 projects and preserves `.trtc-reporting` for existing installs
normalize-hook.js  shared stdin JSON parsing for hook adapters
adapters/          per-IDE stdin JSON adapters
```

### Runtime constraints (V2.3 §24.30)

- Hook path never issues HTTPS, DNS, or spawns child processes.
- Hook captures only redacted prompt text plus anonymous/session attribution; raw host session IDs and project paths never enter the queue.
- `invoke` promotes only a same-project pending event and preserves the Hook-created `event_id` through CLS delivery.
- SDKAppID discovery runs only after the foreground `invoke`/legacy Prompt preference gate. It follows the bounded resolver SOP: fixed basenames for literal/server helpers and frozen source extensions for exact UIKit/login call sites. Hook never scans the project, and only the resolved value (never a source path) enters telemetry.
- Opt-out control prompts are never reported. The preference is effective at the Sender boundary immediately; queue purge runs outside the latency-sensitive Hook.
- Bounded foreground flush attempts run from installer, Dispatcher `invoke`,
  explicit `event --flush`, and compatibility `send` commands. Hook execution
  remains disk-only and never starts a Sender.
- Field mapping rules (e.g. `version→verison`) live only in `schema.js` (`toCLSContents`). `sender.js` is the sole caller at the network boundary; it re-sanitizes legacy queued `text`/`answer` on a send-only copy before mapping — no other file re-maps or spells the wire-side names.
- All V2 events carry `schema_version: 2` and `client_generation: "v2"` in the CLS payload.

### Build

```
# From repo root
npm run build:telemetry          # esbuild source → runtime/telemetry.cjs
npm run check:telemetry-bundle   # verify the committed bundle is current
NODE16_BIN=/path/to/node16 npm run test:reporting-release
```

`telemetry.cjs` is the production entry point invoked by hooks and by the Python shim (`tools/reporting.py`). It is committed and included in the npm tarball so user machines do not need esbuild, `npm install`, Python, PyYAML, or MCP to execute the V2 runtime. `prepublishOnly` runs the full release gate; it fails rather than skipping when a real Node 16 binary is unavailable.

## Runtime-error collection (Module A)

See `RUNTIME.md` for the consent and collection flow. Module A only creates
local diagnostic files. After explicit consent, Module B may turn the bounded,
filtered result into a durable reporting event; collection itself never sends
to CLS.
