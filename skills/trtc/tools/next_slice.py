#!/usr/bin/env python3
"""next_slice.py — Query and advance the execution cursor.

The topic skill drives one execution step at a time by calling this between
steps. An execution step may be one slice or one delivery unit containing
multiple slices.

Usage:
    python3 next_slice.py status                    # print current cursor
    python3 next_slice.py advance <transition>      # apply a transition

Transitions (see state_machine.py for the diagram):
    mark_slice_read       not_started   → slice_read
    mark_code_written     slice_read    → code_written
                          apply_failed  → code_written  (retry)
    mark_apply_passed     code_written  → apply_passed
    mark_apply_failed     code_written  → apply_failed
    mark_user_confirmed   apply_passed  → next execution step (or all_done)

Both subcommands print a one-line summary on stdout and exit 0 on success.
On any error (illegal transition, queue not initialised, etc.) prints to
stderr and exits 1 — topic should treat that as "abort the current step".

Optional flags:
    --session PATH    explicit session file path (overrides env-based resolver)
    --json            emit machine-readable JSON instead of the human line

Session path resolution (when --session not given):
    1. $TRTC_SESSION_PATH env var
    2. <projectRoot>/.trtc-session.yaml resolved via one of the IDE project-root env vars:
       $TRTC_PROJECT_ROOT | $CLAUDE_PROJECT_DIR | $CODEBUDDY_PROJECT_DIR |
       $CURSOR_PROJECT_DIR (first non-empty wins)
    3. ./.trtc-session.yaml (cwd fallback)
"""
from __future__ import annotations

import argparse
import json as jsonlib
import os
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent.parent.parent))

from skills.trtc.tools import state_machine  # noqa: E402


def _resolve_session_path() -> Path:
    """Match the resolver used by guardrails/gate_*.py."""
    explicit = os.environ.get("TRTC_SESSION_PATH")
    if explicit:
        return Path(explicit)
    for _key in ("TRTC_PROJECT_ROOT", "CLAUDE_PROJECT_DIR",
                 "CODEBUDDY_PROJECT_DIR", "CURSOR_PROJECT_DIR"):
        project_dir = os.environ.get(_key)
        if project_dir:
            return Path(project_dir) / ".trtc-session.yaml"
    return Path.cwd() / ".trtc-session.yaml"


def _print_status(session_path: Path, as_json: bool) -> int:
    st = state_machine.status(session_path)
    if as_json:
        print(jsonlib.dumps(st, ensure_ascii=False))
        return 0
    if not st.get("initialised"):
        print(f"queue not initialised: {st.get('reason')}")
        return 0
    kind = st.get("kind", "slice")
    cur = st.get("current_unit_id") or st.get("current_slice_id")
    detail = ""
    if kind == "unit":
        detail = f" ({', '.join(st.get('slice_ids') or [])})"
    print(f"[{st['index']}/{st['total']}] {kind}:{cur}{detail} :: {st['state']}")
    return 0


def _do_advance(session_path: Path, transition: str, as_json: bool) -> int:
    try:
        new_state = state_machine.advance(session_path, transition)
    except state_machine.StateMachineError as exc:
        if as_json:
            print(jsonlib.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False))
        else:
            print(f"error: {exc}", file=sys.stderr)
        return 1

    st = state_machine.status(session_path)
    if as_json:
        payload = {
            "ok": True,
            "transition": transition,
            "new_state": new_state,
            "index": st["index"],
            "current_slice_id": st["current_slice_id"],
            "current_unit_id": st.get("current_unit_id"),
            "kind": st.get("kind", "slice"),
            "slice_ids": st.get("slice_ids") or [],
        }
        print(jsonlib.dumps(payload, ensure_ascii=False))
    else:
        cur = st.get("current_unit_id") or st["current_slice_id"] or "(none)"
        print(
            f"{transition} OK → [{st['index']}/{st['total']}] "
            f"{st.get('kind', 'slice')}:{cur} :: {new_state}"
        )
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--session", type=Path, default=None)
    parser.add_argument("--json", action="store_true")
    sub = parser.add_subparsers(dest="cmd", required=True)
    sub.add_parser("status")
    p_advance = sub.add_parser("advance")
    p_advance.add_argument("transition")
    args = parser.parse_args(argv)

    session_path = args.session if args.session is not None else _resolve_session_path()

    if not session_path.exists():
        msg = (
            f"error: session file not found at {session_path}\n"
            f"  hint: cd to the user project root, or set $TRTC_SESSION_PATH "
            f"or one of $TRTC_PROJECT_ROOT / $CLAUDE_PROJECT_DIR / "
            f"$CODEBUDDY_PROJECT_DIR / $CURSOR_PROJECT_DIR "
            f"before running this script."
        )
        if args.json:
            print(jsonlib.dumps({"ok": False, "error": msg}, ensure_ascii=False))
        else:
            print(msg, file=sys.stderr)
        return 1

    if args.cmd == "status":
        return _print_status(session_path, args.json)
    return _do_advance(session_path, args.transition, args.json)


if __name__ == "__main__":
    sys.exit(main())
