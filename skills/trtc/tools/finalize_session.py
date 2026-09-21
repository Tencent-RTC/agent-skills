#!/usr/bin/env python3
"""finalize_session.py — Normalize a completed TRTC topic session.

Run this only after topic Step 4 / Step 4.5 are finished and the integration
is genuinely complete. `current_execution_state=all_done` only means the
execution loop ended; this script is the explicit final handoff.
"""
from __future__ import annotations

import argparse
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

import yaml


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


def _dedupe_preserve_order(values) -> list:
    seen = set()
    out = []
    for value in values or []:
        if value in seen:
            continue
        seen.add(value)
        out.append(value)
    return out


def _normalize(data: dict) -> dict:
    queue = data.get("execution_queue") or []
    if not queue and data.get("slice_queue"):
        queue = [
            {
                "id": entry.get("id"),
                "type": "slice",
                "title": entry.get("id"),
                "status": entry.get("status", "pending"),
                "slices": [entry.get("id")],
            }
            for entry in data.get("slice_queue") or []
            if entry.get("id")
        ]
    queue_ids = [
        slice_id
        for entry in queue
        for slice_id in (entry.get("slices") or [entry.get("id")])
        if slice_id
    ]
    completed = _dedupe_preserve_order(data.get("completed_steps") or [])
    for slice_id in queue_ids:
        if slice_id not in completed:
            completed.append(slice_id)

    for entry in queue:
        if all(slice_id in completed for slice_id in (entry.get("slices") or [entry.get("id")])):
            entry["status"] = "done"

    data["status"] = "completed"
    data["current_step"] = "completed"
    data["completed_steps"] = completed

    if queue:
        data["execution_queue"] = queue
        data["current_execution_index"] = len(queue)
        data["current_execution_state"] = "all_done"

    data["updated_at"] = datetime.now(timezone.utc).astimezone().isoformat()

    product = data.get("product") or "TRTC"
    scenario = data.get("scenario") or data.get("intent") or "integration"
    done_count = len(completed)
    data["last_recap"] = (
        f"{product} {scenario} integration completed. "
        f"{done_count} step{'s' if done_count != 1 else ''} completed."
    )
    return data


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
        print(f"error: session file not found at {session_path}", file=sys.stderr)
        return 1

    data = yaml.safe_load(session_path.read_text()) or {}
    data = _normalize(data)
    session_path.write_text(yaml.safe_dump(data, sort_keys=False, allow_unicode=True))
    print(f"session finalized — status=completed, current_step=completed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
