#!/usr/bin/env python3
"""stop_require_apply_evidence.py — Stop hook: refuse to end mid-slice.

Wired into ``.claude/settings.json`` under ``Stop`` (before the project-wide
verifier so the cheap state check runs first). The hook reads the slice
state machine and blocks the Stop event when the AI is about to leave a
slice in an unfinished state:

    code_written  → block — `python3 -m tools.apply` was never run for this slice
    apply_failed  → block — apply rejected the code; AI must regenerate and re-run `python3 -m tools.apply`

Allowed states: not_started, slice_read, apply_passed, all_done, plus the
out-of-scope cases (no session, no queue).

Exit codes:
    0 — allow Stop
    2 — block Stop; stderr explains how to recover
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent.parent.parent))
try:
    from skills.trtc.tools import state_machine  # noqa: E402
except Exception:
    # A guardrail must never crash the user's session just because its own
    # dependency failed to import. Fail open (allow Stop) — see main().
    state_machine = None  # type: ignore[assignment]
finally:
    sys.path.pop(0)


_BLOCK_STATES = {"code_written", "apply_failed"}


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


def main() -> int:
    if state_machine is None:
        # Dependency import failed — fail open (allow Stop).
        return 0

    session_path = _resolve_session_path()
    if not session_path.exists():
        return 0

    # trtc-ai-service bypass: this Stop gate is conference-specific.
    # Only block if the session belongs to the conference domain.
    try:
        if "active_domain_skill: trtc-conference" not in session_path.read_text():
            return 0
    except Exception:
        pass

    scope = state_machine.current_scope(session_path)
    if not scope.get("initialised"):
        return 0
    idx = scope["index"]
    current_id = scope["id"]
    state = scope["state"]
    kind = scope["kind"]

    if state not in _BLOCK_STATES:
        return 0

    if state == "code_written":
        sys.stderr.write(
            f"[topic Stop hook] BLOCKED — do not show this message verbatim to the user.\n"
            f"Reason: {kind} [{idx}] '{current_id}' is in 'code_written' but apply has not run.\n"
            f"Recovery: run apply for this {kind}, then present the result to the user and ask them to confirm.\n"
            f"Do NOT show CLI commands to the user. Say instead: "
            f"「代码已生成，正在验证结构，稍后为您确认结果。」\n"
        )
        return 2

    # apply_failed
    sys.stderr.write(
        f"[topic Stop hook] BLOCKED — do not show this message verbatim to the user.\n"
        f"Reason: {kind} [{idx}] '{current_id}' is in 'apply_failed'.\n"
        f"Recovery: review the apply evidence, patch or regenerate the {kind}'s code, then re-run apply.\n"
        f"Do NOT show CLI commands to the user. Say instead: "
        f"「上一步的代码验证没有通过，我来帮你修复。」\n"
    )
    return 2


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception:
        # Last-resort guard: a hook bug must not trap the user mid-session
        # or spam a traceback. Fail open (allow Stop).
        sys.exit(0)
