#!/usr/bin/env python3
"""gate_slice_write.py — PreToolUse hook: block premature project writes.

Wired into ``.claude/settings.json`` under ``PreToolUse`` with matcher
``Write|Edit``. Contract identical to gate_slice_read.py.

State-based policy (only fires when execution_queue is initialised AND the
target file lives inside the user project's source tree):

    not_started     → BLOCK (read the slice first)
    slice_read      → ALLOW (initial code generation)
    code_written    → ALLOW (apply hasn't passed; AI may still tweak)
    apply_failed    → ALLOW (retry after apply rejection)
    apply_passed    → BLOCK (wait for user confirm — not auto-advance)
    all_done        → ALLOW (handoff complete; user owns the code)

Out-of-scope cases (silent allow):
    * tool_name not in {Write, Edit}
    * session file missing
    * execution_queue not initialised
    * file_path is NOT inside ``project_state.project_root`` (e.g. writing
      to .claude/, knowledge-base/, /tmp/...) — the gate only guards
      project source files.
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

try:
    import yaml
except Exception:
    yaml = None  # type: ignore[assignment]

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


def _parse_payload() -> dict:
    raw = sys.stdin.read()
    if not raw.strip():
        return {}
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return {}


def _project_root_from_session(session_path: Path) -> Path | None:
    if yaml is None:
        return None
    try:
        data = yaml.safe_load(session_path.read_text()) or {}
    except Exception:
        return None
    pr = (data.get("project_state") or {}).get("project_root")
    if not pr:
        return None
    return Path(pr)


def _is_inside(path: Path, root: Path) -> bool:
    try:
        path.resolve().relative_to(root.resolve())
        return True
    except ValueError:
        return False
    except OSError:
        return False


def main() -> int:
    if state_machine is None:
        # Dependency import failed — fail open.
        return 0

    payload = _parse_payload()
    if payload.get("tool_name") not in {"Write", "Edit"}:
        return 0

    file_path = (payload.get("tool_input") or {}).get("file_path") or ""
    if not file_path:
        return 0
    # trtc-ai-service bypass: its assets are under skills/trtc-ai-service/.
    if "skills/trtc-ai-service/" in file_path:
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
    kind = scope["kind"]
    slice_ids = scope["slice_ids"]

    project_root = _project_root_from_session(session_path)
    if project_root is None:
        return 0

    target = Path(file_path)
    if not target.is_absolute():
        target = (project_root / file_path).resolve() if project_root.exists() else target

    if not _is_inside(target, project_root):
        # Outside the user project — out of scope.
        return 0

    # In-scope decision based on state.
    if state in {"slice_read", "code_written", "apply_failed", "all_done"}:
        return 0

    if state == "not_started":
        sys.stderr.write(
            f"[topic gate] BLOCKED — do not show this message verbatim to the user.\n"
            f"Reason: state is 'not_started' for {kind} [{idx}] '{current_id}'; slice not read yet.\n"
            f"Recovery: read the current {kind}'s slice files ({', '.join(slice_ids)}), "
            f"then advance state to slice_read before writing code.\n"
            f"Do NOT show CLI commands to the user. Say instead: "
            f"「我先读一下这个模块的参考文档，马上开始。」\n"
        )
        return 2

    if state == "apply_passed":
        sys.stderr.write(
            f"[topic gate] BLOCKED — do not show this message verbatim to the user.\n"
            f"Reason: state is 'apply_passed' for {kind} [{idx}] '{current_id}'; step already complete.\n"
            f"Recovery: present the apply result to the user and ask for confirmation before advancing.\n"
            f"Do NOT show CLI commands to the user. Say instead: "
            f"「这个模块已经完成，请确认一下，然后我们继续下一步。」\n"
        )
        return 2

    # Defensive: unknown state — allow but warn.
    sys.stderr.write(
        f"[topic gate] Unknown state '{state}'; allowing write. "
        f"This is a bug — please update gate_slice_write.py.\n"
    )
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception:
        # Last-resort guard: a hook bug must not block the user or spam a
        # traceback. Fail open (allow the Write/Edit).
        sys.exit(0)
