# Troubleshooting

Common issues when running the eval tool.

## CLI Timeout
**Symptom**: `run_ai.py` returns exit code 124
**Cause**: The AI CLI took >300s to respond
**Fix**:
- Check CLI authentication: `claude --version`
- Check network connectivity
- Try increasing timeout (env `EVAL_CLI_TIMEOUT_SEC`)

## No Device Available
**Symptom**: orchestrator exits with code 4
**Cause**: `device_picker` found no suitable device
**Fix**:
- For iOS simulator: `xcrun simctl list devices available`
- For Android emulator: `adb devices`
- Set `EVAL_DEVICE_POLICY=prefer-simulator` (default)
- Boot a simulator manually if none are running

## Compile Failure
**Symptom**: orchestrator exits with code 2, `compile.log` shows errors
**Cause**: AI-generated code doesn't compile against the template
**Fix**:
- Check `compile.log` for specific errors
- Verify template `INJECTION.json` matches the case's `demo_injection_map`
- Ensure `bootstrap.sh` has been run (dependencies installed)

## selfcheck TAINTED
**Symptom**: `selfcheck.py --phase=post-run` reports `verdict=TAINTED`
**Cause**: One or more gates failed
**Fix**:
- Read `selfcheck.json` to identify which gate/check failed
- Gate A: missing artifacts → check orchestrator trace for step failures
- Gate B: nonce missing → verify demo template prints `TRTC_EVAL_NONCE=...`
- Gate C: trace order wrong → check orchestrator STEPS list integrity

## Template Not Found
**Symptom**: `FileNotFoundError: <skill_root>/templates/ios-demo/INJECTION.json missing`
**Fix**: From the skill directory (`cd .claude/skills/trtc-eval/`), run `./bootstrap.sh` to clone templates from `Hanpto/project_template`
