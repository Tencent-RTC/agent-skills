#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""能力组装 CLI。

用法
----
    # 列出已发现的能力包及拓扑顺序
    python3 scripts/add-capability.py --list

    # 校验一组能力包的依赖关系（不做文件改动，仅用于 Path A/B 组装前的检查）
    python3 scripts/add-capability.py conversation-core realtime-translation meeting-ops --check

    # 面向 Path B：往目标项目渲染集成资产（拷贝前端片段 + 按检测到的技术栈渲染后端反代模板）
    python3 scripts/add-capability.py realtime-translation meeting-ops \
        --target-project /path/to/user/repo --apply --json

行为
----
1. 扫描 capabilities/*/manifest.yaml，校验依赖、拓扑顺序、循环依赖
2. 若提供 --target-project，则：
   - 拷贝 frontend_assets（各能力包声明的框架无关前端片段）到 <target>/ai-interpreter-integration/frontend/
   - 检测目标项目技术栈，若为 Python 后端，渲染 auto_adapters/python 下的反代模板到
     <target>/ai-interpreter-integration/backend/
   - 若检测不出技术栈，输出 auto_adapters/integration_templates/generic-rest-api.md 的路径作为兜底
3. 输出诊断 JSON，便于 Agent 解析
"""
from __future__ import annotations

import argparse
import json
import shutil
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional

_HERE = Path(__file__).resolve().parent
_ROOT = _HERE.parent
if str(_HERE) not in sys.path:
    sys.path.insert(0, str(_HERE))

from lib import manifest_resolver as mr  # noqa: E402
from lib import stack_detector as sd  # noqa: E402

CAPS_ROOT = _ROOT / "capabilities"
ADAPTERS_ROOT = _ROOT / "auto_adapters"


def cmd_list() -> Dict[str, Any]:
    names = mr.list_capabilities()
    try:
        order = mr.topo_order(names)
    except ValueError as exc:
        return {"ok": False, "error": str(exc), "capabilities": names}
    items = []
    for name in order:
        manifest = mr.load_manifest(name)
        items.append({
            "name": name,
            "type": manifest.get("type"),
            "version": manifest.get("version"),
            "dependencies": mr.dependency_names(manifest),
        })
    return {"ok": True, "order": order, "items": items}


def cmd_check(names: List[str]) -> Dict[str, Any]:
    try:
        order = mr.topo_order(names)
    except ValueError as exc:
        return {"ok": False, "error": str(exc)}
    missing = [n for n in names if not (CAPS_ROOT / n / "manifest.yaml").is_file()]
    if missing:
        return {"ok": False, "error": f"capabilities not found: {missing}"}
    return {"ok": True, "order": order, "requested": names}


def _collect_frontend_assets(names: List[str]) -> List[Dict[str, str]]:
    assets = []
    for name in names:
        manifest = mr.load_manifest(name)
        for asset in manifest.get("frontend_assets", []) or []:
            src = (CAPS_ROOT / name / asset["path"]).resolve()
            assets.append({"capability": name, "source": str(src), "description": asset.get("description", "")})
    return assets


def cmd_render(names: List[str], target_project: Path, apply: bool) -> Dict[str, Any]:
    check = cmd_check(names)
    if not check.get("ok"):
        return check

    result: Dict[str, Any] = {"ok": True, "order": check["order"], "artifacts": []}

    integration_dir = target_project / "ai-interpreter-integration"
    frontend_dir = integration_dir / "frontend"
    backend_dir = integration_dir / "backend"

    assets = _collect_frontend_assets(names)
    if assets:
        if apply:
            frontend_dir.mkdir(parents=True, exist_ok=True)
        for asset in assets:
            src = Path(asset["source"])
            if not src.is_file():
                continue
            dst = frontend_dir / src.name
            if apply:
                shutil.copy2(src, dst)
            result["artifacts"].append({"type": "frontend_asset", "path": str(dst), "description": asset["description"]})

    stack = sd.detect(target_project)
    result["detected_stack"] = stack

    if stack.get("python_backend") in ("fastapi", "flask", "django"):
        tpl_dir = ADAPTERS_ROOT / "python"
        if apply:
            backend_dir.mkdir(parents=True, exist_ok=True)
        for tpl in tpl_dir.glob("*.tpl"):
            dst = backend_dir / tpl.stem  # 去掉 .tpl 后缀
            if apply:
                shutil.copy2(tpl, dst)
            result["artifacts"].append({"type": "backend_adapter", "path": str(dst), "note": "记得替换 ${SKELETON_BASE_URL} 并实现权限校验占位函数"})
    else:
        guide = ADAPTERS_ROOT / "integration_templates" / "generic-rest-api.md"
        result["artifacts"].append({"type": "fallback_guide", "path": str(guide), "note": "未识别出受支持的后端技术栈，请按此文档手动接入 REST API"})

    result["artifacts"].append({
        "type": "security_note",
        "path": str(ADAPTERS_ROOT / "integration_templates" / "room-owner-authz-note.md"),
        "note": "如果装了 meeting-ops，务必阅读并实现权限校验",
    })
    return result


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(prog="add-capability")
    parser.add_argument("capabilities", nargs="*", help="要处理的能力包名（capabilities/ 下的目录名）")
    parser.add_argument("--list", action="store_true", help="列出所有能力包及拓扑顺序")
    parser.add_argument("--check", action="store_true", help="仅校验依赖关系，不做任何文件改动")
    parser.add_argument("--target-project", default="", help="Path B：目标项目根目录，渲染集成资产到这里")
    parser.add_argument("--apply", action="store_true", help="配合 --target-project：真正写文件（不加则只是 dry-run 预览）")
    parser.add_argument("--json", action="store_true", help="输出 JSON（默认已是 JSON，此参数为兼容保留）")
    args = parser.parse_args(argv)

    if args.list:
        out = cmd_list()
    elif args.target_project:
        if not args.capabilities:
            out = {"ok": False, "error": "must specify at least one capability name"}
        else:
            out = cmd_render(args.capabilities, Path(args.target_project).resolve(), apply=args.apply)
    elif args.check or args.capabilities:
        out = cmd_check(args.capabilities)
    else:
        out = cmd_list()

    sys.stdout.write(json.dumps(out, ensure_ascii=False, indent=2))
    sys.stdout.write("\n")
    return 0 if out.get("ok", True) else 1


if __name__ == "__main__":
    sys.exit(main())
