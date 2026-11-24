"""demo_runner.py — Thin orchestration: parse --phase and dispatch.

Does NOT write trace.jsonl (orchestrator only).
Does NOT generate EVAL_RUN_NONCE (reads from env, exits 3 if missing).
Does NOT capture logs (that's log_streamer.py's job).
"""
import argparse
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from scripts.lib import template_fetcher, code_injector, builder, device_picker, launcher, dep_installer
from scripts.lib import creds_normalizer
from scripts.lib.eval_config import skill_root, load_config, EvalConfigError
from scripts.lib.platforms import get_adapter
from scripts.lib.schemas import Case


def _load_case(case_id: str) -> Case:
    cases = json.loads((skill_root() / "tests" / "benchmark" / "cases.json").read_text())
    raw = next((c for c in cases if c["test_id"] == case_id), None)
    if raw is None:
        raise ValueError(f"case-id '{case_id}' not found")
    return Case(**raw)


def main() -> int:
    ap = argparse.ArgumentParser(description="Demo build/run dispatcher")
    ap.add_argument("--case-id", required=True)
    ap.add_argument("--run-dir", required=True)
    ap.add_argument("--phase", required=True, choices=["build", "run"])
    args = ap.parse_args()

    if "EVAL_RUN_NONCE" not in os.environ:
        print(json.dumps({"error": "EVAL_RUN_NONCE missing in env"}), file=sys.stderr)
        return 3

    case = _load_case(args.case_id)
    case_dir = Path(args.run_dir).resolve() / "cases" / case.test_id
    case_dir.mkdir(parents=True, exist_ok=True)
    workspace = case_dir / "workspace"
    adapter = get_adapter(case.platform)

    if args.phase == "build":
        template_fetcher.copy_template(case.platform, case_dir, skill_root() / "templates")

        # Web: apply framework profile BEFORE injection so main.ts / vite.config
        # reflect the target framework, and so `npm ci` picks up vue/react deps.
        # Framework is auto-detected from AI output (vue SFC → vue3, JSX → react, etc.)
        framework: str | None = None
        if case.platform == "web":
            from scripts.lib import web_profile
            framework = web_profile.detect_web_framework(
                case_dir / "ai_extracted_code"
            )
            web_profile.apply_web_profile(workspace, framework)
            meta = workspace / ".eval-meta"
            meta.mkdir(exist_ok=True)
            (meta / "framework.txt").write_text(framework)

        code_injector.inject(
            workspace=workspace,
            ai_code_dir=case_dir / "ai_extracted_code",
            injection_map=case.demo_injection_map,
            platform=case.platform,
            framework=framework,
            case_dir=case_dir,
        )

        # Generate the autorun .ts files for this case from the DSL
        # (templates/web-demo/src/autorun/ now ships only _runtime.ts and
        # _builtin/<id>.ts; case-specific flows are rendered into the
        # workspace at build time so cases.json is the single source of
        # truth). Web only — autorun is a browser-side concept.
        #
        # Optimizer v2: when auto_run_flow is an empty list [], the AI is
        # expected to self-drive via eval-autorun.ts (registered as
        # window.__evalAutoRun). Skip flow_codegen in that case — there is
        # no DSL to compile, and the autoRunCoordinator is not needed.
        if case.platform == "web":
            flow_ids = case.autorun_flow_ids()
            if flow_ids:
                from scripts.lib import flow_codegen
                flow_codegen.generate(
                    case=case,
                    workspace=workspace,
                    builtin_root=skill_root() / "templates/web-demo/src/autorun/_builtin",
                )
            else:
                # Self-driven mode: still need a minimal autoRunCoordinator
                # stub so the template's main.ts can import it without build
                # errors. The actual execution is driven by __evalAutoRun.
                autorun_dir = workspace / "src" / "autorun"
                autorun_dir.mkdir(parents=True, exist_ok=True)
                (autorun_dir / "autoRunCoordinator.ts").write_text(
                    '// Stub for self-driven eval mode (optimizer v2).\n'
                    '// The AI-generated eval-autorun.ts drives execution via window.__evalAutoRun.\n'
                    'export async function runAutoFlow(_flowIds: string): Promise<void> {\n'
                    '  // No DSL flows configured — self-driven mode.\n'
                    '  // log-bridge will detect window.__evalAutoRun and invoke it.\n'
                    '}\n'
                )

        # Credential normalization (web only, post-injection):
        # AI code typically writes literal placeholders like
        #   sdkAppId: 1400000000, userId: 'user_001', userSig: 'YOUR_USERSIG'
        # straight from slice examples. log-bridge already exposes the test
        # account via VITE_TRTC_TEST_*, but AI doesn't know about that
        # convention and shouldn't be coerced into knowing — it would pollute
        # the slice's "userSig must be backend-issued" guidance.
        # We rewrite those placeholders inside workspace/src/generated/ so the
        # built app actually authenticates. ai_extracted_code/ is left alone
        # so static evaluation continues to score the AI's real output.
        if case.platform == "web":
            try:
                eval_cfg = load_config()
                norm = creds_normalizer.normalize_creds_in_workspace(
                    workspace=workspace,
                    account=eval_cfg.trtc_test_account,
                )
                (case_dir / "creds_normalization.json").write_text(
                    json.dumps(norm, indent=2, ensure_ascii=False)
                )
            except EvalConfigError as e:
                # Missing creds is fatal for any meaningful dynamic eval, but
                # we surface it as a build error rather than crashing here so
                # the orchestrator records a clean failure.
                print(json.dumps({
                    "phase": "build", "exit_code": 7,
                    "error": "creds_unavailable", "detail": str(e),
                }))
                return 7

        # Install dependencies declared by AI (e.g., CocoaPods)
        dep_file = case_dir / "dependencies.json"
        if dep_file.exists():
            dep_rc = dep_installer.install(
                platform=case.platform,
                workspace=workspace,
                dep_file=dep_file,
                log_dir=case_dir,
            )
            if dep_rc != 0:
                print(json.dumps({"phase": "build", "exit_code": dep_rc, "error": "dep_install_failed"}))
                return dep_rc
        rc = builder.build(adapter, workspace, compile_log=case_dir / "compile.log")
        print(json.dumps({"phase": "build", "exit_code": rc, "compile_log": "compile.log"}))
        return rc

    if args.phase == "run":
        device = device_picker.pick(
            case.platform,
            os.environ.get("EVAL_DEVICE_POLICY", "prefer-simulator"),
        )
        if device is None:
            print(json.dumps({"error": "no device available"}), file=sys.stderr)
            return 4
        # Ensure simulator is booted before install/launch
        boot_rc = adapter.ensure_booted(device)
        if boot_rc != 0:
            print(json.dumps({"error": "failed to boot device", "exit_code": boot_rc}), file=sys.stderr)
            return 5
        rc = launcher.run(
            adapter=adapter,
            workspace=workspace,
            device=device,
            nonce=os.environ["EVAL_RUN_NONCE"],
            duration_sec=int(os.environ.get("EVAL_RUN_DURATION_SEC", "60")),
        )
        print(json.dumps({
            "phase": "run", "exit_code": rc,
            "device_kind": device.kind, "device_id": device.id,
        }))
        return rc

    return 1


if __name__ == "__main__":
    sys.exit(main())
