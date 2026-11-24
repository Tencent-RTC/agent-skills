# Quality Self-Check

This document describes the four-gate quality self-check mechanism that ensures the eval tool produces trustworthy results.

## Gate A: Artifact Existence
Every case must produce:
- `ai_raw_output.md` (≥200B)
- `compile.log` (exists regardless of success/failure)
- `runtime.log` (exists; may be empty if compile failed)
- `summary.json` with valid `artifacts_dir`

## Gate B: Data Authenticity
- `runtime.log` must not be a copy of any fixture file (SHA256 check)
- `runtime.log` must contain the EVAL_RUN_NONCE marker (challenge-response)
- Timestamps must be consistent with demo_runner execution time

## Gate C: Flow Completeness
- `trace.jsonl` must have exactly 1 `_meta` + 7 main steps
- Steps must be in strict order: run_ai → evaluator → demo_build → log_stream_start → demo_run → log_stream_stop → runtime_monitor
- No extra commands allowed in trace
- EVAL_RUN_NONCE in `_meta` must be 32-char hex

## Gate D: Injection Completeness
- If AI produced code in `ai_extracted_code/` (directory exists and non-empty), then `workspace/.eval-meta/injection_diff.txt` MUST exist and be non-empty
- Catches misconfigured `cases.json` where `demo_injection_map` doesn't match the AI output, or where the default routing fails silently
- A missing/empty injection_diff when code was produced means the AI's code was never injected into the template — the compile and runtime steps tested the unmodified template, not the AI's work

## Running Self-Check

All commands run from the skill directory (`cd .claude/skills/trtc-eval/`):

```bash
# Before eval
python scripts/selfcheck.py --phase=pre-run

# After eval (run-dir is the repo-root eval-runs directory)
python scripts/selfcheck.py --phase=post-run --run-dir=../../../.claude/eval-runs/{timestamp}

# Validate cases.json
python scripts/selfcheck.py --phase=cases-lint
```
