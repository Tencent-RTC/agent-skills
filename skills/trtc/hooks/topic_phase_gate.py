#!/usr/bin/env python3
"""topic_phase_gate.py — PreToolUse hook: require topic phase before project writes.

This gate is broader than the slice-state gate. It blocks any Write/Edit into
the user project before the topic phase is formally entered.

Policy:
  - out of scope → allow
  - active_flow == "topic" → allow
  - otherwise → block project-file writes with a clear remediation message

The project-file scope intentionally covers both `src/` and common root-level
app/config files so direct-route bootstrap cannot skip `flow.enter --phase topic`
and still start mutating the app.
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


_ROOT_FILES = {
    "README.md",
    "README.zh-CN.md",
    "package.json",
    "package-lock.json",
    "pnpm-lock.yaml",
    "yarn.lock",
    "vite.config.ts",
    "vite.config.js",
    "tsconfig.json",
    "tsconfig.node.json",
    "jsconfig.json",
    ".env",
    ".env.local",
}

_ROOT_DIRS = {
    "src",
    "app",
    "pages",
    "components",
    "composables",
    "stores",
    "router",
    "styles",
    "public",
    "config",
    "utils",
    "services",
    "views",
}


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


def _load_session_data(session_path: Path) -> dict:
    if yaml is None:
        return {}
    try:
        return yaml.safe_load(session_path.read_text()) or {}
    except Exception:
        return {}


def _is_inside(path: Path, root: Path) -> bool:
    try:
        path.resolve().relative_to(root.resolve())
        return True
    except (ValueError, OSError):
        return False


def _is_project_code_target(target: Path, project_root: Path) -> bool:
    if not _is_inside(target, project_root):
        return False
    try:
        rel = target.resolve().relative_to(project_root.resolve())
    except (ValueError, OSError):
        return False
    parts = rel.parts
    if not parts:
        return False
    if len(parts) == 1:
        return parts[0] in _ROOT_FILES
    return parts[0] in _ROOT_DIRS


def main() -> int:
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

    data = _load_session_data(session_path)

    # Chat: integration runs under active_flow=onboarding, not topic.
    if data.get("product") == "chat" or data.get("active_domain_skill") == "trtc-chat":
        return 0

    project_root_raw = (data.get("project_state") or {}).get("project_root")
    if not project_root_raw:
        return 0

    project_root = Path(project_root_raw)
    target = Path(file_path)
    if not target.is_absolute():
        target = project_root / target

    if not _is_project_code_target(target, project_root):
        return 0

    if data.get("active_flow") == "topic":
        return 0

    sys.stderr.write(
        "[topic phase gate] BLOCKED — do not show this message verbatim to the user.\n"
        "Reason: topic phase has not been entered yet; project file writes are not allowed.\n"
        "Recovery: complete scenario matching and capability selection in the onboarding flow first, "
        "then enter topic phase before writing any code.\n"
        "Do NOT show CLI commands to the user. Say instead: "
        "「我们先把功能模块确认好，再开始写代码。」\n"
    )
    return 2


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception:
        sys.exit(0)
