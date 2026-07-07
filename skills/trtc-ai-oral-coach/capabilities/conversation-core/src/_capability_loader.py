"""Dynamic loader for sibling capability packages (independent of cwd / repo directory name / hyphens).

Why this module?
================
Capability directories use hyphenated names (e.g. ``knowledge-base``, ``human-handoff``),
but Python ``import`` syntax cannot recognize hyphens. Additionally, the ``start.sh``
process working directory is ``capabilities/conversation-core/``, so the project root
is NOT in ``sys.path``. Therefore, the import style in manifest.yaml:

    from capabilities.knowledge_base.src.retriever import attach_faq_to_instructions

will **never work** — it implicitly assumes:
1. Directory names use underscores (they actually use hyphens);
2. The project root is in ``sys.path`` (it is not).

This module uses ``importlib.util`` to proactively register each directory level as a
valid Python package, bypassing package name restrictions; the project root is derived
from ``__file__``, so **renaming the repo directory has no effect**. Relative imports
such as ``from .x import y`` inside sub-modules also work correctly.

Usage
-----
    from ._capability_loader import load_capability

    retriever = load_capability("knowledge-base", "src/retriever.py")
    new_text = retriever.attach_faq_to_instructions(text)

    router_mod = load_capability("knowledge-base", "src/router.py")
    app.include_router(router_mod.router, prefix="/api/v1/kb")
"""
from __future__ import annotations

import importlib.util
import logging
import sys
from pathlib import Path
from threading import RLock
from types import ModuleType
from typing import Optional

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Path resolution: derive repo_root from __file__, independent of cwd / repo directory name
# This file is at <repo_root>/capabilities/conversation-core/src/_capability_loader.py
# parents[3] = <repo_root>
# ---------------------------------------------------------------------------
_HERE = Path(__file__).resolve()
_REPO_ROOT = _HERE.parents[3]
_CAPABILITIES_ROOT = _REPO_ROOT / "capabilities"

_CAPS_NAMESPACE = "_capabilities"

_lock = RLock()
_module_cache: dict[str, ModuleType] = {}


def repo_root() -> Path:
    """Return the repo root directory (the level containing ``capabilities/``)."""
    return _REPO_ROOT


def capabilities_root() -> Path:
    return _CAPABILITIES_ROOT


def _safe_name(part: str) -> str:
    """Convert a directory segment to a valid Python identifier (hyphens → underscores)."""
    return part.replace("-", "_")


def _ensure_namespace_root() -> ModuleType:
    """Register the ``_capabilities`` top-level namespace package in ``sys.modules``."""
    mod = sys.modules.get(_CAPS_NAMESPACE)
    if mod is not None:
        return mod
    spec = importlib.util.spec_from_loader(_CAPS_NAMESPACE, loader=None, is_package=True)
    if spec is None:
        raise RuntimeError("failed to build namespace spec")
    mod = importlib.util.module_from_spec(spec)
    mod.__path__ = [str(_CAPABILITIES_ROOT)]  # Let importlib find sub-packages under this directory
    sys.modules[_CAPS_NAMESPACE] = mod
    return mod


def _ensure_package(qualified_name: str, dir_path: Path) -> ModuleType:
    """Register ``dir_path`` as a Python package named ``qualified_name``.

    If a ``__init__.py`` with the same name exists, exec it normally; otherwise treat as a namespace package.
    Idempotent: if already in ``sys.modules``, returns immediately.
    """
    cached = sys.modules.get(qualified_name)
    if cached is not None:
        return cached

    init_file = dir_path / "__init__.py"
    if init_file.is_file():
        spec = importlib.util.spec_from_file_location(
            qualified_name,
            init_file,
            submodule_search_locations=[str(dir_path)],
        )
    else:
        spec = importlib.util.spec_from_loader(qualified_name, loader=None, is_package=True)
    if spec is None:
        raise ModuleNotFoundError(f"failed to build spec for package: {qualified_name}")

    pkg = importlib.util.module_from_spec(spec)
    if not hasattr(pkg, "__path__"):
        pkg.__path__ = [str(dir_path)]  # type: ignore[attr-defined]
    sys.modules[qualified_name] = pkg

    if init_file.is_file() and spec.loader is not None:
        try:
            spec.loader.exec_module(pkg)
        except Exception:
            sys.modules.pop(qualified_name, None)
            raise
    return pkg


def load_capability(cap_name: str, module_rel: str) -> ModuleType:
    """Load a Python file under a given capability package and return its module object.

    Parameters
    ----------
    cap_name
        Capability directory name, e.g. ``"knowledge-base"`` (with hyphens).
    module_rel
        Python file path relative to the capability root, e.g. ``"src/retriever.py"``.

    Returns
    -------
    ModuleType
        The executed module object. Raises :class:`ModuleNotFoundError` on failure.

    Notes
    -----
    - In-process cache: the same ``(cap_name, module_rel)`` is loaded only once.
    - Full module name is e.g. ``_capabilities.<cap_safe>.<dir>.<basename>``,
      so relative imports like ``from .x import y`` inside capabilities work correctly.
    """
    cache_key = f"{cap_name}::{module_rel}"
    with _lock:
        cached = _module_cache.get(cache_key)
        if cached is not None:
            return cached

    cap_dir = _CAPABILITIES_ROOT / cap_name
    file_path = cap_dir / module_rel
    if not file_path.is_file():
        raise ModuleNotFoundError(
            f"capability '{cap_name}' module '{module_rel}' not found at {file_path}"
        )

    # 1) Top-level namespace _capabilities.*
    _ensure_namespace_root()

    # 2) Capability package name _capabilities.<cap_safe>
    cap_safe = _safe_name(cap_name)
    cap_qual = f"{_CAPS_NAMESPACE}.{cap_safe}"
    _ensure_package(cap_qual, cap_dir)

    # 3) Register each intermediate directory level as a sub-package
    rel_parts = Path(module_rel).parts
    *dir_parts, leaf = rel_parts
    parent_qual = cap_qual
    parent_dir = cap_dir
    for part in dir_parts:
        parent_dir = parent_dir / part
        parent_qual = f"{parent_qual}.{_safe_name(part)}"
        _ensure_package(parent_qual, parent_dir)

    # 4) Load leaf module
    leaf_basename = Path(leaf).stem
    leaf_qual = f"{parent_qual}.{_safe_name(leaf_basename)}"

    cached_leaf = sys.modules.get(leaf_qual)
    if cached_leaf is not None:
        with _lock:
            _module_cache[cache_key] = cached_leaf
        return cached_leaf

    spec = importlib.util.spec_from_file_location(leaf_qual, file_path)
    if spec is None or spec.loader is None:
        raise ModuleNotFoundError(
            f"failed to build spec for capability '{cap_name}' / '{module_rel}'"
        )
    module = importlib.util.module_from_spec(spec)
    sys.modules[leaf_qual] = module
    try:
        spec.loader.exec_module(module)
    except Exception:
        sys.modules.pop(leaf_qual, None)
        raise

    with _lock:
        _module_cache[cache_key] = module
    logger.debug("capability loaded: %s -> %s", leaf_qual, file_path)
    return module


def try_load_capability(
    cap_name: str, module_rel: str
) -> Optional[ModuleType]:
    """Same as :func:`load_capability`, but returns ``None`` on failure instead of raising.

    Suitable for "capability is optionally installed" scenarios: silently degrades
    on missing, without affecting skeleton operation.
    """
    try:
        return load_capability(cap_name, module_rel)
    except Exception as exc:  # noqa: BLE001
        logger.info(
            "capability '%s' module '%s' not loaded (skipped): %s",
            cap_name, module_rel, exc,
        )
        return None


# ---------------------------------------------------------------------------
# 全局模块别名：让任意能力都能 `import cap_loader` 拿到与 core 同一份 loader，
# 从而实现"能力互相调用"（例如 scenario-roleplay 按需调用 custom-learning-kb），
# 而不必知道 conversation-core 的包路径。用法同 core/report_llm.py 的
# `coach_report_llm` 别名模式。
# ---------------------------------------------------------------------------
sys.modules.setdefault("cap_loader", sys.modules[__name__])
