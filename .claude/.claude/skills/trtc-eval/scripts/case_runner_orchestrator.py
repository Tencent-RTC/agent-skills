"""case_runner_orchestrator.py — THE sole orchestration entry point.

This script:
- Is the ONLY writer of trace.jsonl (sub-scripts MUST NOT write trace)
- Generates EVAL_RUN_NONCE once (single source of truth)
- Runs 7 steps in strict order via subprocess
- Outputs exactly one JSON line to stdout for the main Agent
"""
import argparse
import json
import os
import secrets
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

# Skill root (where bootstrap.sh / scripts / tests / templates all live)
_SKILL_ROOT = Path(__file__).resolve().parent.parent

# Ensure skill root is on sys.path for `from scripts.lib...` imports
sys.path.insert(0, str(_SKILL_ROOT))

from scripts.lib.schemas import Case, CaseSummary, StaticResult, DynamicResult
from scripts.lib.eval_config import load_config, EvalConfigError, TrtcTestAccount
from scripts.lib.device_picker import pick as _pick_device
from scripts.lib.platforms import get_adapter
from scripts.lib.template_fetcher import PLATFORM_TO_DIR


def _ensure_templates(platform: str) -> None:
    """Pre-flight check: verify template project exists, run bootstrap.sh if missing.

    This prevents the common failure mode where `demo_build` step fails with
    'INJECTION.json missing — run ./bootstrap.sh first'.
    """
    dir_name = PLATFORM_TO_DIR.get(platform)
    if dir_name is None:
        return  # Unknown platform, let downstream handle the error

    template_dir = _SKILL_ROOT / "templates" / dir_name
    injection_file = template_dir / "INJECTION.json"

    if injection_file.exists():
        return  # Template already available

    # Template missing — run bootstrap.sh to set up the environment
    bootstrap_script = _SKILL_ROOT / "bootstrap.sh"
    if not bootstrap_script.exists():
        print(
            f"WARNING: Template '{dir_name}/INJECTION.json' missing and bootstrap.sh not found.",
            file=sys.stderr,
        )
        return

    print(f"[env-check] Template '{dir_name}' not found. Running bootstrap.sh to initialize...",
          file=sys.stderr)
    try:
        proc = subprocess.run(
            ["bash", str(bootstrap_script)],
            cwd=str(_SKILL_ROOT),
            timeout=300,
            capture_output=True,
        )
        if proc.returncode == 0:
            print("[env-check] bootstrap.sh completed successfully.", file=sys.stderr)
        else:
            print(
                f"[env-check] bootstrap.sh exited with code {proc.returncode}.",
                file=sys.stderr,
            )
            stderr_tail = proc.stderr[-1024:].decode("utf-8", "replace") if proc.stderr else ""
            if stderr_tail:
                print(f"[env-check] stderr (tail): {stderr_tail}", file=sys.stderr)
    except subprocess.TimeoutExpired:
        print("[env-check] bootstrap.sh timed out (300s).", file=sys.stderr)
    except OSError as e:
        print(f"[env-check] Failed to run bootstrap.sh: {e}", file=sys.stderr)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _append_trace(trace_path: Path, data: dict) -> None:
    """Append a single JSON line to trace.jsonl. MUST use open(a) + json.dumps + newline."""
    with open(trace_path, "a", encoding="utf-8") as f:
        f.write(json.dumps(data, ensure_ascii=False) + "\n")


def _apply_creds_to_env(env: dict, account: TrtcTestAccount) -> None:
    """Write resolved TRTC_TEST_* credentials into ``env``, **always overwriting**.

    config.json is the single source of truth for credentials (with shell env
    as a per-field fallback when config.json fields are missing — that
    resolution already happened inside ``load_config()``).  The resolved
    ``account`` must win unconditionally so that stale shell environment
    variables (e.g. an expired $TRTC_TEST_USERSIG from a previous session)
    can never shadow the correct value from config.json.
    """
    env["TRTC_TEST_SDKAPPID"] = str(account.sdk_app_id)
    env["TRTC_TEST_USERID"] = account.user_id
    env["TRTC_TEST_USERSIG"] = account.user_sig


def _write_case_creds(case_dir: Path, account: TrtcTestAccount) -> None:
    """Persist the resolved TRTC test creds to ``<case_dir>/.eval-meta/launch.env``.

    This file is the authoritative source for platform-specific injectors:
    - scripts/log-bridge.mjs reads it to populate VITE_TRTC_TEST_* in .env.local
    - ios/android adapters could consume it for real-device --setenv in the future

    Format: one ``KEY=value`` per line, no quoting. Values are not expected to
    contain newlines (TRTC userSig is base64/percent-encoded).
    """
    meta = case_dir / ".eval-meta"
    meta.mkdir(parents=True, exist_ok=True)
    (meta / "launch.env").write_text(
        f"TRTC_TEST_SDKAPPID={account.sdk_app_id}\n"
        f"TRTC_TEST_USERID={account.user_id}\n"
        f"TRTC_TEST_USERSIG={account.user_sig}\n"
    )


_PY = sys.executable  # Use the same Python interpreter for subprocesses
_SCRIPTS_DIR = _SKILL_ROOT / "scripts"  # Absolute path so subprocess cwd doesn't matter

STEPS = [
    # (name, cmd_builder, required_for_pass, timeout_sec)
    ("run_ai", lambda c, d, e: [_PY, str(_SCRIPTS_DIR / "run_ai.py"), "--case-id", c.test_id, "--run-dir", d], True, 360),
    ("evaluator", lambda c, d, e: [_PY, str(_SCRIPTS_DIR / "evaluator.py"), "--case-id", c.test_id, "--run-dir", d], True, 60),
    ("demo_build", lambda c, d, e: [_PY, str(_SCRIPTS_DIR / "demo_runner.py"), "--case-id", c.test_id, "--run-dir", d, "--phase=build"], True, 600),
    ("log_stream_start", lambda c, d, e: [_PY, str(_SCRIPTS_DIR / "log_streamer.py"), "--case-id", c.test_id, "--run-dir", d, "--mode=start"], False, 30),
    ("demo_run", lambda c, d, e: [_PY, str(_SCRIPTS_DIR / "demo_runner.py"), "--case-id", c.test_id, "--run-dir", d, "--phase=run"], False, 120),
    ("log_stream_stop", lambda c, d, e: [_PY, str(_SCRIPTS_DIR / "log_streamer.py"), "--case-id", c.test_id, "--run-dir", d, "--mode=stop"], False, 10),
    ("runtime_monitor", lambda c, d, e: [_PY, str(_SCRIPTS_DIR / "runtime_monitor.py"), "--case-id", c.test_id, "--run-dir", d], False, 30),
]


def _build_summary(case: Case, case_dir: Path, overall_duration: float) -> CaseSummary:
    """Build CaseSummary from static_result.json + dynamic_result.json."""
    static_result: StaticResult | None = None
    dynamic_result: DynamicResult | None = None

    static_path = case_dir / "static_result.json"
    if static_path.exists():
        static_result = StaticResult(**json.loads(static_path.read_text()))

    dynamic_path = case_dir / "dynamic_result.json"
    if dynamic_path.exists():
        dynamic_result = DynamicResult(**json.loads(dynamic_path.read_text()))

    # Compute final score
    static_score = static_result.score if static_result else 0.0
    dynamic_score = dynamic_result.score if dynamic_result else 0.0
    final_score = (
        static_score * case.weights.w_static_in_final
        + dynamic_score * case.weights.w_dynamic_in_final
    )

    # Determine pass/fail
    passed = True
    failure_reason = None

    if static_result and static_result.score < case.acceptance.static_score_min:
        passed = False
        failure_reason = "static_score_below_threshold"
    if dynamic_result and dynamic_result.score < case.acceptance.dynamic_score_min:
        passed = False
        failure_reason = failure_reason or "dynamic_score_below_threshold"
    # 只要 must_compile=true，而没有编译成功的证据，就不能 pass
    if case.acceptance.must_compile:
        compile_ok = dynamic_result and dynamic_result.compile_ok
        if not compile_ok:
            passed = False
            failure_reason = failure_reason or "compile_fail"
    if not static_result:
        passed = False
        failure_reason = "no_static_result"

    return CaseSummary(
        test_id=case.test_id,
        ability=case.ability,
        platform=case.platform,
        static_result=static_result,
        dynamic_result=dynamic_result,
        final_score=round(final_score, 4),
        passed=passed,
        failure_reason=failure_reason,
        artifacts_dir=str(case_dir),
        duration_sec=round(overall_duration, 2),
        score_breakdown={
            "static_score": round(static_score, 4),
            "dynamic_score": round(dynamic_score, 4),
            "w_static_in_final": case.weights.w_static_in_final,
            "w_dynamic_in_final": case.weights.w_dynamic_in_final,
            "formula": (
                f"{static_score:.4f} * {case.weights.w_static_in_final} "
                f"+ {dynamic_score:.4f} * {case.weights.w_dynamic_in_final} "
                f"= {final_score:.4f}"
            ),
            "acceptance": {
                "static_score_min": case.acceptance.static_score_min,
                "dynamic_score_min": case.acceptance.dynamic_score_min,
                "must_compile": case.acceptance.must_compile,
            },
        },
    )


def main() -> int:
    ap = argparse.ArgumentParser(description="Single-case orchestrator (runs 7 steps in order)")
    ap.add_argument("--case-id", required=True, help="Test case ID from cases.json")
    ap.add_argument("--run-dir", required=True, help="Run directory (absolute or relative)")
    ap.add_argument("--limit-step", type=int, default=len(STEPS),
                    help="Debug: only run up to step N (1-7)")
    args = ap.parse_args()

    run_dir = Path(args.run_dir).resolve()
    case_dir = run_dir / "cases" / args.case_id
    case_dir.mkdir(parents=True, exist_ok=True)
    trace_path = case_dir / "trace.jsonl"

    # 1) Load case
    cases_path = _SKILL_ROOT / "tests" / "benchmark" / "cases.json"
    if not cases_path.exists():
        print(json.dumps({"error": f"{cases_path} not found"}), file=sys.stderr)
        return 1
    cases_data = json.loads(cases_path.read_text())
    case_raw = next((c for c in cases_data if c["test_id"] == args.case_id), None)
    if case_raw is None:
        print(json.dumps({"error": f"case-id '{args.case_id}' not found in cases.json"}), file=sys.stderr)
        return 1
    case = Case(**case_raw)

    # Pre-flight: ensure template project exists for this platform
    _ensure_templates(case.platform)

    # 2) Generate EVAL_RUN_NONCE (single source), write trace _meta
    nonce = secrets.token_hex(16)
    env = {**os.environ, "EVAL_RUN_NONCE": nonce}

    # 2a) Load TRTC test credentials from skill config.
    # load_config() resolves per-field: config.json preferred, shell env as
    # fallback for missing fields.  _apply_creds_to_env() then OVERWRITES
    # the subprocess env dict unconditionally so that stale shell variables
    # (e.g. an expired $TRTC_TEST_USERSIG) can never leak into child
    # processes.  Credentials are also persisted to a per-case launch.env
    # file so platform-specific layers (log-bridge for web, launch --console
    # for ios/android) can locate them deterministically.
    try:
        eval_cfg = load_config()
    except EvalConfigError as e:
        print(json.dumps({"error": "config_missing", "detail": str(e)}), file=sys.stderr)
        return 7
    _apply_creds_to_env(env, eval_cfg.trtc_test_account)
    _write_case_creds(case_dir, eval_cfg.trtc_test_account)

    # Inject auto_run_flow into environment so the App's AutoRunCoordinator picks it up.
    # Pass ALL flows as comma-separated string so the coordinator runs them sequentially.
    flow_ids = case.autorun_flow_ids()
    if flow_ids:
        env["EVAL_AUTO_RUN_FLOW"] = ",".join(flow_ids)

    _append_trace(trace_path, {
        "step": "_meta",
        "nonce": nonce,
        "creds_source": eval_cfg.source,
        "ts": _now(),
    })

    # 3) Run steps in order
    build_failed = False
    overall_exit = 0
    selected_device = None
    t_start = time.time()
    SKIP_ON_BUILD_FAIL = {"log_stream_start", "demo_run", "log_stream_stop", "runtime_monitor"}

    for i, (name, build_cmd, required, step_timeout) in enumerate(STEPS[:args.limit_step]):
        if name in SKIP_ON_BUILD_FAIL and build_failed:
            _append_trace(trace_path, {
                "step": name, "status": "skipped", "reason": "compile_fail", "ts": _now(),
            })
            continue

        cmd = build_cmd(case, str(run_dir), env)

        # Special handling for log_stream_start/stop (device selection)
        if name == "log_stream_start":
            device = _pick_device(case.platform, env.get("EVAL_DEVICE_POLICY", "prefer-simulator"))
            if device is None:
                _append_trace(trace_path, {
                    "step": name, "status": "fail", "reason": "no_device", "ts": _now(),
                })
                overall_exit = 4
                build_failed = True
                continue
            # Ensure device is booted before starting log stream
            adapter = get_adapter(case.platform)
            boot_rc = adapter.ensure_booted(device)
            if boot_rc != 0:
                _append_trace(trace_path, {
                    "step": name, "status": "fail",
                    "reason": f"boot_failed(rc={boot_rc})", "ts": _now(),
                })
                overall_exit = 5
                build_failed = True
                continue
            # Install app before launching (--console launch requires app already installed)
            workspace = case_dir / "workspace"
            install_rc = adapter.install(workspace, device)
            if install_rc != 0:
                _append_trace(trace_path, {
                    "step": name, "status": "fail",
                    "reason": f"install_failed(rc={install_rc})", "ts": _now(),
                })
                overall_exit = 6
                build_failed = True
                continue
            selected_device = device
            cmd += ["--platform", case.platform, "--device-kind", device.kind,
                    "--device-id", device.id, "--nonce", nonce]
        elif name == "log_stream_stop":
            if selected_device is None:
                _append_trace(trace_path, {
                    "step": name, "status": "skipped", "reason": "no_device", "ts": _now(),
                })
                continue
            cmd += ["--platform", case.platform, "--device-kind", selected_device.kind,
                    "--device-id", selected_device.id]

        t0 = time.time()
        try:
            proc = subprocess.run(cmd, env=env, timeout=step_timeout, capture_output=True)
            dur = time.time() - t0

            # Retry run_ai once if skill loading failed (kb_unreachable).
            # This handles intermittent skill registration failures where the
            # AI driver cannot find the trtc skill and returns an error JSON.
            if name == "run_ai" and proc.returncode == 0:
                ai_output_path = case_dir / "ai_raw_output.md"
                if ai_output_path.exists():
                    ai_content = ai_output_path.read_text(errors="replace")
                    if "kb_unreachable" in ai_content and len(ai_content) < 200:
                        _append_trace(trace_path, {
                            "step": name,
                            "status": "retry",
                            "reason": "kb_unreachable detected, retrying once",
                            "duration_sec": round(dur, 2),
                            "ts": _now(),
                        })
                        t0 = time.time()
                        proc = subprocess.run(cmd, env=env, timeout=step_timeout, capture_output=True)
                        dur = time.time() - t0

            _append_trace(trace_path, {
                "step": name,
                "exit_code": proc.returncode,
                "duration_sec": round(dur, 2),
                "stdout_tail": proc.stdout[-512:].decode("utf-8", "replace") if proc.stdout else "",
                "stderr_tail": proc.stderr[-512:].decode("utf-8", "replace") if proc.stderr else "",
                "ts": _now(),
            })
            if name == "demo_build" and proc.returncode != 0:
                build_failed = True
                overall_exit = 2
            elif required and proc.returncode != 0:
                overall_exit = proc.returncode
        except subprocess.TimeoutExpired:
            dur = time.time() - t0
            _append_trace(trace_path, {
                "step": name, "status": "timeout", "duration_sec": round(dur, 2), "ts": _now(),
            })
            overall_exit = 124
            if name == "demo_build":
                build_failed = True

    # 4) Build summary.json
    overall_duration = time.time() - t_start
    summary = _build_summary(case, case_dir, overall_duration)
    (case_dir / "summary.json").write_text(
        json.dumps(summary.model_dump(), indent=2, ensure_ascii=False)
    )

    # 5) stdout one JSON line for main Agent
    print(json.dumps({
        "test_id": case.test_id,
        "exit_code": overall_exit,
        "summary_path": str((case_dir / "summary.json").relative_to(run_dir)),
    }))
    return overall_exit


if __name__ == "__main__":
    sys.exit(main())
