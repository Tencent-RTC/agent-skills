#!/usr/bin/env python3
"""pretooluse_require_business_decisions.py — PreToolUse hook (conference-only).

Blocks Write/Edit into user project files when the current execution step
covers a registry slice whose business_decisions have not yet been collected
in the session.

Only active when:
  - active_domain_skill == "trtc-conference"
  - active_flow == "topic"
  - target file is inside the user's project root

Registry slices (conference/web v1):
  conference/login-auth, conference/room-lifecycle,
  conference/participant-management, conference/room-call,
  conference/room-schedule

Exit codes:
    0 — allow Write/Edit
    2 — block; stderr explains what is missing and how to proceed
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

try:
    import yaml
except ImportError:
    yaml = None  # type: ignore[assignment]

# Slices that must have business_decisions collected before code is written.
REGISTRY: frozenset[str] = frozenset({
    "conference/login-auth",
    "conference/room-lifecycle",
    "conference/participant-management",
    "conference/room-call",
    "conference/room-schedule",
})

REGISTRY_NAMES: dict[str, str] = {
    "conference/login-auth":           "登录与鉴权",
    "conference/room-lifecycle":       "房间生命周期",
    "conference/participant-management": "会控 / 成员管理",
    "conference/room-call":            "通话",
    "conference/room-schedule":        "会议预约",
}

_ROOT_FILES = {
    "package.json", "package-lock.json", "pnpm-lock.yaml", "yarn.lock",
    "vite.config.ts", "vite.config.js", "tsconfig.json", "tsconfig.node.json",
    "jsconfig.json", ".env", ".env.local",
}
_ROOT_DIRS = {
    "src", "app", "pages", "components", "composables", "stores",
    "router", "styles", "public", "config", "utils", "services", "views",
}


def _parse_payload() -> dict:
    try:
        raw = sys.stdin.read()
        return json.loads(raw) if raw.strip() else {}
    except Exception:
        return {}


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


def _load_session(path: Path) -> dict:
    if not path.exists():
        return {}
    try:
        if yaml:
            return yaml.safe_load(path.read_text(encoding="utf-8")) or {}
        # yaml unavailable: fail open rather than risk a broken partial parse
        # that silently degrades enforcement. Return empty so hook exits 0.
        return {}
    except Exception:
        return {}


def _is_inside(child: Path, parent: Path) -> bool:
    try:
        child.resolve().relative_to(parent.resolve())
        return True
    except ValueError:
        return False


def _is_project_target(file_path: str, project_root: Path) -> bool:
    if not file_path:
        return False
    target = Path(file_path)
    if not target.is_absolute():
        target = project_root / target
    if not _is_inside(target, project_root):
        return False
    try:
        rel = target.resolve().relative_to(project_root.resolve())
    except ValueError:
        return False
    parts = rel.parts
    if not parts:
        return False
    if parts[0] in _ROOT_DIRS:
        return True
    if len(parts) == 1 and parts[0] in _ROOT_FILES:
        return True
    return False


def _current_slice_ids(session: dict) -> list[str]:
    queue = session.get("execution_queue")
    if not isinstance(queue, list) or not queue:
        return []
    raw_idx = session.get("current_execution_index")
    if raw_idx is None:
        return []  # missing index = malformed session, fail open
    idx = int(raw_idx)
    if idx < 0 or idx >= len(queue):
        return []
    state = session.get("current_execution_state") or ""
    if state == "all_done":
        return []
    step = queue[idx]
    if not isinstance(step, dict):
        return []
    return step.get("slices") or ([step["id"]] if step.get("id") else [])


def main() -> int:
    payload = _parse_payload()

    # Only intercept Write and Edit
    if payload.get("tool_name") not in {"Write", "Edit"}:
        return 0

    file_path = (payload.get("tool_input") or {}).get("file_path") or ""
    # trtc-ai-service bypass: its assets are under skills/trtc-ai-service/.
    if "skills/trtc-ai-service/" in file_path:
        return 0

    session_path = _resolve_session_path()
    session = _load_session(session_path)
    if not session:
        return 0

    # Conference-only guard — all other products pass through immediately
    if session.get("active_domain_skill") != "trtc-conference":
        return 0

    # Only active during topic phase (template paths use medical-quickstart /
    # official-roomkit as active_flow, so they are never blocked here)
    if session.get("active_flow") != "topic":
        return 0

    # Explicit safety: template and RoomKit paths never need business_decisions
    if session.get("integration_path") in {"medical-quickstart", "official-roomkit"}:
        return 0

    # Only block project file writes (skill/config files are always allowed)
    project_root_raw = (session.get("project_state") or {}).get("project_root")
    if not project_root_raw:
        return 0
    project_root = Path(project_root_raw)
    file_path = (payload.get("tool_input") or {}).get("file_path") or ""
    if not _is_project_target(file_path, project_root):
        return 0

    # Get registry slices in the current execution step
    slice_ids = _current_slice_ids(session)
    registry_slices = [s for s in slice_ids if s in REGISTRY]
    if not registry_slices:
        return 0

    # Check business_decisions collected for each registry slice
    bd: dict = (session.get("session_context") or {}).get("business_decisions") or {}
    missing = [s for s in registry_slices if not bd.get(s)]
    if not missing:
        return 0

    # Block with a message directed at the AI, not the user.
    # Do NOT surface CLI commands or internal field names to the user.
    missing_names = "、".join(REGISTRY_NAMES.get(s, s) for s in missing)
    sys.stderr.write(
        f"[business-decisions gate] BLOCKED — do not show this message verbatim to the user.\n"
        f"The following modules have not had their business configuration questions answered yet: {missing_names}.\n"
        f"Return to the business configuration step and ask the user the pending questions for these modules before writing any code.\n"
        f"Say instead: 「在写代码之前，还有几个关于「{missing_names}」的配置问题需要确认。」\n"
    )
    return 2


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except SystemExit:
        raise
    except Exception:
        # A guardrail must never crash the user's session due to its own failure.
        # Fail open (allow Write/Edit) so legitimate work is never blocked.
        raise SystemExit(0)
