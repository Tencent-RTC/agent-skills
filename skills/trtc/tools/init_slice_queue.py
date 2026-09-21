#!/usr/bin/env python3
"""init_slice_queue.py — Materialise execution_queue from session.

Usage:
    python3 init_slice_queue.py                 # auto-resolves session path
    python3 init_slice_queue.py --session PATH  # explicit override

Session path resolution (in order):
    1. --session flag, if given
    2. $TRTC_SESSION_PATH env var
    3. <projectRoot>/.trtc-session.yaml resolved via one of the IDE project-root env vars:
       $TRTC_PROJECT_ROOT | $CLAUDE_PROJECT_DIR | $CODEBUDDY_PROJECT_DIR |
       $CURSOR_PROJECT_DIR (first non-empty wins)
    4. ./.trtc-session.yaml (cwd fallback — useful when AI runs Bash from
       the user project root)

Reads ``confirmed_plan`` from the session and writes:
    execution_queue, current_execution_index=0, current_execution_state=not_started

Idempotent. Refuses to re-init if the plan has changed (queue is frozen).

Exit codes:
    0 — success (queue written or already up to date)
    1 — confirmed_plan missing/empty, or plan diverged from existing queue
"""
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent.parent.parent))

from skills.trtc.tools import state_machine  # noqa: E402


def _resolve_session_path() -> Path:
    """Match the resolver used by guardrails/gate_*.py:
    env var → one of the IDE project-root env vars → cwd. The session file
    lives in the user project, never in the skill repo, so we never look at
    HERE.parents.
    """
    explicit = os.environ.get("TRTC_SESSION_PATH")
    if explicit:
        return Path(explicit)
    for _key in ("TRTC_PROJECT_ROOT", "CLAUDE_PROJECT_DIR",
                 "CODEBUDDY_PROJECT_DIR", "CURSOR_PROJECT_DIR"):
        project_dir = os.environ.get(_key)
        if project_dir:
            return Path(project_dir) / ".trtc-session.yaml"
    return Path.cwd() / ".trtc-session.yaml"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument(
        "--session",
        type=Path,
        default=None,
        help="explicit path to .trtc-session.yaml (overrides env-based resolver)",
    )
    args = parser.parse_args(argv)

    session_path = args.session if args.session is not None else _resolve_session_path()

    if not session_path.exists():
        print(
            f"error: session file not found at {session_path}\n"
            f"  hint: cd to the user project root, or set $TRTC_SESSION_PATH "
            f"or one of $TRTC_PROJECT_ROOT / $CLAUDE_PROJECT_DIR / "
            f"$CODEBUDDY_PROJECT_DIR / $CURSOR_PROJECT_DIR "
            f"before running this script.",
            file=sys.stderr,
        )
        return 1

    try:
        state_machine.init_queue(session_path)
    except state_machine.StateMachineError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1

    st = state_machine.status(session_path)
    kind = st.get("kind", "slice")
    cur = st.get("current_unit_id") or st.get("current_slice_id")
    if kind == "unit":
        print(
            f"queue initialised — {st['total']} delivery units, "
            f"cursor at [{st['index']}] {cur} ({st['state']}), "
            f"slices: {', '.join(st.get('slice_ids') or [])}"
        )
    else:
        print(
            f"queue initialised — {st['total']} slices, "
            f"cursor at [{st['index']}] {cur} ({st['state']})"
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
