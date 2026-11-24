"""selfcheck.py — Quality self-check script (§7).

Phases:
  pre-run     Environment + source hygiene checks (before eval)
  post-run    Three-gate validation (after eval)
  cases-lint  Eval set schema validation

Any failure → exit non-zero. Main Agent MUST abort on failure.
"""
import argparse
import ast
import base64
import hashlib
import json
import os
import re
import subprocess
import sys
import time
import zlib
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from scripts.lib.eval_config import skill_root, repo_root


def _grep_in_scripts(pattern: str) -> list[str]:
    """Grep scripts/ for a pattern. Returns matching filenames."""
    scripts_dir = skill_root() / "scripts"
    try:
        proc = subprocess.run(
            ["rg", "-l", pattern, str(scripts_dir)],
            capture_output=True, text=True, check=False,
        )
        if proc.returncode == 0 and proc.stdout.strip():
            return proc.stdout.strip().splitlines()
    except (FileNotFoundError, PermissionError):
        # rg not available, fallback to Python grep (case-sensitive, skip comment lines)
        hits = []
        for py_file in scripts_dir.rglob("*.py"):
            if "selfcheck" in py_file.name:
                continue  # don't flag ourselves
            content = py_file.read_text(errors="replace")
            non_comment = "\n".join(
                line for line in content.splitlines()
                if not line.lstrip().startswith("#")
            )
            if re.search(pattern, non_comment):
                hits.append(str(py_file))
        return hits
    return []


def _decode_user_sig(user_sig: str) -> dict:
    """Decode TRTC UserSig and return the TLS payload dict.

    UserSig format: base64url-variant(zlib(JSON)) where the base64 alphabet
    substitutes  * for +,  - for /,  _ for =.

    Returns dict with keys: TLS.time, TLS.expire, TLS.identifier, TLS.sig, etc.
    Raises ValueError on any decode failure.
    """
    try:
        b64 = user_sig.replace("*", "+").replace("-", "/").replace("_", "=")
        raw = base64.b64decode(b64)
        payload = zlib.decompress(raw)
        return json.loads(payload)
    except (base64.binascii.Error, zlib.error) as e:
        raise ValueError(f"UserSig decode failed (base64/zlib): {e}") from e
    except (json.JSONDecodeError, KeyError) as e:
        raise ValueError(f"UserSig payload invalid: {e}") from e


def _check_user_sig_expiry(user_sig: str, min_remaining_sec: int = 3600) -> tuple[bool, str]:
    """Check if UserSig has enough remaining validity.

    Returns (ok, detail) where detail is a human-readable explanation.
    """
    try:
        data = _decode_user_sig(user_sig)
        tls_time = int(data["TLS.time"])
        tls_expire = int(data["TLS.expire"])
        expire_at = tls_time + tls_expire
        now = int(time.time())
        remaining = expire_at - now

        if remaining <= 0:
            hours_ago = abs(remaining) // 3600
            return False, (
                f"UserSig expired {hours_ago}h ago "
                f"(generated {time.strftime('%Y-%m-%d %H:%M', time.localtime(tls_time))}, "
                f"validity {tls_expire // 3600}h). "
                f"Regenerate at https://console.trtc.io/"
            )

        if remaining < min_remaining_sec:
            mins_left = remaining // 60
            return False, (
                f"UserSig expires in {mins_left}min — not enough for a full eval run. "
                f"Regenerate with validity >= 24h at https://console.trtc.io/"
            )

        hours_left = remaining // 3600
        return True, f"UserSig valid for {hours_left}h (expires {time.strftime('%Y-%m-%d %H:%M', time.localtime(expire_at))})"

    except (ValueError, KeyError) as e:
        return False, str(e)
    except Exception as e:
        return False, f"UserSig check unexpected error: {type(e).__name__}: {e}"


def _ast_check_imports(scripts_dir: Path) -> list[str]:
    """AST scan: production scripts must not import from tests.*"""
    violations = []
    for py_file in scripts_dir.rglob("*.py"):
        try:
            tree = ast.parse(py_file.read_text())
        except SyntaxError:
            continue
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                for alias in node.names:
                    if alias.name.startswith("tests"):
                        violations.append(f"{py_file}:{node.lineno} import {alias.name}")
            elif isinstance(node, ast.ImportFrom):
                if node.module and node.module.startswith("tests"):
                    violations.append(f"{py_file}:{node.lineno} from {node.module}")
    return violations


def phase_pre_run() -> dict:
    """Pre-run environment and source hygiene checks."""
    results = {"phase": "pre-run", "checks": [], "passed": True}

    def check(name: str, ok: bool, detail: str = ""):
        results["checks"].append({"name": name, "ok": ok, "detail": detail})
        if not ok:
            results["passed"] = False

    # CLI available
    cli_ok = False
    for cli in ["claude-internal", "claude", "codebuddy"]:
        try:
            proc = subprocess.run([cli, "--version"], capture_output=True, check=False)
            if proc.returncode == 0:
                cli_ok = True
                break
        except (FileNotFoundError, PermissionError):
            continue
    check("cli_available", cli_ok, "claude-internal, claude, or codebuddy CLI must be installed")

    # Test account — now loaded via scripts.lib.eval_config (config.json
    # preferred, shell env as per-field fallback). A single failure here
    # points operators at config.example.json instead of leaving them
    # guessing which env var to export.
    try:
        from scripts.lib.eval_config import load_config, EvalConfigError
        try:
            cfg = load_config()
            sdk_app_id = cfg.trtc_test_account.sdk_app_id
            user_id = cfg.trtc_test_account.user_id
            user_sig = cfg.trtc_test_account.user_sig

            check("creds_sdk_app_id", sdk_app_id > 0,
                  "sdk_app_id must be a positive integer")
            check("creds_user_id", bool(user_id),
                  "user_id must be a non-empty string")
            check("creds_user_sig", bool(user_sig),
                  "user_sig must be a non-empty string")

            # UserSig expiry — must have >= 1h remaining to complete eval
            # Identity match — config user_id must equal TLS.identifier in sig
            sig_decoded = False
            sig_identifier = None
            sig_expires_str = None
            sig_remaining_h = None
            if user_sig:
                sig_ok, sig_detail = _check_user_sig_expiry(
                    user_sig, min_remaining_sec=3600,
                )
                check("creds_user_sig_not_expired", sig_ok, sig_detail)

                # Decode sig to extract TLS.identifier for identity match
                try:
                    tls_payload = _decode_user_sig(user_sig)
                    sig_decoded = True
                    sig_identifier = tls_payload.get("TLS.identifier", "")
                    tls_time = int(tls_payload["TLS.time"])
                    tls_expire = int(tls_payload["TLS.expire"])
                    expire_at = tls_time + tls_expire
                    sig_expires_str = time.strftime(
                        "%Y-%m-%d %H:%M", time.localtime(expire_at),
                    )
                    sig_remaining_h = max(0, (expire_at - int(time.time())) // 3600)

                    id_match = user_id == sig_identifier
                    check(
                        "creds_identity_match", id_match,
                        f"config user_id='{user_id}' vs "
                        f"sig TLS.identifier='{sig_identifier}'"
                    )
                except ValueError as e:
                    check("creds_identity_match", False,
                          f"cannot decode sig for identity check: {e}")

            check("creds_source", True, f"loaded via {cfg.source}")

            # ── Environment variable staleness check ──────────────
            # If $TRTC_TEST_USERSIG (or other cred env vars) exists in
            # the shell AND differs from config.json, the shell value is
            # almost certainly stale (leftover from a previous session).
            # Before the orchestrator fix, setdefault() let stale env
            # vars silently shadow config.json — causing all dynamic
            # evals to fail with "userSigExpired". Now the orchestrator
            # force-overwrites, but we still flag the mismatch so
            # operators are aware of the inconsistency.
            _cred_env_checks = [
                ("TRTC_TEST_SDKAPPID", str(sdk_app_id)),
                ("TRTC_TEST_USERID", user_id),
                ("TRTC_TEST_USERSIG", user_sig),
            ]
            for env_key, config_val in _cred_env_checks:
                env_val = os.environ.get(env_key, "")
                if env_val and config_val and env_val != config_val:
                    check(
                        f"creds_env_stale_{env_key.lower()}",
                        False,
                        f"${env_key} in shell differs from config.json. "
                        f"The orchestrator will use the config.json value, "
                        f"but consider running: unset {env_key}",
                    )
                else:
                    check(f"creds_env_stale_{env_key.lower()}", True,
                          f"no conflict for ${env_key}")

            # ── evidence_block ──────────────────────────────────────
            # Structured ground-truth for the Agent to quote verbatim.
            # Eliminates "stale context substitution" — the Agent never
            # needs to reformat credential fields from raw command output.
            sig_fingerprint = (
                f"{user_sig[:12]}...{user_sig[-4:]}"
                if user_sig and len(user_sig) > 16 else user_sig
            )
            results["evidence_block"] = {
                "sdk_app_id": sdk_app_id,
                "user_id": user_id,
                "user_sig_fingerprint": sig_fingerprint,
                "sig_identifier": sig_identifier,
                "sig_expires": sig_expires_str,
                "sig_remaining_h": sig_remaining_h,
                "identity_match": (
                    user_id == sig_identifier if sig_decoded else None
                ),
            }

        except EvalConfigError as e:
            check("creds_loadable", False, str(e))
    except Exception as e:  # pragma: no cover — defensive, import-time errors
        check("creds_module_importable", False, f"{type(e).__name__}: {e}")

    # cases.json exists and is valid JSON
    cases_path = skill_root() / "tests" / "benchmark" / "cases.json"
    if cases_path.exists():
        try:
            data = json.loads(cases_path.read_text())
            check("cases_json_valid", isinstance(data, list) and len(data) > 0)
        except json.JSONDecodeError as e:
            check("cases_json_valid", False, str(e))
    else:
        check("cases_json_exists", False, f"{cases_path} not found")

    # Source hygiene: grep for mock/fake/stub keywords (non-comment lines only)
    mock_pattern = r"MOCK|mock_|fake_|stub_|hardcoded_log|return_sample|read_fixture|FIXTURE_PATH|sample_logcat|sample_syslog"
    hits = _grep_in_scripts(mock_pattern)
    # Exclude selfcheck.py itself from this check
    hits = [h for h in hits if "selfcheck.py" not in h]
    check("source_no_mock_keywords", len(hits) == 0,
          f"Found mock keywords in: {hits}" if hits else "")

    # Source hygiene: no tests/unit references in production scripts
    path_hits = _grep_in_scripts(r"tests/unit|tests/benchmark/fixtures")
    path_hits = [h for h in path_hits if "selfcheck.py" not in h]
    check("source_no_fixture_paths", len(path_hits) == 0,
          f"Found fixture paths in: {path_hits}" if path_hits else "")

    # AST scan: no import tests
    import_violations = _ast_check_imports(skill_root() / "scripts")
    check("ast_no_test_imports", len(import_violations) == 0,
          f"Violations: {import_violations}" if import_violations else "")

    return results


def phase_post_run(run_dir: Path) -> dict:
    """Post-run three-gate validation."""
    results = {"phase": "post-run", "checks": [], "passed": True, "verdict": "OK"}

    def check(gate: str, name: str, ok: bool, detail: str = ""):
        results["checks"].append({"gate": gate, "name": name, "ok": ok, "detail": detail})
        if not ok:
            results["passed"] = False
            results["verdict"] = "TAINTED"

    cases_dir = run_dir / "cases"
    if not cases_dir.exists():
        check("A", "cases_dir_exists", False, f"{cases_dir} not found")
        return results

    fixture_dir = skill_root() / "tests" / "unit" / "fixtures"

    for case_path in sorted(cases_dir.iterdir()):
        if not case_path.is_dir():
            continue
        tid = case_path.name

        # Gate A: Artifact existence
        ai_output = case_path / "ai_raw_output.md"
        check("A", f"{tid}/ai_raw_output.md_exists",
              ai_output.exists() and ai_output.stat().st_size >= 200)

        compile_log = case_path / "compile.log"
        check("A", f"{tid}/compile.log_exists", compile_log.exists())

        runtime_log = case_path / "runtime.log"
        check("A", f"{tid}/runtime.log_exists", runtime_log.exists())

        summary = case_path / "summary.json"
        check("A", f"{tid}/summary.json_exists", summary.exists())

        # Gate B: Data authenticity (only if runtime.log exists and non-empty)
        if runtime_log.exists() and runtime_log.stat().st_size > 0:
            # Size > 100B
            check("B", f"{tid}/runtime_log_size", runtime_log.stat().st_size > 100)

            # SHA256 not equal to any fixture
            log_hash = hashlib.sha256(runtime_log.read_bytes()).hexdigest()
            if fixture_dir.exists():
                for fixture in fixture_dir.iterdir():
                    if fixture.is_file():
                        fix_hash = hashlib.sha256(fixture.read_bytes()).hexdigest()
                        check("B", f"{tid}/not_fixture_{fixture.name}",
                              log_hash != fix_hash,
                              "runtime.log SHA256 matches a fixture!")

            # Nonce check (Gate B strong Harness)
            trace_path = case_path / "trace.jsonl"
            if trace_path.exists():
                first_line = trace_path.read_text().splitlines()[0]
                meta = json.loads(first_line)
                nonce = meta.get("nonce", "")
                if nonce:
                    marker = f"TRTC_EVAL_NONCE={nonce}"
                    log_content = runtime_log.read_text(errors="replace")
                    check("B", f"{tid}/nonce_present", marker in log_content,
                          "EVAL_RUN_NONCE not found in runtime.log")

        # Gate C: Flow completeness
        trace_path = case_path / "trace.jsonl"
        if trace_path.exists():
            lines = trace_path.read_text().strip().splitlines()
            steps = []
            for line in lines:
                step_data = json.loads(line)
                steps.append(step_data["step"])

            check("C", f"{tid}/trace_has_meta", steps[0] == "_meta" if steps else False)

            expected_order = [
                "run_ai", "evaluator", "demo_build",
                "log_stream_start", "demo_run", "log_stream_stop", "runtime_monitor",
            ]
            actual_main_steps = [s for s in steps if s != "_meta"]
            check("C", f"{tid}/trace_7_steps",
                  len(actual_main_steps) == 7,
                  f"Expected 7 steps, got {len(actual_main_steps)}")
            check("C", f"{tid}/trace_order",
                  actual_main_steps == expected_order,
                  f"Order mismatch: {actual_main_steps}")

            # Nonce in _meta is 32-char hex
            if steps and steps[0] == "_meta":
                meta = json.loads(lines[0])
                nonce_val = meta.get("nonce", "")
                check("C", f"{tid}/nonce_format",
                      len(nonce_val) == 32 and all(c in "0123456789abcdef" for c in nonce_val))
        else:
            check("C", f"{tid}/trace_exists", False, "trace.jsonl missing")

        # Gate D: Injection completeness — if AI produced any code,
        # injection_diff.txt MUST be non-empty. Catches the case where
        # cases.json is misconfigured or default routing fails silently.
        ai_code_dir = case_path / "ai_extracted_code"
        if ai_code_dir.exists() and any(ai_code_dir.iterdir()):
            diff_path = case_path / "workspace" / ".eval-meta" / "injection_diff.txt"
            check("D", f"{tid}/injection_diff_nonempty",
                  diff_path.exists() and diff_path.stat().st_size > 0,
                  "AI produced code but injection_diff.txt empty/missing")

    # Scoreboard row count
    scoreboard = run_dir / "scoreboard.csv"
    if scoreboard.exists():
        with open(scoreboard) as f:
            row_count = sum(1 for _ in f) - 1  # minus header
        case_count = sum(1 for p in cases_dir.iterdir() if p.is_dir())
        check("C", "scoreboard_row_count", row_count == case_count,
              f"scoreboard has {row_count} rows but {case_count} cases")

    return results


def phase_cases_lint() -> dict:
    """Validate cases.json schema and consistency."""
    results = {"phase": "cases-lint", "checks": [], "passed": True}

    def check(name: str, ok: bool, detail: str = ""):
        results["checks"].append({"name": name, "ok": ok, "detail": detail})
        if not ok:
            results["passed"] = False

    cases_path = skill_root() / "tests" / "benchmark" / "cases.json"
    if not cases_path.exists():
        check("file_exists", False)
        return results

    try:
        data = json.loads(cases_path.read_text())
    except json.JSONDecodeError as e:
        check("json_valid", False, str(e))
        return results

    check("is_list", isinstance(data, list))

    # Unique test_ids
    ids = [c.get("test_id", "") for c in data]
    check("unique_ids", len(ids) == len(set(ids)),
          f"Duplicate IDs: {[x for x in ids if ids.count(x) > 1]}")

    for case in data:
        tid = case.get("test_id", "unknown")
        # must_include and must_not_include no intersection
        mi = set(case.get("constraints", {}).get("must_include", []))
        mni = set(case.get("constraints", {}).get("must_not_include", []))
        intersection = mi & mni
        check(f"{tid}/no_constraint_overlap", len(intersection) == 0,
              f"Overlap: {intersection}" if intersection else "")

    # ---------------------------------------------------------------
    # DSL well-formedness: every web case's auto_run_flow must parse,
    # and every builtin id it references (via depends_on or as a legacy
    # list[str] entry) must have a matching <id>.ts in _builtin/.
    #
    # Catching these here means a typo like
    #   "auto_run_flow": ["loginn"]
    # fails selfcheck in milliseconds instead of after the case spends
    # 60 seconds in HeadlessChrome only to log
    # `Unknown EVAL_AUTO_RUN_FLOW: loginn`.
    # ---------------------------------------------------------------
    try:
        from scripts.lib.schemas import AutoRunFlow, Case
    except Exception as e:  # pragma: no cover — unreachable when install OK
        check("dsl/import_schema", False, f"cannot import schemas: {e}")
        return results

    builtin_dir = (
        skill_root() / "templates" / "web-demo" / "src" / "autorun" / "_builtin"
    )
    builtins_present: set[str] = set()
    if builtin_dir.is_dir():
        builtins_present = {p.stem for p in builtin_dir.glob("*.ts")}
    check(
        "dsl/builtin_dir_exists",
        builtin_dir.is_dir(),
        f"missing {builtin_dir}",
    )

    for case_raw in data:
        tid = case_raw.get("test_id", "unknown")
        if case_raw.get("platform") != "web":
            continue
        try:
            case = Case.model_validate(case_raw)
        except Exception as e:
            check(f"{tid}/dsl_parse", False, str(e).splitlines()[0])
            continue
        check(f"{tid}/dsl_parse", True)

        # Collect builtin ids the case references.
        # Note: auto_run_flow may be [] (empty list) for "optimizer v2" cases
        # that rely on AI-generated evalAutoRun instead of DSL flows. This is
        # valid and produces no referenced builtins to check.
        flow = case.auto_run_flow
        referenced: list[str] = []
        if isinstance(flow, AutoRunFlow):
            referenced.extend(flow.depends_on)
        elif isinstance(flow, list):
            referenced.extend(flow)

        missing = [bid for bid in referenced if bid not in builtins_present]
        check(
            f"{tid}/dsl_builtins_resolve",
            not missing,
            f"depends_on/list refers to missing builtin .ts: {missing}"
            if missing else "",
        )

    return results


def main() -> int:
    ap = argparse.ArgumentParser(description="Quality self-check")
    ap.add_argument("--phase", required=True,
                    choices=["pre-run", "post-run", "cases-lint"])
    ap.add_argument("--run-dir", default=None, help="Required for post-run")
    args = ap.parse_args()

    if args.phase == "pre-run":
        result = phase_pre_run()
    elif args.phase == "post-run":
        if not args.run_dir:
            print("ERROR: --run-dir required for post-run", file=sys.stderr)
            return 1
        result = phase_post_run(Path(args.run_dir).resolve())
    elif args.phase == "cases-lint":
        result = phase_cases_lint()
    else:
        return 1

    # Write result
    output_path = None
    if args.run_dir:
        output_path = Path(args.run_dir).resolve() / "selfcheck.json"
    elif args.phase == "pre-run":
        output_path = repo_root() / ".claude" / "eval-runs" / "selfcheck_prerun.json"
        output_path.parent.mkdir(parents=True, exist_ok=True)

    output = json.dumps(result, indent=2, ensure_ascii=False)
    if output_path:
        output_path.write_text(output)

    # Print summary
    print(output, file=sys.stderr)

    return 0 if result["passed"] else 1


if __name__ == "__main__":
    sys.exit(main())
