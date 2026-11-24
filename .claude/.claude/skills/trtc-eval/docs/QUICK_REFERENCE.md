# TRTC-Eval Scoring — Quick Reference

## Formulas at a Glance

### Static Score (40% of final)
```
static_score = (must_include_hit × 0.6) + (must_not_include_clean × 0.4)
```
Where:
- `must_include_hit` = # found / # required
- `must_not_include_clean` = 1 - (# violations / # forbidden)

### Dynamic Score (60% of final)
```
IF compile_ok:
  events_ratio = captured / expected (or 1.0 if expected == 0)
  base = (events_ratio × 0.7) + 0.3
  IF events_ratio == 0: base -= 0.15
ELSE:
  base = 0.0

health_penalty = min(0.5, 0.15×page_errors + 0.15×unhandled_rejections)
dynamic_score = max(0, base - health_penalty)
```

### Final Score
```
final_score = (static × 0.4) + (dynamic × 0.6)
```

### Pass Criteria (ALL must be true)
- `static_score >= 0.7` (threshold)
- `dynamic_score >= 0.7` (threshold)
- `compile_ok == true` (if must_compile=true in case)
- `static_result` exists

---

## Key Numbers

| Component | Default | Notes |
|-----------|---------|-------|
| w_must_include | 0.6 | Static weight |
| w_must_not | 0.4 | Static weight |
| w_events | 0.7 | Dynamic: event matching |
| w_compile_bonus | 0.3 | Dynamic: clean compile |
| w_static_in_final | 0.4 | Final blend |
| w_dynamic_in_final | 0.6 | Final blend |
| static_score_min | 0.7 | Pass threshold |
| dynamic_score_min | 0.7 | Pass threshold |
| page_error_weight | 0.15 | Each error = 15% penalty |
| unhandled_rejection_weight | 0.15 | Each rejection = 15% penalty |
| health_penalty_cap | 0.5 | Max penalty |

---

## Common Scenarios

| Scenario | Score | Pass? | Reason |
|----------|-------|-------|--------|
| All static + dynamic perfect | 1.0 | ✓ | Both 1.0 |
| Static 1.0, dynamic 0.5 | 0.7 | ✓ | 0.4 + 0.3 = 0.7 |
| Static 1.0, dynamic 0.0 | 0.4 | ✗ | 0.4 + 0.0 = 0.4 (compile_fail) |
| Static 1.0, no events (compile ok) | 0.49 | ✗ | 0.4 + 0.09 = 0.49 (0.15 dynamic) |
| Static 0.7, dynamic 0.7 | 0.7 | ✓ | Threshold |
| Static 0.6, dynamic 1.0 | 0.64 | ✗ | 0.24 + 0.6 = 0.64 (static too low) |

---

## Health Penalties

**Penalized** (hard failures):
- page_error: +0.15 per error
- unhandled_rejection: +0.15 per rejection

**NOT penalized** (headless noise):
- vue_warn: +0.0 (lifecycle warnings are frequent)
- request_failed: +0.0 (CDN/3rd party failures expected)

**Example**: 2 page_errors + 2 unhandled_rejections
- Raw penalty: 0.15×2 + 0.15×2 = 0.6
- Capped at 0.5 (never > 50%)
- Applied: dynamic = max(0, base - 0.5)

---

## Event Matching

**Expected Format** (cases.json):
```
"[file.cc:123] |Login|login"
"[file.cc:456] onSuccess"
```

**How Matching Works**:
1. Extract identifier tokens (≥3 chars, [A-Za-z_]\w*)
2. Look for lines containing ALL tokens
3. Exclude lines tagged with `"__probe"` (health probes)
4. Exclude lines with `"level":"error"`

**Example**:
- Expected: `[account_manager.cc:46] |Login|login`
- Tokens: `{"Login", "login"}` (both ≥3 chars)
- Match: Any line with BOTH "Login" AND "login"

---

## Debug Path

When a test fails, check in this order:

1. **Static score too low?**
   - Look at `static_result.json` → `misses` (which constraints failed?)
   - Check `ai_extracted_code/` directory — is code generated?

2. **Dynamic score too low?**
   - Check `dynamic_result.json` → `events_missing` (which events not captured?)
   - Check `runtime.log` — do events appear? Are they spelled correctly?

3. **Compile failed?**
   - Check `compile.log` — is there a build error?
   - Check `trace.jsonl` → `demo_build` step — what's the exit_code?

4. **Health penalty too high?**
   - Check `dynamic_result.json` → `page_errors`, `unhandled_rejections`
   - Check `runtime.log` — filter by `__probe` tag
   - Are these real errors or noise (favicon.ico, etc.)?

---

## Files to Read

**For scoring deep-dive**:
- `SCORING_ANALYSIS.md` — detailed formulas + examples
- `DATA_FLOW_DIAGRAMS.md` — architecture + data flow

**For quick answers**:
- This file (QUICK_REFERENCE.md)
- `runtime_monitor.py` lines 121-232 (dynamic scoring)
- `evaluator.py` lines 114-141 (static scoring)
- `case_runner_orchestrator.py` lines 155-160 (final score)

---

## Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| 0/0 = 1.0 ratio | Cases w/ no expected_events focus on compile/static |
| Halve compile_bonus if no events | Close "free pass for compiling" loophole |
| Ignore vue_warn & request_failed | These are headless environment noise, not real failures |
| Cap health_penalty at 0.5 | Prevent error count explosion from overwhelming score |
| 40/60 split (static/dynamic) | Early-stage eval: static code quality matters most |

---

## Gotchas

1. **0/0 = 1.0**: If a case has `expected_events: []`, events always match perfectly
2. **Compile failure = 0.4 floor**: When compile fails, final = static × 0.4 (dynamic = 0)
3. **No events = 0.15 dynamic**: If code compiles but produces no matched events, score is 0.15 (not 0.3)
4. **Must pass ALL gates**: High static doesn't rescue low dynamic; both thresholds apply
5. **Health penalty independent**: Applies after event matching, separate calculation

