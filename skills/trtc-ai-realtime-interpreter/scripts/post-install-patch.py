#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""安装后收尾脚本。

本 Skill 的能力包之间通过运行时动态加载（`_capability_loader.load_capability`）连接，
不采用「往骨架源码里注入代码片段」的方式，所以不存在 stale injection 需要修复。
本脚本只做两件轻量的事：

1. 确保 capabilities/conversation-core/.env 存在（首次使用从 .env.example 复制），并设置权限 600
2. 健全性检查：确认已安装能力包声明的模块文件真实存在（router.py / service.py 等），
   避免运行时才发现文件缺失
"""
from __future__ import annotations

import json
import os
import shutil
import stat
import sys
from pathlib import Path
from typing import Any, Dict, List

_HERE = Path(__file__).resolve().parent
_ROOT = _HERE.parent
if str(_HERE) not in sys.path:
    sys.path.insert(0, str(_HERE))

from lib import manifest_resolver as mr  # noqa: E402

CORE_DIR = _ROOT / "capabilities" / "conversation-core"


def ensure_env_file() -> Dict[str, Any]:
    env_path = CORE_DIR / ".env"
    example_path = CORE_DIR / ".env.example"
    created = False
    if not env_path.exists():
        if not example_path.exists():
            return {"ok": False, "error": f".env.example not found at {example_path}"}
        shutil.copy2(example_path, env_path)
        created = True
    try:
        os.chmod(env_path, stat.S_IRUSR | stat.S_IWUSR)  # 0600
    except OSError as exc:  # noqa: BLE001
        return {"ok": False, "error": f"chmod failed: {exc}"}
    return {"ok": True, "created": created, "path": str(env_path)}


def sanity_check_capabilities() -> Dict[str, Any]:
    names = mr.list_capabilities()
    issues: List[str] = []
    for name in names:
        manifest = mr.load_manifest(name)
        for ep in manifest.get("endpoints", []) or []:
            pass  # endpoints 是文档性字段，不做文件校验
        provides = manifest.get("provides", {}) or {}
        starter = provides.get("starter_capability")
        if starter:
            mod_path = _ROOT / "capabilities" / name / starter["module"]
            if not mod_path.is_file():
                issues.append(f"{name}: declared starter_capability module missing at {mod_path}")
        for asset in manifest.get("frontend_assets", []) or []:
            asset_path = _ROOT / "capabilities" / name / asset["path"]
            if not asset_path.is_file():
                issues.append(f"{name}: declared frontend_assets missing at {asset_path}")
    return {"ok": not issues, "capabilities": names, "issues": issues}


def main() -> int:
    env_result = ensure_env_file()
    check_result = sanity_check_capabilities()
    out = {"ok": env_result.get("ok", False) and check_result.get("ok", False), "env": env_result, "sanity_check": check_result}
    sys.stdout.write(json.dumps(out, ensure_ascii=False, indent=2))
    sys.stdout.write("\n")
    return 0 if out["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())
