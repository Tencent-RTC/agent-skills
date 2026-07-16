# -*- coding: utf-8 -*-
"""极简技术栈检测：扫描目标项目根目录的特征文件，判断前端/后端技术栈。"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Optional


def detect_frontend_framework(target_project: Path) -> Optional[str]:
    pkg = target_project / "package.json"
    if not pkg.is_file():
        return None
    try:
        data = json.loads(pkg.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    deps = {**data.get("dependencies", {}), **data.get("devDependencies", {})}
    if "vue" in deps:
        return "vue"
    if "react" in deps or "next" in deps:
        return "react"
    if "@angular/core" in deps:
        return "angular"
    return "unknown-node"


def detect_python_backend_framework(target_project: Path) -> Optional[str]:
    req = target_project / "requirements.txt"
    pyproject = target_project / "pyproject.toml"
    text = ""
    if req.is_file():
        text += req.read_text(encoding="utf-8", errors="ignore")
    if pyproject.is_file():
        text += pyproject.read_text(encoding="utf-8", errors="ignore")
    lowered = text.lower()
    if "fastapi" in lowered:
        return "fastapi"
    if "flask" in lowered:
        return "flask"
    if "django" in lowered:
        return "django"
    return None


def detect(target_project: Path) -> dict:
    return {
        "frontend": detect_frontend_framework(target_project),
        "python_backend": detect_python_backend_framework(target_project),
    }
