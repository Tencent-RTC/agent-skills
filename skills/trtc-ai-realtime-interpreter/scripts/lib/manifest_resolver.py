# -*- coding: utf-8 -*-
"""扫描 capabilities/*/manifest.yaml，解析依赖关系与拓扑顺序。"""
from __future__ import annotations

from pathlib import Path
from typing import Any, Dict, List

import yaml

SKILL_ROOT = Path(__file__).resolve().parents[2]
CAPS_ROOT = SKILL_ROOT / "capabilities"


def load_manifest(cap_name: str) -> Dict[str, Any]:
    path = CAPS_ROOT / cap_name / "manifest.yaml"
    if not path.is_file():
        raise FileNotFoundError(f"manifest not found for capability '{cap_name}': {path}")
    return yaml.safe_load(path.read_text(encoding="utf-8")) or {}


def list_capabilities() -> List[str]:
    if not CAPS_ROOT.is_dir():
        return []
    return sorted(p.name for p in CAPS_ROOT.iterdir() if p.is_dir() and (p / "manifest.yaml").is_file())


def dependency_names(manifest: Dict[str, Any]) -> List[str]:
    return [d["name"] for d in (manifest.get("dependencies") or [])]


def topo_order(cap_names: List[str]) -> List[str]:
    """对给定的能力名列表做拓扑排序（依赖在前）。检测出循环依赖会抛异常。"""
    manifests = {name: load_manifest(name) for name in cap_names}
    # 把依赖但未在列表里的也纳入（骨架层大概率如此）
    visited: Dict[str, int] = {}  # 0=未访问 1=处理中 2=完成
    order: List[str] = []

    def visit(name: str) -> None:
        state = visited.get(name, 0)
        if state == 2:
            return
        if state == 1:
            raise ValueError(f"circular dependency detected involving: {name}")
        visited[name] = 1
        manifest = manifests.get(name)
        if manifest is None:
            try:
                manifest = load_manifest(name)
                manifests[name] = manifest
            except FileNotFoundError:
                visited[name] = 2
                return
        for dep in dependency_names(manifest):
            visit(dep)
        visited[name] = 2
        order.append(name)

    for name in cap_names:
        visit(name)
    return order
