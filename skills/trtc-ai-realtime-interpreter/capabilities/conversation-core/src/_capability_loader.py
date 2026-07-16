# -*- coding: utf-8 -*-
"""兄弟能力包（capabilities/*）的动态加载器（与 cwd / 目录名无关）。

能力目录用连字符命名（realtime-translation / meeting-ops），Python import 语法不认连字符；
且各能力包内部模块用「平铺 import」（不用包内相对导入），因此加载前需要把目标能力包的
src 目录临时加进 sys.path，再普通 import。

用法：
    from _capability_loader import try_load_capability
    mod = try_load_capability("meeting-ops", "src/router.py")
    if mod is not None:
        app.include_router(mod.router, prefix="/api/v1/meeting")
"""
from __future__ import annotations

import importlib.util
import logging
import sys
from pathlib import Path
from types import ModuleType
from typing import Optional

logger = logging.getLogger(__name__)

# 本文件位于 <skill_root>/capabilities/conversation-core/src/_capability_loader.py
# parents[0]=src parents[1]=conversation-core parents[2]=capabilities parents[3]=skill_root
_HERE = Path(__file__).resolve()
_SKILL_ROOT = _HERE.parents[3]
_CAPABILITIES_ROOT = _SKILL_ROOT / "capabilities"

_module_cache: dict[str, ModuleType] = {}


def skill_root() -> Path:
    return _SKILL_ROOT


def capabilities_root() -> Path:
    return _CAPABILITIES_ROOT


def load_capability(cap_name: str, module_rel: str) -> ModuleType:
    """加载 capabilities/<cap_name>/<module_rel> 并返回模块对象。

    会把该能力包的 src 目录加入 sys.path（一次性、幂等），使其内部的平铺 import 生效。
    """
    cache_key = f"{cap_name}::{module_rel}"
    cached = _module_cache.get(cache_key)
    if cached is not None:
        return cached

    cap_dir = _CAPABILITIES_ROOT / cap_name
    file_path = cap_dir / module_rel
    if not file_path.is_file():
        raise ModuleNotFoundError(f"capability '{cap_name}' module '{module_rel}' not found at {file_path}")

    src_dir = str(file_path.parent)
    if src_dir not in sys.path:
        sys.path.insert(0, src_dir)

    mod_name = f"_capabilities_{cap_name.replace('-', '_')}_{file_path.stem}"
    cached_mod = sys.modules.get(mod_name)
    if cached_mod is not None:
        _module_cache[cache_key] = cached_mod
        return cached_mod

    spec = importlib.util.spec_from_file_location(mod_name, file_path)
    if spec is None or spec.loader is None:
        raise ModuleNotFoundError(f"failed to build spec for '{cap_name}'/'{module_rel}'")
    module = importlib.util.module_from_spec(spec)
    sys.modules[mod_name] = module
    try:
        spec.loader.exec_module(module)
    except Exception:
        sys.modules.pop(mod_name, None)
        raise

    _module_cache[cache_key] = module
    logger.debug("capability loaded: %s -> %s", mod_name, file_path)
    return module


def try_load_capability(cap_name: str, module_rel: str) -> Optional[ModuleType]:
    """同 load_capability，但失败时返回 None（用于「可选安装」场景，静默降级）。"""
    try:
        return load_capability(cap_name, module_rel)
    except Exception as exc:  # noqa: BLE001
        logger.info("capability '%s' module '%s' not loaded (skipped): %s", cap_name, module_rel, exc)
        return None
