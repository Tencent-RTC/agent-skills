#!/usr/bin/env python3
"""Snapshot / audit an iOS project around an apply step.

Purpose: detect files that changed but were not part of what the user confirmed, and never allow
project.pbxproj to be modified. Output contains only relative paths and statuses, never file content.

Safety: Debug/TRTCDebugConfig.swift may hold a user-filled SecretKey, so its content is never hashed or
stored; only its presence is recorded.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path, PurePosixPath
from typing import Any

try:
    from ios_probe import SKIP_DIRS
except ImportError:  # pragma: no cover
    from .ios_probe import SKIP_DIRS  # type: ignore

SCHEMA_VERSION = 1
SNAPSHOT_SKIP_DIRS = set(SKIP_DIRS) | {"xcuserdata", ".trtc-call", ".swiftpm"}
SNAPSHOT_SKIP_FILES = {".trtc-session.yaml", "Podfile.lock", ".DS_Store"}
PRESENCE_ONLY_FILES = {"TRTCDebugConfig.swift"}
MAX_HASH_BYTES = 5 * 1024 * 1024


class AuditError(RuntimeError):
    pass


def _digest(path: Path) -> str:
    if path.name in PRESENCE_ONLY_FILES:
        return "present"
    size = path.stat().st_size
    if size > MAX_HASH_BYTES:
        return f"size:{size}"
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(65536), b""):
            h.update(chunk)
    return "sha256:" + h.hexdigest()


def snapshot(root: Path) -> dict:
    root = root.resolve()
    files: dict[str, str] = {}
    for p in sorted(root.rglob("*")):
        rel_parts = p.relative_to(root).parts
        if any(part in SNAPSHOT_SKIP_DIRS for part in rel_parts):
            continue
        if not p.is_file() or p.is_symlink() or p.name in SNAPSHOT_SKIP_FILES:
            continue
        files[PurePosixPath(*rel_parts).as_posix()] = _digest(p)
    return {"schema_version": SCHEMA_VERSION, "project_root": str(root), "files": files}


def _normalize_allow(entry: str) -> str:
    p = PurePosixPath(entry.replace("\\", "/"))
    if p.is_absolute() or ".." in p.parts or not p.parts:
        raise AuditError(f"--allow 必须是项目内的相对路径：{entry!r}")
    return p.as_posix()


def audit(root: Path, baseline: dict, allow: list) -> dict:
    root = root.resolve()
    if baseline.get("schema_version") != SCHEMA_VERSION:
        raise AuditError("baseline 的 schema_version 不匹配，请重新生成")
    if Path(baseline.get("project_root", "")).resolve() != root:
        raise AuditError("baseline 不属于当前项目根目录")
    allowed = {_normalize_allow(a) for a in allow}
    before = baseline["files"]
    after = snapshot(root)["files"]

    created = sorted(set(after) - set(before))
    deleted = sorted(set(before) - set(after))
    modified = sorted(p for p in set(before) & set(after) if before[p] != after[p])
    changed = created + deleted + modified
    kind = {**{p: "created" for p in created}, **{p: "deleted" for p in deleted},
            **{p: "modified" for p in modified}}

    forbidden = [{"path": p, "status": kind[p], "reason": "pbxproj-modified"}
                 for p in changed if p.endswith(".pbxproj")]
    unplanned = [{"path": p, "status": kind[p]} for p in changed
                 if p not in allowed and not p.endswith(".pbxproj")]
    planned = [{"path": p, "status": kind[p]} for p in changed if p in allowed and not p.endswith(".pbxproj")]
    allowed_unchanged = sorted(a for a in allowed if a not in kind)

    if not changed:
        status = "no-op"
    elif not unplanned and not forbidden:
        status = "matched"
    else:
        status = "diverged"
    return {
        "schema_version": SCHEMA_VERSION, "status": status,
        "summary": {"changed": len(changed), "planned": len(planned),
                    "unplanned": len(unplanned), "forbidden": len(forbidden)},
        "changes": {"planned": planned, "unplanned": unplanned, "forbidden": forbidden},
        "allowed_but_unchanged": allowed_unchanged,
    }


def _build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description=__doc__)
    sub = p.add_subparsers(dest="command", required=True)
    s = sub.add_parser("snapshot")
    s.add_argument("--project-root", type=Path, required=True)
    s.add_argument("--output", type=Path, required=True)
    a = sub.add_parser("audit")
    a.add_argument("--project-root", type=Path, required=True)
    a.add_argument("--baseline", type=Path, required=True)
    a.add_argument("--allow", action="append", default=[])
    a.add_argument("--output", type=Path,
                   help="把审计结果另存为 JSON（审计本身只读；结果留痕用，目录不存在会创建）")
    return p


def main() -> int:
    args = _build_parser().parse_args()
    try:
        if args.command == "snapshot":
            snap = snapshot(args.project_root)
            args.output.parent.mkdir(parents=True, exist_ok=True)
            args.output.write_text(json.dumps(snap, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
                                   encoding="utf-8")
            print(json.dumps({"status": "ok", "file_count": len(snap["files"])}, ensure_ascii=False))
            return 0
        baseline = json.loads(args.baseline.read_text(encoding="utf-8"))
        result = audit(args.project_root, baseline, args.allow)
    except (AuditError, OSError, json.JSONDecodeError) as exc:
        print(json.dumps({"status": "error", "message": str(exc)}, ensure_ascii=False), file=sys.stderr)
        return 2
    if args.output:
        try:
            args.output.parent.mkdir(parents=True, exist_ok=True)
            args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
                                   encoding="utf-8")
        except OSError as exc:
            print(json.dumps({"status": "error", "message": f"无法写入审计结果：{exc}"}, ensure_ascii=False),
                  file=sys.stderr)
            return 2
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result["status"] in ("matched", "no-op") else 1


if __name__ == "__main__":
    raise SystemExit(main())
