"""Shared TRTC apply tool.

Default CLI contract:

    python3 -m tools.apply --slice <slice_id>
    python3 -m tools.apply --unit <unit_id>
    python3 -m tools.apply --slice <slice_id> --product <product> --platform <platform>

This default mode is topic-facing: it runs the shared apply gate, advances the
state machine on pass/fail, writes evidence, and prints the human-readable
result expected by the topic loop. Exit codes match the legacy topic wrapper:

    0 - apply pass
    1 - apply fail
    2 - usage / orchestration error

Raw JSON contract:

    python3 -m tools.apply --json --slice <slice_id>

`--json` exposes the shared-tool contract directly. It emits structured JSON
(``status`` = ``passed`` / ``failed`` / ``usage_error`` / ``dependency_error`` /
``internal_error``) and does NOT mutate the topic state machine; orchestration
layers are responsible for reading ``state_transition_suggested`` and advancing
session state themselves.

Plugin discovery: for each product, the dispatcher looks for
    skills/trtc-{product}/tools/apply_checks.py
and calls its ``build_checks(target_id, slice_ids, project_root, platform)`` function.
If no checker is found, the tool passes with empty checks (no-checker mode).
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

try:
    import yaml
except Exception as exc:  # pragma: no cover
    yaml = None  # type: ignore[assignment]
    _YAML_IMPORT_ERROR = exc
else:
    _YAML_IMPORT_ERROR = None


EXIT_SUCCESS = 0
EXIT_INPUT_ERROR = 1
EXIT_DEPENDENCY_ERROR = 2
EXIT_INTERNAL_ERROR = 3

# Product names must be simple lowercase identifiers to prevent path traversal.
_PRODUCT_RE = re.compile(r"^[a-z0-9][a-z0-9-]*$")

_REPO_ROOT = Path(__file__).resolve().parents[3]
_STATE_MACHINE_DIR = _REPO_ROOT / "skills" / "trtc" / "tools" / "lib"

_STATE_MACHINE_IMPORT_ERROR: Exception | None = None
try:
    sys.path.insert(0, str(_STATE_MACHINE_DIR))
    import state_machine  # noqa: E402
except ImportError as exc:  # pragma: no cover
    state_machine = None  # type: ignore[assignment]
    _STATE_MACHINE_IMPORT_ERROR = exc
finally:
    try:
        sys.path.remove(str(_STATE_MACHINE_DIR))
    except ValueError:  # pragma: no cover
        pass


class InputError(RuntimeError):
    """Invalid CLI / session input."""


class DependencyError(RuntimeError):
    """Local dependency / import failure."""


def _utc_now_z() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _resolve_session_path() -> Path:
    explicit = os.environ.get("TRTC_SESSION_PATH")
    if explicit:
        return Path(explicit)
    for _key in ("TRTC_PROJECT_ROOT", "CLAUDE_PROJECT_DIR",
                 "CODEBUDDY_PROJECT_DIR", "CURSOR_PROJECT_DIR"):
        project_dir = os.environ.get(_key)
        if project_dir:
            return Path(project_dir) / ".trtc-session.yaml"
    return Path.cwd() / ".trtc-session.yaml"


def _slice_id_to_slug(slice_id: str) -> str:
    return slice_id.replace("/", "__")


def _load_session(session_path: Path) -> dict:
    if yaml is None:
        raise DependencyError(f"PyYAML import failed: {_YAML_IMPORT_ERROR}")
    return yaml.safe_load(session_path.read_text()) or {}


def _ensure_dependencies() -> None:
    if yaml is None:
        raise DependencyError(f"PyYAML import failed: {_YAML_IMPORT_ERROR}")
    if _STATE_MACHINE_IMPORT_ERROR is not None:
        raise DependencyError(str(_STATE_MACHINE_IMPORT_ERROR))


def _load_product_checker(product: str) -> tuple:
    """Dynamically load skills/trtc-{product}/tools/apply_checks.py.

    Returns (module, None) if found and loadable.
    Returns (None, None) if no checker file exists — this is the normal
    no-checker case (product does not yet have apply verification).
    Returns (None, error_str) if the file EXISTS but is broken (syntax error,
    import error, missing build_checks, etc.) — callers must treat this as a
    hard error, not a silent pass.
    """
    if not _PRODUCT_RE.match(product):
        return None, f"invalid product name '{product}': must match [a-z0-9][a-z0-9-]*"
    checker_path = _REPO_ROOT / "skills" / f"trtc-{product}" / "tools" / "apply_checks.py"
    # Guard against path traversal after Path resolution (e.g. symlinks).
    expected_parent = (_REPO_ROOT / "skills").resolve()
    try:
        checker_path.resolve().relative_to(expected_parent)
    except ValueError:
        return None, f"checker path for '{product}' escapes expected directory"
    if not checker_path.exists():
        return None, None  # normal: no checker for this product
    spec = importlib.util.spec_from_file_location(f"_apply_checks_{product}", checker_path)
    if spec is None or spec.loader is None:  # pragma: no cover
        return None, f"could not create import spec for {checker_path}"
    module = importlib.util.module_from_spec(spec)
    try:
        spec.loader.exec_module(module)  # type: ignore[union-attr]
    except Exception as exc:
        return None, f"apply_checks.py failed to load: {exc}"
    if not callable(getattr(module, "build_checks", None)):
        return None, f"apply_checks.py for '{product}' is missing required build_checks() function"
    return module, None


def _product_from_target(target_id: str, slice_ids: list[str]) -> str | None:
    """Infer product from target_id / slice_ids prefix (the part before '/').

    Returns the inferred product name if all IDs share the same prefix, or
    None if no ID contains '/' (target_id is a bare unit name with no
    associated slice_ids — no inference possible; validation skipped).
    Raises InputError if:
      - any slice_id lacks '/' (malformed / hand-edited session)
      - IDs span multiple product prefixes (mixed-product unit)
    """
    malformed = [sid for sid in slice_ids if "/" not in sid]
    if malformed:
        raise InputError(
            f"malformed slice id(s): {', '.join(repr(s) for s in malformed)}; "
            "slice ids must be in 'product/slug' format"
        )
    ids = [target_id] + list(slice_ids)
    prefixes = {sid.split("/")[0] for sid in ids if "/" in sid}
    if len(prefixes) > 1:
        raise InputError(
            f"mixed-product unit: slices span multiple products "
            f"({', '.join(sorted(prefixes))}); all slices in a unit must belong to the same product"
        )
    return prefixes.pop() if len(prefixes) == 1 else None


def _resolve_target(scope: dict, slice_id: str | None, unit_id: str | None) -> tuple[str, str, list[str]]:
    if not scope.get("initialised"):
        raise InputError("execution_queue not initialised")
    if scope.get("state") != "code_written":
        raise InputError(
            f"current_execution_state must be 'code_written' before apply; got '{scope.get('state')}'"
        )
    current_id = scope.get("id")
    current_kind = scope.get("kind")
    slice_ids = list(scope.get("slice_ids") or [])
    if current_kind == "unit":
        if not unit_id:
            raise InputError(f"current execution step is unit '{current_id}'; use --unit {current_id}")
        if unit_id != current_id:
            raise InputError(f"--unit '{unit_id}' does not match current unit '{current_id}'")
        return "unit", current_id, slice_ids

    if not slice_id:
        raise InputError(f"current execution step is slice '{current_id}'; use --slice {current_id}")
    if slice_id != current_id:
        raise InputError(f"--slice '{slice_id}' does not match current slice '{current_id}'")
    return "slice", current_id, slice_ids


def _resolve_product_platform(session_data: dict, product: str | None, platform: str | None) -> tuple[str, str]:
    resolved_product = product or session_data.get("product")
    resolved_platform = platform or session_data.get("platform")
    if not resolved_product:
        raise InputError("product is missing; pass --product or populate session.product")
    if not resolved_platform:
        raise InputError("platform is missing; pass --platform or populate session.platform")
    return str(resolved_product), str(resolved_platform)


def _resolve_project_root(session_data: dict, project_root: Path | None) -> Path:
    if project_root is not None:
        return project_root
    raw = (session_data.get("project_state") or {}).get("project_root")
    if not raw:
        raise InputError("project root missing; pass --project or populate session.project_state.project_root")
    return Path(raw)


def _write_evidence(session_path: Path, target_id: str, payload: dict) -> str:
    evidence_dir = session_path.parent / ".trtc-apply-evidence"
    evidence_dir.mkdir(parents=True, exist_ok=True)
    relative_path = f".trtc-apply-evidence/{_slice_id_to_slug(target_id)}.json"
    (session_path.parent / relative_path).write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return relative_path


def _build_parser(*, include_json: bool = False) -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--slice", dest="slice_id", default=None)
    parser.add_argument("--unit", dest="unit_id", default=None)
    parser.add_argument("--product", default=None)
    parser.add_argument("--platform", default=None)
    parser.add_argument("--session", type=Path, default=None)
    parser.add_argument("--project", type=Path, default=None)
    parser.add_argument("--dry-run", action="store_true")
    if include_json:
        parser.add_argument("--json", action="store_true")
    return parser


def _count_entry_checks(shared_checks: list[dict]) -> int:
    return sum(1 for check in shared_checks if check.get("id") == "entry_symbol_present")


def _failed_checks(shared_checks: list[dict]) -> list[dict]:
    return [check for check in shared_checks if check.get("status") == "failed"]


_BD_REGISTRY: frozenset[str] = frozenset({
    "conference/login-auth",
    "conference/room-lifecycle",
    "conference/participant-management",
    "conference/room-call",
    "conference/room-schedule",
})

_BD_NAMES: dict[str, str] = {
    "conference/login-auth":             "登录与鉴权",
    "conference/room-lifecycle":         "房间生命周期",
    "conference/participant-management": "会控 / 成员管理",
    "conference/room-call":              "通话",
    "conference/room-schedule":          "会议预约",
}


def _check_conference_business_decisions(
    session: dict,
    slice_ids: list[str],
    target_id: str,
    scope_name: str,
    session_path: "Path",
) -> "tuple[int, dict] | None":
    """Return a failure result if conference business_decisions are missing, else None."""
    if session.get("active_domain_skill") != "trtc-conference":
        return None
    if session.get("active_flow") != "topic":
        return None
    if session.get("integration_path") in {"medical-quickstart", "official-roomkit"}:
        return None

    bd: dict = (session.get("session_context") or {}).get("business_decisions") or {}
    missing = [s for s in slice_ids if s in _BD_REGISTRY and not bd.get(s)]
    if not missing:
        return None

    missing_names = "、".join(_BD_NAMES.get(s, s) for s in missing)
    check = {
        "status": "failed",
        "summary": (
            f"[business-decisions] BLOCKED — do not show this message verbatim to the user. "
            f"Business configuration not collected for: {missing_names}. "
            f"Recovery: return to the business configuration step, ask the user the pending "
            f"questions for these modules, then re-run apply. "
            f"Do NOT show internal field names to the user. Say instead: "
            f"「在生成代码之前，还有关于「{missing_names}」的几个配置问题需要确认。」"
        ),
        "detail": f"missing business_decisions for registry slices: {missing}",
    }
    result = {
        "status": "failed",
        "scope": scope_name,
        "target_id": target_id,
        "shared_checks": [check],
        "state_transition_suggested": {"from": "code_written", "to": "apply_failed"},
        "evidence_path": None,
        "debug": {"mode": "business-decisions-pre-check", "missing_slices": missing, "session_path": str(session_path)},
    }
    return 1, result


def _run_parsed(args: argparse.Namespace) -> tuple[int, dict]:
    _ensure_dependencies()

    if bool(args.slice_id) == bool(args.unit_id):
        raise InputError("provide exactly one of --slice <slice_id> or --unit <unit_id>")

    session_path = args.session if args.session is not None else _resolve_session_path()
    if not session_path.exists():
        raise InputError(
            f"session file not found: {session_path}; cd to the user project root or set TRTC_SESSION_PATH / TRTC_PROJECT_ROOT (or CLAUDE_PROJECT_DIR / CODEBUDDY_PROJECT_DIR / CURSOR_PROJECT_DIR)"
        )

    session_data = _load_session(session_path)
    scope = state_machine.current_scope(session_path)
    scope_name, target_id, slice_ids = _resolve_target(scope, args.slice_id, args.unit_id)
    product, platform = _resolve_product_platform(session_data, args.product, args.platform)
    project_root = _resolve_project_root(session_data, args.project)

    # Cross-validate: if all slice/unit IDs share a product prefix, it must
    # match the supplied product.  Mismatches indicate a caller passing
    # --product chat while running conference slices, which would silently
    # bypass all conference checks via the no-checker path.
    inferred_product = _product_from_target(target_id, slice_ids)
    if inferred_product and inferred_product != product:
        raise InputError(
            f"product mismatch: --product '{product}' was supplied but "
            f"target '{target_id}' belongs to product '{inferred_product}'"
        )

    # Conference-specific pre-check: block if registry slice has no business_decisions.
    # This is a second enforcement layer — the PreToolUse hook is the first.
    bd_block = _check_conference_business_decisions(session_data, slice_ids, target_id, scope_name, session_path)
    if bd_block is not None:
        return bd_block

    # Plugin dispatch: load product-specific checks if available.
    checker, checker_error = _load_product_checker(product)
    if checker_error is not None:
        # Checker file exists but is broken — hard error, do not silently pass.
        raise DependencyError(checker_error)
    if checker is not None:
        status, shared_checks, debug_checks = checker.build_checks(
            target_id, slice_ids, project_root, platform
        )
    else:
        # No apply_checks.py for this product yet — pass with an informational note.
        status = "passed"
        shared_checks = []
        debug_checks = {
            "mode": "no-checker",
            "files_scanned": 0,
            "slice_results": [],
            "issues": [],
            "note": f"no apply_checks.py found for product '{product}'; content checks skipped",
        }

    state_transition = {
        "from": "code_written",
        "to": "apply_passed" if status == "passed" else "apply_failed",
    }
    result = {
        "status": status,
        "scope": scope_name,
        "target_id": target_id,
        "shared_checks": shared_checks,
        "state_transition_suggested": state_transition,
        "evidence_path": None,
        "debug": {
            "project_root": str(project_root),
            "product": product,
            "platform": platform,
            "session_path": str(session_path),
            "dry_run": bool(args.dry_run),
            **debug_checks,
        },
    }

    if not args.dry_run:
        evidence_payload = {
            "schema_version": 1,
            "target_id": target_id,
            "scope": scope_name,
            "status": status,
            "checked_at": _utc_now_z(),
            "shared_checks": shared_checks,
            "product_checks": [],
            # Legacy compat fields — consumers must not depend on these.
            # See debug.legacy_field_notice.
            "slice_id": slice_ids[0] if scope_name == "slice" else None,
            "unit_id": target_id if scope_name == "unit" else None,
            "slice_ids": slice_ids,
            "kind": scope_name,
            "mode": debug_checks.get("mode", "unknown"),
            "issues": debug_checks.get("issues", []),
            "debug": {
                "legacy_field_notice": (
                    "slice_id/unit_id/slice_ids/kind/mode/issues are compat fields. "
                    "Use target_id + scope for new consumers."
                ),
                "project_root": str(project_root),
                "product": product,
                "platform": platform,
                **{k: v for k, v in debug_checks.items() if k != "issues"},
            },
        }
        result["evidence_path"] = _write_evidence(session_path, target_id, evidence_payload)

    return EXIT_SUCCESS, result


def run(argv: list[str] | None = None) -> tuple[int, dict]:
    args = _build_parser().parse_args(argv)
    return _run_parsed(args)


def _error_payload(status: str, reason: str) -> dict:
    return {
        "status": status,
        "scope": None,
        "target_id": None,
        "shared_checks": [],
        "state_transition_suggested": None,
        "evidence_path": None,
        "reason": reason,
    }


def _transition_name(payload: dict) -> str:
    transition = payload.get("state_transition_suggested") or {}
    next_state_name = transition.get("to")
    if next_state_name == "apply_passed":
        return "mark_apply_passed"
    if next_state_name == "apply_failed":
        return "mark_apply_failed"
    raise RuntimeError(f"unsupported state transition suggestion: {transition}")


def _advance_human_cli(payload: dict, *, dry_run: bool) -> int:
    status = payload["status"]
    target_id = payload["target_id"]
    shared_checks = payload.get("shared_checks") or []
    session_path = Path(payload["debug"]["session_path"])

    if not dry_run:
        state_machine.advance(session_path, _transition_name(payload))

    if status == "passed":
        entries_checked = _count_entry_checks(shared_checks)
        if dry_run:
            print(
                f"apply pass (dry-run): {entries_checked} slice "
                f"entr{'y' if entries_checked == 1 else 'ies'} wired up for {target_id}"
            )
            return 0

        session_data = _load_session(session_path)
        policy = session_data.get("auto_advance_policy")
        if policy in {"pause_on_failure", "pause_at_end"}:
            new_state = state_machine.advance(session_path, "mark_user_confirmed")
            print(
                f"apply pass: {entries_checked} slice entr"
                f"{'y' if entries_checked == 1 else 'ies'} wired up for "
                f"{target_id} — auto-advanced ({policy}); next state: {new_state}"
            )
            if new_state == "all_done":
                print("")
                print("=" * 60)
                print("ALL SLICES COMPLETE — POST-LOOP CHECKLIST (mandatory)")
                print("=" * 60)
                print("The slice loop is finished, but the topic flow is NOT done.")
                print("You MUST now execute these steps from topic/SKILL.md:")
                print("")
                print("  □ Step 4: Present the verification checklist to the user")
                print("  □ Step 4.5: Offer runtime verification & telemetry")
                print("             (ask consent if telemetry.opted_in is null)")
                print("")
                print("Do NOT output a final summary and stop. Read topic/SKILL.md")
                print("Step 4 and Step 4.5 sections and execute them now.")
                print("=" * 60)
            return 0
        print(
            f"apply pass: {entries_checked} slice entr"
            f"{'y' if entries_checked == 1 else 'ies'} wired up for {target_id}"
        )
        return 0

    failed_checks = _failed_checks(shared_checks)
    if dry_run:
        print(f"apply fail (dry-run): {len(failed_checks)} shared check(s) failed for {target_id}")
        return 1

    print(f"apply fail: {len(failed_checks)} shared check(s) failed for {target_id}")
    for check in failed_checks[:5]:
        print(f"  - {check.get('summary', '')[:160]}")
    return 1


def main(argv: list[str] | None = None) -> int:
    args = _build_parser(include_json=True).parse_args(argv)
    try:
        exit_code, payload = _run_parsed(args)
        if args.json:
            print(json.dumps(payload, ensure_ascii=False))
            return exit_code
        return _advance_human_cli(payload, dry_run=bool(args.dry_run))
    except InputError as exc:
        if args.json:
            print(json.dumps(_error_payload("usage_error", str(exc)), ensure_ascii=False))
            return EXIT_INPUT_ERROR
        print(f"error: {exc}", file=sys.stderr)
        return 2
    except DependencyError as exc:
        if args.json:
            print(json.dumps(_error_payload("dependency_error", str(exc)), ensure_ascii=False))
            return EXIT_DEPENDENCY_ERROR
        print(f"error: {exc}", file=sys.stderr)
        return 2
    except Exception as exc:  # pragma: no cover
        if args.json:
            print(json.dumps(_error_payload("internal_error", str(exc)), ensure_ascii=False))
            return EXIT_INTERNAL_ERROR
        print(f"error: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
