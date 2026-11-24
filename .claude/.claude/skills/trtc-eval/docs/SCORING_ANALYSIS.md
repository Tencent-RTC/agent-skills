# TRTC-Eval Scoring System & Runtime Monitoring — Comprehensive Analysis

**Date**: 2026-05-17
**Scope**: Understanding the scoring formulas, dynamic health penalties, and runtime data capture mechanisms

---

## EXECUTIVE SUMMARY

The trtc-eval system implements a **two-stage scoring model** combining static code analysis and dynamic runtime observation:

1. **Static Score** (evaluator.py): 40% of final score
   - Checks: code must_include / must_not_include constraints via text grep
   - Formula: `w_must_include * (hits/total) + w_must_not * (non_violations/total)`

2. **Dynamic Score** (runtime_monitor.py): 60% of final score
   - Events matching: semantic token matching on console.log output
   - Health penalty: penalizes page_error and unhandled_rejection probes
   - **Key issue**: When compile fails, dynamic_result is null, but final_score still computes as `0.4` (40% of static alone)

3. **Final Score**: `static_score * 0.4 + dynamic_score * 0.6`

---

## 1. DYNAMIC SCORING FORMULA (Web Platform)

### 1.1 Events Hit Ratio Calculation

**File**: `runtime_monitor.py:213-215`

```python
total_expected = len(case.expected_events)
events_hit_ratio = (
    len(events_captured) / total_expected if total_expected > 0 else 1.0
)
```

**The 0/0 = 1.0 Issue**:
- When `total_expected == 0` (no expected_events defined in case), ratio defaults to `1.0`
- This is intentional: cases with no expected_events get "perfect" event ratio (bypasses event matching entirely)
- **However**: This creates a loophole: a case with `expected_events=[]` scores `1.0` on events even if nothing happens at runtime

**Semantic Token Matching** (puppeteer_parser.py:131-174):
- Expected events use **native C++ format**: `[file.cc:N] |EventName|action`
- Converted to identifier tokens via `native_event_to_web_tokens()`:
  - Strip `[file.cc:N]` prefix
  - Split on whitespace/pipes
  - Extract `key:value` → take value side
  - Keep tokens ≥3 chars matching `[A-Za-z_]\w*`
  
Example: `[account_manager.cc:46] |Login|login` → tokens `{"Login", "login"}`

A line matches if:
- ✅ Contains ALL tokens
- ✅ NOT tagged with `"__probe"` (health probes excluded)
- ✅ NOT tagged with `"level":"error"`

### 1.2 Health Penalty Calculation

**File**: `runtime_monitor.py:121-123`

```python
def _compute_health_penalty(counts: dict[str, int]) -> float:
    raw = sum(counts[k] * _HEALTH_WEIGHTS[k] for k in counts)
    return min(_HEALTH_PENALTY_CAP, raw)
```

**Weight Table** (line 58-63):
```python
_HEALTH_WEIGHTS = {
    "page_error": 0.15,              # Each page error costs 15% of dynamic score
    "unhandled_rejection": 0.15,     # Each unhandled rejection costs 15%
    "vue_warn": 0.0,                 # Vue warnings do NOT penalize (false positives in headless)
    "request_failed": 0.0,           # Failed requests do NOT penalize
}
_HEALTH_PENALTY_CAP = 0.5            # Maximum penalty: 50% of dynamic score
```

**Calculation**:
- Penalty = min(0.5, 0.15×page_errors + 0.15×unhandled_rejections)
- Example: 2 page_errors + 2 unhandled_rejections = 0.15×2 + 0.15×2 = 0.6 → capped to 0.5

### 1.3 Compile Bonus Adjustment (Enhancement 5)

**File**: `runtime_monitor.py:217-229`

```python
if not compile_ok:
    base = 0.0
else:
    base = (
        events_hit_ratio * case.weights.w_events
        + case.weights.w_compile_bonus
    )
    # Enhancement 5: when nothing matched, halve compile_bonus
    if events_hit_ratio == 0.0:
        base -= case.weights.w_compile_bonus * 0.5
```

**Default weights** (schemas.py:20-28):
```python
w_events: float = 0.7        # 70% from event matching
w_compile_bonus: float = 0.3 # 30% just for compiling
```

**Scenarios**:

| Scenario | Base Formula | Result |
|----------|--------------|--------|
| Compile ✓, all events hit | 1.0 × 0.7 + 0.3 | = 1.0 |
| Compile ✓, half events | 0.5 × 0.7 + 0.3 | = 0.65 |
| Compile ✓, NO events hit | 0.0 × 0.7 + 0.3 - 0.15 | = **0.15** ← loophole closed! |
| Compile ✗ | — | = 0.0 |

**Final dynamic score**:
```python
dynamic_score = max(0.0, base - health_penalty)
```

### Example: TC-CONF-WEB-001 Walkthrough

**Dynamic result**:
- events_captured: 2 / 2 expected
- events_hit_ratio: 1.0
- page_errors: 2, unhandled_rejections: 2
- health_penalty: min(0.5, 0.15×2 + 0.15×2) = 0.5
- base: 1.0 × 0.7 + 0.3 = 1.0
- **dynamic_score**: 1.0 - 0.5 = **0.5**

Static score: 1.0
**Final**: 1.0 × 0.4 + 0.5 × 0.6 = 0.4 + 0.3 = **0.7** ✓

---

## 2. COMPILE FAILURE HANDLING

### 2.1 When Compile Fails — Final Score Discrepancy

**Case**: TC-CONF-WEB-007 (compile_fail)

**Observed**:
- static_result: score = 1.0
- dynamic_result: **null** (compile failed, no runtime observed)
- final_score: **0.4**
- failure_reason: `compile_fail`

**Formula Explanation** (case_runner_orchestrator.py:141-160):

```python
def _build_summary(case: Case, case_dir: Path, overall_duration: float) -> CaseSummary:
    static_score = static_result.score if static_result else 0.0
    dynamic_score = dynamic_result.score if dynamic_result else 0.0  # ← = 0.0 when null
    final_score = (
        static_score * case.weights.w_static_in_final
        + dynamic_score * case.weights.w_dynamic_in_final
    )
```

**Calculation for TC-CONF-WEB-007**:
- static_score = 1.0
- dynamic_score = 0.0 (because dynamic_result is None)
- final_score = 1.0 × 0.4 + 0.0 × 0.6 = **0.4** ✓

**The 0.6 vs 0.5 Question**:
- When compile fails → dynamic_score = 0.0 → final = static × 0.4
- When compile succeeds but no events match → dynamic_score = 0.15 (after penalty) → final could be higher
- If static was also perfect: 1.0 × 0.4 + 0.15 × 0.6 = 0.4 + 0.09 = **0.49** ≈ 0.5 (post-rounding)

### 2.2 Pass/Fail Logic

**File**: case_runner_orchestrator.py:166-177

```python
passed = True
failure_reason = None

if static_result and static_result.score < case.acceptance.static_score_min:
    passed = False
    failure_reason = "static_score_below_threshold"

if dynamic_result and dynamic_result.score < case.acceptance.dynamic_score_min:
    passed = False
    failure_reason = failure_reason or "dynamic_score_below_threshold"

if case.acceptance.must_compile:
    compile_ok = dynamic_result and dynamic_result.compile_ok
    if not compile_ok:
        passed = False
        failure_reason = failure_reason or "compile_fail"

if not static_result:
    passed = False
    failure_reason = "no_static_result"
```

**Key**: If `must_compile=true` and compile fails → **automatic fail** regardless of final_score

---

## 3. LOG BRIDGE & RUNTIME DATA CAPTURE

### 3.1 What log-bridge.mjs Captures

**File**: scripts/log-bridge.mjs

**Runtime Flow**:
1. **Puppeteer launch** (headless Chrome with fake media)
   - Args: `--no-sandbox --disable-dev-shm-usage --use-fake-ui-for-media-stream`
   - No actual audio/video, just SDK simulation
2. **Pre-load probes** (evaluateOnNewDocument) BEFORE page load:
   - `window.error` → captures uncaught exceptions
   - `unhandledrejection` → captures Promise rejections
   - `console.warn` override → captures Vue warnings
3. **Page load** with `waitUntil: "domcontentloaded"` (30s timeout)
4. **Console event capture** (page.on('console'))
5. **Page error capture** (page.on('pageerror'))
6. **Request failure capture** (page.on('requestfailed') + HTTP 4xx/5xx)

### 3.2 Event Schema (JSON Lines)

Each console event is emitted as:

```json
{
  "ts": "2026-05-17T10:00:00.000Z",
  "level": "log|warn|error",
  "text": "raw console output",
  "ok": true|false,
  "event": "onEventName",           // Optional: extracted from \bon\w+\b
  "__probe": "page_error|unhandled_rejection|vue_warn|request_failed"  // Optional: health probe
}
```

### 3.3 Probe Emission Mechanism

**Health probe detection** (runtime_monitor.py:87-118):

```python
def _scan_health_probes(runtime_log_path: Path) -> tuple[dict[str, int], list[str]]:
    counts = {k: 0 for k in _HEALTH_WEIGHTS}
    raw_lines: list[str] = []
    
    with open(runtime_log_path, "r") as f:
        for line in f:
            raw_lines.append(line)
            if '"__probe"' not in line:
                continue
            # Cheap substring match, not full JSON parse
            if _is_noise(line):
                continue
            for probe_key in counts:
                if f'"__probe":"{probe_key}"' in line:
                    counts[probe_key] += 1
                    break
    return counts, raw_lines
```

**Noise Patterns** (line 72-79):
```python
_NOISE_PATTERNS = [
    "favicon.ico",
    "LiveListManager",
    "sso_channel.cc",
    "net::ERR_BLOCKED_BY_CSP",
    "net::ERR_FAILED",
    "DevTools",
]
```

These are filtered to avoid counting headless environment artifacts (e.g., missing favicon).

### 3.4 Example Log Output

**From a passing case** (TC-CONF-WEB-001):
```json
{"ts":"2026-05-17T10:00:00.000Z","level":"log","text":"[account_manager.cc:46] |Login|login","ok":true,"event":"onLoginSuccess"}
{"ts":"2026-05-17T10:00:01.000Z","level":"error","__probe":"page_error","text":"[pageerror] Cannot read property 'x' of undefined","ok":false}
{"ts":"2026-05-17T10:00:02.000Z","level":"warn","__probe":"vue_warn","text":"[Vue warn] onUnmounted called outside of component","ok":true}
```

---

## 4. DOM/UI VERIFICATION — GAP ANALYSIS

### 4.1 Current State: NO DOM Checking

**Grep Results**:
- No `querySelector`, `getElementById`, `getAttribute` calls in evaluation scripts
- No screenshot capture via Puppeteer
- No DOM tree validation
- No visual regression detection

### 4.2 What IS Captured

✅ **Console output** (log-bridge):
  - SDK event logging via `console.log()`
  - Uncaught errors via `window.error`
  - Promise rejections via `unhandledrejection`
  - Vue lifecycle warnings

✅ **Network events**:
  - Request failures (Puppeteer `requestfailed` event)
  - HTTP 4xx/5xx responses

✅ **Build artifacts**:
  - Compile errors (compile.log, trace.jsonl exit codes)
  - Injection success (files created by evaluator.py)

### 4.3 What IS NOT Captured

❌ **DOM rendering**:
  - No check that UI elements exist/are visible
  - No screenshot comparison
  - No accessibility tree validation

❌ **Visual correctness**:
  - No check that buttons/forms are clickable
  - No check that modals/overlays appear
  - No check that layout is responsive

❌ **Browser APIs**:
  - No check that localStorage/sessionStorage is used
  - No check that IndexedDB queries succeed
  - No check that media stream permissions are granted

❌ **Performance**:
  - No timing of SDK method calls
  - No tracking of memory/CPU usage
  - No long task detection

### 4.4 Implication

The evaluation focuses on **SDK surface coverage** (do methods exist? do callbacks fire?), not **user-facing correctness** (does the UI render? are features usable?).

This is intentional for early-stage code generation eval — catching missing SDK calls is more valuable than perfect UX right now.

---

## 5. STATIC SCORING FORMULA

### 5.1 Code Constraint Checking

**File**: evaluator.py:114-141

```python
# must_include check
hits: list[str] = []
misses: list[str] = []
for needle in case.constraints.must_include:
    matches = grep_fixed(needle, code_dir)
    if matches:
        hits.append(needle)
    else:
        misses.append(needle)

total_mi = len(case.constraints.must_include)
must_include_hit = len(hits) / total_mi if total_mi > 0 else 1.0

# must_not_include check
dirty: list[str] = []
for needle in case.constraints.must_not_include:
    matches = grep_fixed(needle, code_dir)
    if matches:
        dirty.append(needle)

total_mni = len(case.constraints.must_not_include)
must_not_include_clean = (total_mni - len(dirty)) / total_mni if total_mni > 0 else 1.0

# Score
static_score = (
    must_include_hit * case.weights.w_must_include
    + must_not_include_clean * case.weights.w_must_not
)
```

### 5.2 Default Weights

```python
w_must_include: float = 0.6
w_must_not: float = 0.4
```

### 5.3 Example: TC-CONF-WEB-012

**Case constraints**:
- must_include: ["useDeviceState", "useRoomParticipantState", "openLocalCamera", ...] (8 items)
- must_not_include: [...]

**Result**:
- hits: [] (0/8)
- must_include_hit: 0.0
- must_not_include_clean: 1.0
- **static_score**: 0.0 × 0.6 + 1.0 × 0.4 = **0.0**

→ Fails threshold (dynamic_result is null anyway because build probably failed)

---

## 6. WEB PLATFORM SPECIFICS

### 6.1 Framework Detection

**File**: web_profile.py:42-84

Auto-detects framework from AI-generated code:
- **React**: `from "react"` OR `import React` OR `.jsx`/`.tsx` files
- **Vue3**: `.vue` files with `<script setup>` or `defineComponent()`
- **Vue2**: `.vue` files with `Vue.extend()` or Options API
- **Vanilla**: Fallback if none of the above

### 6.2 Profile Overlay

Applies framework-specific config before `npm ci`:
- Merges `package.patch.json` into `package.json`
- Replaces `vite.config.ts`
- Installs correct `main.ts` vs `main.tsx`
- Adjusts `index.html` entry point

### 6.3 Environment Injection

**TRTC credentials** (log-bridge.mjs:97-136):
- Read from `<case_dir>/.eval-meta/launch.env`
- Converted to `VITE_TRTC_TEST_*` for frontend's `import.meta.env`
- Never read directly from `process.env` (stale values from previous runs can shadow correct config.json values)

**Auto-run flow** (log-bridge.mjs:66-75):
- Injected as `VITE_EVAL_AUTO_RUN_FLOW` environment variable
- Browser reads via `loadEnv()` to populate test flow

---

## 7. KEY FORMULAS SUMMARY TABLE

| Component | Formula | Notes |
|-----------|---------|-------|
| **events_hit_ratio** | `len(captured) / len(expected) or 1.0 if len==0` | 0/0 = 1.0 is intentional |
| **health_penalty** | `min(0.5, 0.15×page_errors + 0.15×unhandled_rejections)` | Vue warnings + request failures don't penalize |
| **dynamic_base** | `events_hit_ratio × 0.7 + 0.3 (if compile ok)` | 0.0 if compile fails |
| **dynamic_base_adjusted** | `base - 0.15 if events_hit_ratio == 0.0` | Enhancement 5: closes compile_bonus loophole |
| **dynamic_score** | `max(0, dynamic_base_adjusted - health_penalty)` | Minimum 0.0 |
| **static_score** | `must_include_hit × 0.6 + must_not_include_clean × 0.4` | Pure text grep matching |
| **final_score** | `static_score × 0.4 + dynamic_score × 0.6` | Weighted blend |

---

## 8. KNOWN ISSUES & GAPS

### Issue 1: 0/0 = 1.0 Ratio
- **Symptom**: Cases with no expected_events always get 1.0 on event ratio
- **Impact**: Can inflate scores if dynamic_score weights are high
- **Mitigation**: Cases should always define meaningful expected_events

### Issue 2: No DOM/UI Verification
- **Symptom**: Cannot detect if rendered UI matches spec (buttons invisible, forms broken, etc.)
- **Impact**: Code can pass runtime eval but fail in actual app usage
- **Mitigation**: Addressed by proposal for Puppeteer DOM assertion layer

### Issue 3: Compile Failure Results in null dynamic_result
- **Symptom**: When compile fails, dynamic_result is not created
- **Impact**: Final_score formula must handle null gracefully; summary still computes valid score
- **Fix**: Intentional design; makes pass/fail logic clearer (must_compile gate)

### Issue 4: Health Penalty Cap May Be Too Aggressive
- **Symptom**: Two errors = 0.3 penalty, capped at 0.5; beyond that it's free
- **Impact**: Page with many errors still scores > 0.5 on dynamic if events matched
- **Mitigation**: Could lower cap or increase weights, case-by-case

### Issue 5: Noise Pattern Matching Is Substring-Based
- **Symptom**: "favicon.ico" filters lines containing "favicon" even in non-404 contexts
- **Impact**: False negatives if real errors mention favicon
- **Mitigation**: Acceptable tradeoff for headless environment stability

---

## 9. TESTING EXAMPLES

### Example A: Perfect Pass

**TC-CONF-WEB-001** (conference/login-auth):
```
Static:   1.0 (all must_include hit, no must_not violations)
Dynamic:  0.5 (events matched perfectly but 2 page_errors + 2 unhandled_rejections)
Final:    1.0 × 0.4 + 0.5 × 0.6 = 0.7 ✓ (passes 0.7 threshold)
```

### Example B: Build Fails

**TC-CONF-WEB-007** (conference/room-invite):
```
Static:   1.0 (code quality was good, but didn't execute)
Dynamic:  null (never ran, compile_fail)
Final:    1.0 × 0.4 + 0.0 × 0.6 = 0.4
Reason:   "compile_fail" (automatic fail despite static score)
```

### Example C: AI Generated Nothing

**TC-CONF-WEB-012** (conference/device-control):
```
Static:   0.0 (no must_include constraints found)
Dynamic:  null (early exit, static already too low)
Final:    0.0 × 0.4 + 0.0 × 0.6 = 0.0
Reason:   "static_score_below_threshold"
```

---

## 10. APPENDIX: FILE LOCATIONS

| Path | Purpose |
|------|---------|
| runtime_monitor.py | Main dynamic scoring logic |
| puppeteer_parser.py | Token matching for event detection |
| case_runner_orchestrator.py | Final score computation in _build_summary() |
| log-bridge.mjs | Puppeteer + probe setup |
| evaluator.py | Static scoring via grep |
| web_profile.py | Framework detection + profile application |
| schemas.py | DynamicResult, StaticResult, CaseSummary pydantic models |
| tests/benchmark/cases.json | Test case definitions (weights, constraints, expected_events) |
| .claude/eval-runs/{ts}/cases/{id}/dynamic_result.json | Per-case runtime scoring output |
| .claude/eval-runs/{ts}/cases/{id}/summary.json | Final pass/fail decision |

---

## CONCLUSION

The trtc-eval scoring system is a **rigorous but limited** evaluation framework:

✅ **Strengths**:
- Two-stage (static + dynamic) captures both code quality and runtime behavior
- Health penalties penalize crashes but acknowledge headless environment noise
- Compile gate ensures runnable code
- Reproducible, auditable via trace.jsonl

❌ **Limitations**:
- No UI/DOM verification (functional but not visual)
- Event matching is text-based, not behavioral
- No performance metrics
- 0/0 = 1.0 ratio can inflate scores in edge cases

**Recommendation**: For SDK evaluation purposes (is the API used correctly?), this system is solid. For user-facing app evaluation (does the app actually work?), add DOM assertion layer as proposed in review document.
