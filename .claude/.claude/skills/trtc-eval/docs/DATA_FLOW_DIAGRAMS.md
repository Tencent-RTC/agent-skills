# TRTC-Eval Data Flow & Architecture Diagrams

---

## 1. ORCHESTRATION PIPELINE (End-to-End)

```
User Request
    ↓
┌─────────────────────────────────────────────────────────────┐
│ main Agent (Claude/CodeBuddy)                               │
├─────────────────────────────────────────────────────────────┤
│ selfcheck.py                  [PRE-RUN validation]          │
│ ├─ CLI availability check                                   │
│ ├─ env.TRTC_TEST_* availability                             │
│ ├─ cases.json AST scan                                      │
│ └─ write selfcheck.json                                     │
└────────────┬─────────────────────────────────────────────────┘
             │
             ↓
┌─────────────────────────────────────────────────────────────┐
│ case_runner_orchestrator.py   [MASTER ORCHESTRATOR]         │
├─────────────────────────────────────────────────────────────┤
│ Input: --case-id TC-CONF-WEB-001 --run-dir .../eval-runs/v7│
│ Output: summary.json per case                               │
│                                                              │
│ [Generate EVAL_RUN_NONCE once]                             │
│ [Create trace.jsonl (only writer)]                         │
│                                                              │
│ ╔═══════════════════════════════════════════════════════╗  │
│ ║ STEP 1: run_ai.py                                      ║  │
│ ║   Input: Case + TRTC creds from config.json            ║  │
│ ║   Output: ai_raw_output.md + ai_extracted_code/        ║  │
│ ║   Action: Call Claude API with skill context           ║  │
│ ║   trace.jsonl += {step: run_ai, exit_code, duration}   ║  │
│ ╚═══════════════════════════════════════════════════════╝  │
│                          ↓                                   │
│ ╔═══════════════════════════════════════════════════════╗  │
│ ║ STEP 2: evaluator.py                                   ║  │
│ ║   Input: ai_extracted_code/                            ║  │
│ ║   Output: static_result.json                           ║  │
│ ║   Action: grep-based must_include/must_not_include     ║  │
│ ║   Scores: must_include_hit, must_not_include_clean    ║  │
│ ║   trace.jsonl += {step: evaluator, exit_code}          ║  │
│ ╚═══════════════════════════════════════════════════════╝  │
│                          ↓                                   │
│ ╔═══════════════════════════════════════════════════════╗  │
│ ║ STEP 3: demo_runner.py --phase=build                  ║  │
│ ║   Input: template + ai_extracted_code + case creds    ║  │
│ ║   Output: workspace/ (ready to run) + compile.log     ║  │
│ ║   Action: npm ci, code injection, build               ║  │
│ ║   trace.jsonl += {step: demo_build, exit_code}        ║  │
│ ║   [If compile fails → demo_run/demo_stop skipped]     ║  │
│ ╚═══════════════════════════════════════════════════════╝  │
│                          ↓                                   │
│ ╔═══════════════════════════════════════════════════════╗  │
│ ║ STEP 4: log_streamer.py --mode=start                  ║  │
│ ║   Input: case.platform, device selection              ║  │
│ ║   Output: runtime.log.pid, device booted              ║  │
│ ║   Action: Device setup, log stream process spawn      ║  │
│ ║   trace.jsonl += {step: log_stream_start, exit_code}  ║  │
│ ╚═══════════════════════════════════════════════════════╝  │
│                          ↓                                   │
│ ╔═══════════════════════════════════════════════════════╗  │
│ ║ STEP 5: demo_runner.py --phase=run                    ║  │
│ ║   Input: workspace (from step 3) + device (step 4)    ║  │
│ ║   Output: (runs app, logs piped to runtime.log)       ║  │
│ ║   Action: Launch app via platform adapter            ║  │
│ ║   trace.jsonl += {step: demo_run, exit_code}          ║  │
│ ║   [Runs for ~60s or until SIGTERM]                    ║  │
│ ╚═══════════════════════════════════════════════════════╝  │
│                          ↓                                   │
│ ╔═══════════════════════════════════════════════════════╗  │
│ ║ STEP 6: log_streamer.py --mode=stop                   ║  │
│ ║   Input: runtime.log.pid (from step 4)                ║  │
│ ║   Output: (closes log stream, runtime.log finalized)  ║  │
│ ║   Action: SIGTERM the log process                     ║  │
│ ║   trace.jsonl += {step: log_stream_stop, exit_code}   ║  │
│ ╚═══════════════════════════════════════════════════════╝  │
│                          ↓                                   │
│ ╔═══════════════════════════════════════════════════════╗  │
│ ║ STEP 7: runtime_monitor.py                            ║  │
│ ║   Input: runtime.log + case definition                ║  │
│ ║   Output: dynamic_result.json                         ║  │
│ ║   Action: Parse log, extract events, health penalties ║  │
│ ║   Scores: events_hit_ratio, health_penalty, score    ║  │
│ ║   trace.jsonl += {step: runtime_monitor, exit_code}   ║  │
│ ╚═══════════════════════════════════════════════════════╝  │
│                                                              │
│ [Build CaseSummary from static_result + dynamic_result]    │
│ [Compute final_score and pass/fail]                        │
│ [Write summary.json]                                       │
│                                                              │
└──────────────────────┬───────────────────────────────────────┘
                       ↓
          Write: .claude/eval-runs/{ts}/
          cases/{case_id}/summary.json
          cases/{case_id}/trace.jsonl
          cases/{case_id}/dynamic_result.json
          cases/{case_id}/static_result.json
                       ↓
                       ↓ [Read by main Agent]
┌─────────────────────────────────────────────────────────────┐
│ report.py             [POST-RUN analysis]                   │
├─────────────────────────────────────────────────────────────┤
│ Input: All summary.json from the run                        │
│ Output: scoreboard.csv, report.md                           │
│ Action: Aggregate scores, compute diffs from previous runs  │
└─────────────────────────────────────────────────────────────┘
```

---

## 2. SCORING COMPUTATION FLOW

```
┌──────────────────────────────────────────────────────────────────────┐
│                     FINAL SCORE COMPUTATION                          │
│                 (case_runner_orchestrator.py:155-160)                │
└──────────────────────────────────────────────────────────────────────┘

                    ┌─────────────────────────┐
                    │  Static Result (100%)   │
                    │  from evaluator.py      │
                    └────────────┬────────────┘
                                 │
                    ┌────────────┴────────────┐
                    │  must_include_hit: ?    │
                    │  must_not_clean: ?      │
                    │  score: ?               │
                    └────────────┬────────────┘
                                 │
                    ┌────────────▼────────────┐
                    │  static_score = ?       │
                    │  (formula below)        │
                    └────────────┬────────────┘
                                 │
        ┌────────────────────────┼─────────────────────────┐
        │                        │                         │
        │                        ↓                         │
        │      ┌──────────────────────────────┐            │
        │      │ Dynamic Result (events)      │            │
        │      │ from runtime_monitor.py      │            │
        │      └───────────┬──────────────────┘            │
        │                  │                               │
        │  ┌───────────────┼────────────────┐              │
        │  │               │                │              │
        │  ↓               ↓                ↓              │
        │ ┌──────────┐  ┌──────────────┐ ┌──────────────┐ │
        │ │ events   │  │ health       │ │ compile_ok   │ │
        │ │ captured │  │ penalties    │ │              │ │
        │ │ vs       │  │ page_error   │ │ true/false   │ │
        │ │ expected │  │ unhandled_   │ │              │ │
        │ │          │  │ rejection    │ │              │ │
        │ └────┬─────┘  └──────┬───────┘ └──────┬───────┘ │
        │      │               │                │         │
        │      ↓               ↓                ↓         │
        │   ╔═════════════════════════════════════╗       │
        │   ║ events_hit_ratio = captured/expected║       │
        │   ║ (or 1.0 if expected==0)             ║       │
        │   ╚═════════┬═══════════════════════════╝       │
        │             │                                   │
        │             ↓                                   │
        │   ╔═════════════════════════════════════╗       │
        │   ║ IF compile_ok:                      ║       │
        │   ║   base = ratio×0.7 + 0.3            ║       │
        │   ║   IF ratio==0: base -= 0.15         ║       │
        │   ║ ELSE:                               ║       │
        │   ║   base = 0.0                        ║       │
        │   ╚═════════┬═══════════════════════════╝       │
        │             │                                   │
        │             ↓                                   │
        │   ╔═════════════════════════════════════╗       │
        │   ║ health_penalty = min(0.5,           ║       │
        │   ║   0.15×page_errors +                ║       │
        │   ║   0.15×unhandled_rejections)        ║       │
        │   ╚═════════┬═══════════════════════════╝       │
        │             │                                   │
        │             ↓                                   │
        │   ┌─────────────────────────────────────┐       │
        │   │ dynamic_score =                     │       │
        │   │   max(0, base - health_penalty)     │       │
        │   └─────────┬───────────────────────────┘       │
        │             │                                   │
        └─────────────┼───────────────────────────────────┘
                      │
        ┌─────────────┴──────────────────┐
        │                                │
        ↓                                ↓
 ┌─────────────┐            ┌────────────────────┐
 │static_score │            │ dynamic_score      │
 │   ×0.4      │            │    ×0.6            │
 └──────┬──────┘            └────────┬───────────┘
        │                           │
        │        ┌──────────────────┘
        │        │
        └───┬────┴────────────────────────┐
            │                             │
            ↓                             │
        ╔════════════════════════════╗    │
        ║ final_score =              ║    │
        ║   (static × 0.4) +         ║    │
        ║   (dynamic × 0.6)          ║    │
        ╚═════════┬══════════════════╝    │
                  │                       │
                  │        static_result only (no dynamic):
                  │        final = static × 0.4
                  │        dynamic = 0.0
                  │        (This is the 0.4 floor)
                  │
                  ↓
        ┌──────────────────────────┐
        │ Check pass/fail criteria:│
        │ ├─ static >= 0.7?        │
        │ ├─ dynamic >= 0.7?       │
        │ ├─ must_compile?         │
        │ └─ final >= threshold?   │
        │                          │
        │ failure_reason set if    │
        │ ANY criterion fails      │
        └──────────────┬───────────┘
                       │
                       ↓
                  summary.json
            (test_id, final_score,
             passed, failure_reason)
```

---

## 3. LOG CAPTURE ARCHITECTURE

```
┌─────────────────────────────────────────────────────────────────┐
│ PUPPETEER LOG BRIDGE PROBES                                     │
│ (log-bridge.mjs: browser-side)                                  │
└─────────────────────────────────────────────────────────────────┘

                    Headless Chromium
                    ┌─────────────────────────────┐
                    │ Vite dev server (port 5173) │
                    │ App running: Vue3/React/etc │
                    └────────────┬────────────────┘
                                 │
                 ┌───────────────┼───────────────┐
                 │               │               │
                 ↓               ↓               ↓
        ┌──────────────┐  ┌────────────┐  ┌──────────────┐
        │ window.error │  │ unhandled  │  │ console.warn │
        │ listener     │  │ rejection  │  │ override     │
        │ (sync)       │  │ listener   │  │ (Vue[warn])  │
        │              │  │ (Promise)  │  │              │
        └──────┬───────┘  └────┬───────┘  └──────┬───────┘
               │               │                │
               │ Emits:        │ Emits:        │ Emits:
               │ JSON with     │ JSON with     │ JSON with
               │ __probe:      │ __probe:      │ __probe:
               │ "page_error"  │ "unhandled_   │ "vue_warn"
               │               │  rejection"   │
               │               │               │
               │               └───────┬───────┘
               │                       │
               └───────────────┬───────┘
                               │
                   ┌───────────▼──────────┐
                   │ page.on('console',)  │
                   │ Puppeteer listener   │
                   │ (host-side)          │
                   └───────────┬──────────┘
                               │
                   ┌───────────▼──────────────────┐
                   │ Emit JSON line to stdout:    │
                   │ {                            │
                   │   "ts": "2026-05-18...",     │
                   │   "level": "error|warn|log", │
                   │   "text": "...",             │
                   │   "event": "onXxx", (opt)    │
                   │   "__probe": "...", (opt)    │
                   │ }                            │
                   └───────────┬──────────────────┘
                               │
                   ┌───────────▼──────────────────┐
                   │ log_streamer.py              │
                   │ (redirects stdout to file)   │
                   │ File: runtime.log            │
                   └───────────┬──────────────────┘
                               │
                   ┌───────────▼──────────────────┐
                   │ runtime_monitor.py           │
                   │ (parses JSON lines)          │
                   │ Extracts:                    │
                   │ • events via token match     │
                   │ • probes via __probe field   │
                   │ Computes:                    │
                   │ • events_hit_ratio           │
                   │ • health_penalty             │
                   │ • dynamic_score              │
                   │                              │
                   │ Output: dynamic_result.json  │
                   └──────────────────────────────┘
```

---

## 4. STATIC SCORE COMPUTATION

```
┌────────────────────────────────────────────────────────┐
│        STATIC SCORE (evaluator.py)                     │
├────────────────────────────────────────────────────────┤
│ Input: ai_extracted_code/ directory (AI-generated)     │
└────────────────────────────────────────────────────────┘

        ┌──────────────────────────────────────┐
        │ Case constraints (from cases.json)   │
        ├──────────────────────────────────────┤
        │ must_include: [                      │
        │   "useDeviceState",                  │
        │   "openLocalCamera",                 │
        │   ...                                │
        │ ]  (e.g., 8 items)                   │
        │                                      │
        │ must_not_include: [                  │
        │   "TRTCCloud.sharedInstance",        │
        │   "AVCaptureSession",                │
        │   ...                                │
        │ ]  (e.g., 5 items)                   │
        └────────┬───────────────────────────┬─┘
                 │                           │
        ┌────────▼──────────┐      ┌─────────▼──────────┐
        │ MUST_INCLUDE CHECK │      │ MUST_NOT CHECK     │
        │ (via grep-fixed)   │      │ (via grep-fixed)   │
        │                    │      │                    │
        │ For each needle:   │      │ For each needle:   │
        │  grep in all files │      │  grep in all files │
        │  of code_dir       │      │  of code_dir       │
        │                    │      │                    │
        │ Collate:           │      │ Collate:           │
        │ hits = [matched]   │      │ dirty = [found]    │
        │ misses = [not]     │      │                    │
        └────────┬──────────┘      └─────────┬──────────┘
                 │                           │
        ┌────────▼────────────┐    ┌─────────▼──────────┐
        │ must_include_hit =  │    │ must_not_clean =   │
        │   len(hits) /       │    │   (total - dirty)/ │
        │   len(total)        │    │   total            │
        │                     │    │                    │
        │ Example: 7/8 = 0.875│    │ Example: 4/5 = 0.8 │
        └────────┬────────────┘    └─────────┬──────────┘
                 │                           │
                 └───────────────┬───────────┘
                                 │
                    ┌────────────▼───────────┐
                    │ static_score =         │
                    │  (hit × 0.6) +         │
                    │  (clean × 0.4)         │
                    │  = 0.875×0.6 +         │
                    │    0.8×0.4             │
                    │  = 0.525 + 0.32        │
                    │  = 0.845               │
                    └────────────────────────┘

        Output: static_result.json
        {
          "must_include_hit": 0.875,
          "must_not_include_clean": 0.8,
          "hits": [...],
          "misses": [...],
          "dirty": [...],
          "score": 0.845
        }
```

---

## 5. DECISION TREE: Pass vs Fail

```
                         ┌──────────────────┐
                         │ Summary created? │
                         │ (static result   │
                         │ exists?)         │
                         └────┬──────┬──────┘
                              │      │
                         Yes  │      │  No
                         ┌────▼─┐ ┌─▼────┐
                         │Pass? │ │FAIL  │
                         └─┬────┘ │ static│
                           │      │_result│
                           │        │_miss │
                           │      └──────┘
                           │
        ┌──────────────────┼──────────────────┐
        │                  │                  │
        ↓                  ↓                  ↓
    ┌────────┐      ┌────────────┐    ┌─────────────────┐
    │Check   │      │Check       │    │Check            │
    │static_ │      │dynamic_    │    │must_compile?    │
    │score   │      │score       │    │                 │
    │vs min? │      │vs min?     │    │ (if true)       │
    └────┬───┘      └────┬───────┘    └────┬────────────┘
         │               │                 │
         │  FAIL if      │  FAIL if        │  FAIL if
         │  < 0.7        │  < 0.7          │  compile_ok=false
         │               │                 │
         └───┬───────────┴─────────────────┴─┐
             │                               │
             │ All checks pass?              │
             │                               │
         Yes │                               │ No
         ┌───▼───────┐               ┌───────▼────┐
         │ PASSED=true │               │PASSED=false│
         │             │               │failure_    │
         │failure_     │               │reason=...  │
         │reason=null  │               │(first      │
         │             │               │ breach)    │
         └─────────────┘               └────────────┘

Possible failure_reasons:
├─ "no_static_result"
├─ "static_score_below_threshold"
├─ "dynamic_score_below_threshold"
└─ "compile_fail"

Note: Can have multiple failures (first one recorded)
but pass=False is set for all
```

---

## 6. DATA SCHEMA RELATIONSHIPS

```
┌─────────────────────────────────────────────────────────────┐
│                    cases.json (single source)               │
├─────────────────────────────────────────────────────────────┤
│ [ { test_id: "TC-CONF-WEB-001",                             │
│     ability: "conference/login-auth",                       │
│     constraints: {                                          │
│       must_include: [...],                                  │
│       must_not_include: [...]                               │
│     },                                                      │
│     expected_events: [                                      │
│       "[account_manager.cc:46] |Login|login",              │
│       "[account_manager.cc:77] onLoginSuccess"             │
│     ],                                                      │
│     acceptance: {                                           │
│       static_score_min: 0.7,                                │
│       dynamic_score_min: 0.7,                               │
│       must_compile: true                                    │
│     },                                                      │
│     weights: {                                              │
│       w_must_include: 0.6,                                  │
│       w_must_not: 0.4,                                      │
│       w_events: 0.7,                                        │
│       w_compile_bonus: 0.3,                                 │
│       w_static_in_final: 0.4,                               │
│       w_dynamic_in_final: 0.6                               │
│     }                                                       │
│   }, ... ]                                                  │
└─────────────────────────────────────────────────────────────┘
         │
         │ [Passed to all subscripts]
         │
    ┌────┴──────────────────────────────────────────────────┐
    │                                                        │
    ↓                                                        ↓
┌─────────────────────────┐  ┌──────────────────────────────┐
│ static_result.json      │  │ dynamic_result.json          │
│ (from evaluator.py)     │  │ (from runtime_monitor.py)    │
├─────────────────────────┤  ├──────────────────────────────┤
│ test_id                 │  │ test_id                      │
│ must_include_hit: float │  │ compile_ok: bool             │
│ must_not_clean: float   │  │ events_hit_ratio: float      │
│ hits: [str]             │  │ events_captured: [str]       │
│ misses: [str]           │  │ events_missing: [str]        │
│ dirty: [str]            │  │ nonce_seen: bool             │
│ score: float [0-1]      │  │ score: float [0-1]           │
│                         │  │ page_errors: int             │
│                         │  │ unhandled_rejections: int    │
│                         │  │ vue_warnings: int            │
│                         │  │ request_failures: int        │
│                         │  │ health_penalty: float        │
└────────┬────────────────┘  └──────────┬───────────────────┘
         │                             │
         │ [Both fed to orchestrator]  │
         │                             │
         └────────────┬────────────────┘
                      │
                      ↓
         ┌────────────────────────────┐
         │   CaseSummary              │
         │   (from orchestrator.py)   │
         ├────────────────────────────┤
         │ test_id: str               │
         │ static_result: {...}       │
         │ dynamic_result: {...}|null │
         │ final_score: float         │
         │ passed: bool               │
         │ failure_reason: str|null   │
         │ artifacts_dir: str         │
         │ duration_sec: float        │
         └────────────────────────────┘
                      │
                      ↓
         ┌────────────────────────────┐
         │   summary.json             │
         │   (final output per case)  │
         └────────────────────────────┘
                      │
                      ↓
         ┌────────────────────────────────────┐
         │ Main Agent reads summary.json,     │
         │ aggregates across all cases,       │
         │ calls report.py for scoreboard.csv │
         └────────────────────────────────────┘
```

---

## 7. WEIGHT SENSITIVITY ANALYSIS

```
SCENARIO: Perfect static (1.0), varying dynamic

       Dynamic | Health | Final Score | Pass?
        Events | Penalty | (0.4 + 0.6×D)
       --------|---------|------------|-------
        1.0    |  0.0    |  0.4 + 0.6 = 1.0  | ✓
        0.8    |  0.1    |  0.4 + 0.42 = 0.82 | ✓
        0.5    |  0.0    |  0.4 + 0.3 = 0.7  | ✓ (threshold)
        0.5    |  0.5    |  0.4 + 0.0 = 0.4  | ✗
        0.0    |  0.0    |  0.4 + 0.0 = 0.4  | ✗ (compile_fail)
       --------|---------|------------|-------

NOTE: W_events=0.7, W_compile_bonus=0.3, then adjusted if no hits.

SCENARIO: Perfect dynamic (1.0), varying static

       Static  | Final Score | Pass?
      --------|------------|-------
        1.0    |  0.4 + 0.6 = 1.0  | ✓
        0.8    |  0.32 + 0.6 = 0.92 | ✓
        0.7    |  0.28 + 0.6 = 0.88 | ✓
        0.5    |  0.2 + 0.6 = 0.8  | ✓
        0.3    |  0.12 + 0.6 = 0.72 | ✓
        0.2    |  0.08 + 0.6 = 0.68 | ✗ (static min=0.7)
       --------|------------|-------

OBSERVATION: Dynamic can't rescue bad static (both thresholds apply).
             Static can't rescue bad dynamic if must_compile=true.
```

---

## CONCLUSION

The data flow follows a strict **write-once** principle:
- Each script writes exactly one output file
- Orchestrator is the **only** writer of trace.jsonl (audit trail)
- Static and dynamic scores are computed independently, then merged
- Final decision is deterministic: no randomness, fully reproducible

This architecture ensures **auditability**: every number can be traced back through the source data.
