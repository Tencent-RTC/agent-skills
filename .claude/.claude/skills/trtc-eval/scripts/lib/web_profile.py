"""Web framework profile overlay.

Each eval run selects one framework (vanilla/vue3/vue2/react) and overlays
the corresponding ``templates/web-demo/profiles/<framework>/`` (under the
trtc-eval skill directory) onto the case's workspace BEFORE ``npm ci`` and
code injection. This lets a single thin shell template support multiple
frameworks without forcing them to coexist at runtime.

Public API:
    apply_web_profile(workspace, framework, profiles_root=None)
    detect_web_framework(ai_extracted_dir)
"""
from __future__ import annotations

import json
import re
import shutil
from pathlib import Path
from typing import Any

from .eval_config import skill_root


VALID_FRAMEWORKS = {"vanilla", "vue3", "vue2", "react"}

# Default location of the profile dir tree, anchored on the skill root so it
# is independent of cwd. Callers (mainly tests) can override.
_DEFAULT_PROFILES_ROOT = skill_root() / "templates" / "web-demo" / "profiles"


# ---------------------------------------------------------------------------
# detect_web_framework
# ---------------------------------------------------------------------------

_REACT_HINT_RE = re.compile(
    r"""\bfrom\s+["']react(?:-dom)?["']|\bimport\s+React\b"""
)
_VUE3_HINT_RE = re.compile(r"<script\s+setup\b|\bdefineComponent\s*\(")
_VUE2_HINT_RE = re.compile(r"\bVue\.extend\s*\(|\bexport\s+default\s+\{\s*data\s*\(")


def detect_web_framework(ai_extracted_dir: Path) -> str:
    """Heuristically pick a framework from the shape of AI-generated code."""
    if not ai_extracted_dir.exists():
        return "vanilla"

    has_vue_sfc = False
    has_react_jsx = False
    vue3_signal = False
    vue2_signal = False
    react_signal = False

    for f in ai_extracted_dir.iterdir():
        if not f.is_file():
            continue
        ext = f.suffix.lower()
        try:
            text = f.read_text(errors="replace")
        except OSError:
            continue

        if ext == ".vue":
            has_vue_sfc = True
            if _VUE3_HINT_RE.search(text):
                vue3_signal = True
            elif _VUE2_HINT_RE.search(text):
                vue2_signal = True
        elif ext in (".tsx", ".jsx"):
            has_react_jsx = True
            if _REACT_HINT_RE.search(text):
                react_signal = True
        elif ext in (".ts", ".js", ".mjs"):
            if _REACT_HINT_RE.search(text):
                react_signal = True

    if has_react_jsx or react_signal:
        return "react"
    if has_vue_sfc:
        # Vue 3 is the default when we see a .vue but no clear Options API signal.
        if vue2_signal and not vue3_signal:
            return "vue2"
        return "vue3"
    return "vanilla"


# ---------------------------------------------------------------------------
# apply_web_profile
# ---------------------------------------------------------------------------

def _deep_merge_dict(dst: dict[str, Any], src: dict[str, Any]) -> None:
    """Merge src into dst in place. Dict values are recursively merged;
    all other types are replaced (src wins)."""
    for k, v in src.items():
        if isinstance(v, dict) and isinstance(dst.get(k), dict):
            _deep_merge_dict(dst[k], v)
        else:
            dst[k] = v


def _merge_json_patch(workspace_file: Path, patch_file: Path) -> None:
    if not patch_file.exists():
        return
    if not workspace_file.exists():
        # No file to merge into — just copy the patch as a starter.
        workspace_file.write_text(patch_file.read_text())
        return
    base = json.loads(workspace_file.read_text())
    patch = json.loads(patch_file.read_text())
    if not isinstance(base, dict) or not isinstance(patch, dict):
        raise ValueError(
            f"Cannot merge non-dict JSON: base={workspace_file}, patch={patch_file}"
        )
    _deep_merge_dict(base, patch)
    workspace_file.write_text(json.dumps(base, indent=2, ensure_ascii=False) + "\n")


def _patch_index_html(workspace: Path, framework: str) -> None:
    """Adjust the <script> src in index.html to reference the framework's
    entry file (main.ts vs main.tsx).
    """
    html = workspace / "index.html"
    if not html.exists():
        return
    want_src = "/src/main.tsx" if framework == "react" else "/src/main.ts"
    content = html.read_text()
    patched = re.sub(
        r"""(src\s*=\s*["'])/src/main\.(?:ts|tsx)(["'])""",
        rf"\1{want_src}\2",
        content,
    )
    if patched != content:
        html.write_text(patched)


def apply_web_profile(
    workspace: Path,
    framework: str,
    profiles_root: Path | None = None,
) -> None:
    """Overlay ``profiles/<framework>/`` contents onto ``workspace``.

    Actions:
      - merge ``package.patch.json`` into ``workspace/package.json``
      - if ``tsconfig.patch.json`` exists, merge into ``workspace/tsconfig.json``
      - replace ``workspace/vite.config.ts``
      - replace ``workspace/src/main.ts`` (or remove + create main.tsx for react)
      - copy any ``shim-*.d.ts`` into ``workspace/src/``
      - patch ``workspace/index.html`` to reference the right entry file
    """
    if framework not in VALID_FRAMEWORKS:
        raise ValueError(
            f"unknown framework '{framework}'; must be one of {sorted(VALID_FRAMEWORKS)}"
        )

    root = profiles_root or _DEFAULT_PROFILES_ROOT
    profile_dir = root / framework
    if not profile_dir.is_dir():
        raise FileNotFoundError(f"profile directory missing: {profile_dir}")

    # 1. package.patch.json → workspace/package.json
    _merge_json_patch(
        workspace / "package.json",
        profile_dir / "package.patch.json",
    )

    # 2. tsconfig.patch.json (optional) → workspace/tsconfig.json
    _merge_json_patch(
        workspace / "tsconfig.json",
        profile_dir / "tsconfig.patch.json",
    )

    # 3. vite.config.ts (required)
    vite_src = profile_dir / "vite.config.ts"
    if vite_src.exists():
        shutil.copyfile(vite_src, workspace / "vite.config.ts")

    # 4. Entry file: main.ts or main.tsx. Remove the "wrong" one so only the
    #    framework's entry remains — avoids Vite serving stale bootstrap code.
    for old_entry in ("src/main.ts", "src/main.tsx"):
        old = workspace / old_entry
        if old.exists():
            old.unlink()

    for candidate in ("main.ts", "main.tsx"):
        src = profile_dir / candidate
        if src.exists():
            dst = workspace / "src" / candidate
            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(src, dst)

    # 5. Shim files — any *.d.ts that isn't a patch descriptor
    for shim in profile_dir.glob("*.d.ts"):
        shutil.copyfile(shim, workspace / "src" / shim.name)

    # 6. index.html — point to the right entry file extension
    _patch_index_html(workspace, framework)


__all__ = ["apply_web_profile", "detect_web_framework", "VALID_FRAMEWORKS"]
