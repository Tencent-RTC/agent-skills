#!/usr/bin/env python3
"""gate_slice_read.py — PreToolUse hook: block out-of-bounds slice reads.

Wired into ``.claude/settings.json`` under ``PreToolUse`` with matcher
``Read``. The contract:

* stdin is a JSON object: ``{"tool_name": "Read", "tool_input": {"file_path": "..."}}``
* exit 0 — allow the call (out of scope, or in bounds)
* exit 2 — block; stderr explains what the AI must do instead

Out-of-scope cases (silent allow):
    * tool_name != "Read"
    * file_path doesn't look like a slice file
      (under ``knowledge-base/slices/.../*.md``)
    * session file is missing
    * execution_queue not initialised (topic flow not active)

In-scope: file_path matches ``knowledge-base/slices/{product}/[{platform}/]{slice}.md``.
We block unless ``{product}/{slice}`` belongs to the cursor's current execution step.
"""
from __future__ import annotations

import json
import os
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent.parent.parent))
try:
    from skills.trtc.tools import state_machine  # noqa: E402
except Exception:
    # A guardrail must never crash the user's session just because its own
    # dependency failed to import. Fail open (allow) — see main().
    state_machine = None  # type: ignore[assignment]
finally:
    sys.path.pop(0)


# Match "knowledge-base/slices/{product}/{ability}.md" or
# "knowledge-base/slices/{product}/{platform}/{ability}.md".
# We accept it appearing anywhere in the path (relative or absolute).
_SLICE_PATH_RE = re.compile(
    r"knowledge-base/slices/(?P<product>[^/]+)"
    r"(?:/(?P<platform>web|android|ios|flutter|electron|unity))?"
    r"/(?P<ability>[^/]+)\.md$"
)


def _resolve_session_path() -> Path:
    """Pick the session file: env var first, then <projectRoot>/.trtc-session.yaml across supported IDEs."""
    explicit = os.environ.get("TRTC_SESSION_PATH")
    if explicit:
        return Path(explicit)
    for _key in ("TRTC_PROJECT_ROOT", "CLAUDE_PROJECT_DIR",
                 "CODEBUDDY_PROJECT_DIR", "CURSOR_PROJECT_DIR"):
        project_dir = os.environ.get(_key)
        if project_dir:
            return Path(project_dir) / ".trtc-session.yaml"
    return Path.cwd() / ".trtc-session.yaml"


def _parse_payload() -> dict:
    raw = sys.stdin.read()
    if not raw.strip():
        return {}
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return {}


def _slice_id_from_path(file_path: str) -> str | None:
    """Extract '{product}/{ability}' from a slice file path; None if not a slice."""
    m = _SLICE_PATH_RE.search(file_path.replace("\\", "/"))
    if not m:
        return None
    return f"{m.group('product')}/{m.group('ability')}"


def main() -> int:
    if state_machine is None:
        # Dependency import failed — fail open.
        return 0

    payload = _parse_payload()
    if payload.get("tool_name") != "Read":
        return 0

    file_path = (payload.get("tool_input") or {}).get("file_path") or ""
    # trtc-ai-service bypass: its assets are under skills/trtc-ai-service/.
    if "skills/trtc-ai-service/" in file_path:
        return 0
    requested_slice = _slice_id_from_path(file_path)
    if requested_slice is None:
        # Not a slice file — out of this gate's domain.
        return 0

    session_path = _resolve_session_path()
    if not session_path.exists():
        return 0

    scope = state_machine.current_scope(session_path)
    if not scope.get("initialised"):
        # Topic flow not active.
        return 0
    idx = scope["index"]
    current_id = scope["id"]
    state = scope["state"]
    slice_ids = scope["slice_ids"]
    kind = scope["kind"]

    if state == "all_done":
        # Topic finished; user owns the code now. Don't gate further reads.
        return 0

    if requested_slice in slice_ids:
        return 0

    sys.stderr.write(
        f"[topic gate] BLOCKED — do not show this message verbatim to the user.\n"
        f"Reason: '{requested_slice}' is not in the current {kind} "
        f"[{idx}] '{current_id}' (state: {state}); out-of-order read.\n"
        f"Recovery: finish the current {kind} first (write code, run apply, get user confirmation), "
        f"then the next {kind} will become available.\n"
        f"Do NOT explain the internal step ordering to the user. Say instead: "
        f"「我按照模块顺序来，先完成当前这步，马上到这里。」\n"
    )
    return 2


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception:
        # Last-resort guard: a hook bug must not block the user or spam a
        # traceback. Fail open (allow the Read).
        sys.exit(0)
