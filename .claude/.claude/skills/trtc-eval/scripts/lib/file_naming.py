"""Platform-agnostic filename resolver for AI-extracted code blocks.

When cases.json does not specify a ``demo_injection_map`` (or only partially
covers the AI-produced blocks), the eval pipeline still needs to figure out
where each ``ai_extracted_code/<original>`` file should land inside the demo
workspace. This module codifies the resolution rules in one place, so every
platform (web/iOS/Android) uses the same logic.

Rules (priority, high → low):

  Layer A — header-comment filename hint
      The AI very often writes the intended filename in the first few lines
      of a block, e.g. ``// auth.ts — 登录……`` or ``<!-- App.vue — 根组件 -->``.
      We scan the first 5 non-blank lines of each block with a regex that
      captures ``<name>.<ext>`` where ``ext`` is a recognised source extension.

  Layer B — relative import reverse-inference
      If block X imports ``./auth`` (relative import without extension) and
      exactly one other block has a matching code extension and no name yet,
      that block's logical name becomes ``auth.<that-block-ext>``.

  Layer C — framework default entry
      After A+B, the first still-unnamed block of the framework's "primary"
      extension becomes the framework default entry (App.vue, App.tsx,
      index.ts depending on framework).

  Layer D — fallback
      Any block still unnamed keeps its original filename
      (``block_NN.<ext>``).

A block whose extension is not in the platform's "code" set is classified as
``config`` (e.g. plist/xml for iOS, json/yml for web) or ``unknown``. Callers
decide whether to route config files — by default the pipeline parks them in
``case_dir/ai_unrouted/``.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path


# Extensions that resolve() treats as real source code per platform.
# Everything else is "config" or "unknown" and is not auto-routed.
_PLATFORM_CODE_EXTS = {
    "web": {".ts", ".tsx", ".js", ".jsx", ".mjs", ".vue"},
    "ios": {".swift", ".m", ".mm", ".h"},
    "android": {".kt", ".java"},
    "flutter": {".dart"},
}

_PLATFORM_CONFIG_EXTS = {
    "web": {".json", ".yml", ".yaml", ".html", ".css"},
    "ios": {".plist", ".xml", ".xcconfig"},
    "android": {".xml", ".gradle", ".pro"},
    "flutter": {".yaml"},
}

# Framework -> (primary extension, default entry filename)
_FRAMEWORK_ENTRY: dict[str, tuple[str, str]] = {
    "vanilla": (".ts", "index.ts"),
    "vue3": (".vue", "App.vue"),
    "vue2": (".vue", "App.vue"),
    "react": (".tsx", "App.tsx"),
}

# Layer A regex — matches a filename with a recognised code extension anywhere
# near the top of a comment line. Greedy on the identifier side but bounded
# by the extension whitelist, so we don't capture arbitrary words ending in ".xx".
_FILENAME_HINT_RE = re.compile(
    r"[A-Za-z_][\w.\-]*\.(?:ts|tsx|js|jsx|mjs|vue|swift|kt|java|m|mm|h|dart)\b"
)

# Comment-line detector — // ... | /* ... | <!-- ... | # ... (bash/python style)
_COMMENT_LINE_RE = re.compile(r"^\s*(?://|/\*|<!--|\*|\#)")

# Layer B regex — relative imports like:  from "./auth" | from './auth'
# Also matches `import "./auth"` (side-effect imports).
_RELATIVE_IMPORT_RE = re.compile(
    r"""(?:from|import)\s+["'](\./[^"']+)["']"""
)


@dataclass
class ResolvedName:
    logical_name: str        # e.g. "auth.ts", "App.vue"
    kind: str                # "code" | "config" | "unknown"
    source_layer: str        # "A" | "B" | "C" | "D" | "explicit"
    is_entry: bool = False   # True when this is the framework default entry


def _first_n_nonblank_lines(text: str, n: int = 5) -> list[str]:
    out: list[str] = []
    for line in text.splitlines():
        stripped = line.strip()
        if not stripped:
            continue
        out.append(line)
        if len(out) >= n:
            break
    return out


def _classify_kind(ext: str, platform: str) -> str:
    if ext in _PLATFORM_CODE_EXTS.get(platform, set()):
        return "code"
    if ext in _PLATFORM_CONFIG_EXTS.get(platform, set()):
        return "config"
    return "unknown"


def _layer_a_hint(block_text: str, platform: str) -> str | None:
    """Return the filename mentioned in a leading comment, or None.

    Only consumes lines that *look* like comments — a stray ``App.vue`` deep
    in code won't be mistaken for a hint.
    """
    for line in _first_n_nonblank_lines(block_text, 5):
        if not _COMMENT_LINE_RE.match(line):
            continue
        m = _FILENAME_HINT_RE.search(line)
        if m:
            return m.group(0)
    return None


def _all_relative_imports(block_text: str) -> list[str]:
    """Return deduped list of relative import stems like ``./auth``."""
    seen: list[str] = []
    for m in _RELATIVE_IMPORT_RE.finditer(block_text):
        stem = m.group(1)
        if stem not in seen:
            seen.append(stem)
    return seen


def resolve_ai_filenames(
    ai_code_dir: Path,
    platform: str,
    framework: str | None = None,
) -> dict[str, ResolvedName]:
    """Resolve logical names for every file in ``ai_code_dir``.

    Returns ``{original_filename: ResolvedName}``. Only entries with
    ``kind == "code"`` should be routed into the workspace; callers handle
    ``config`` / ``unknown`` separately.
    """
    if not ai_code_dir.exists():
        return {}

    # Load all blocks up front — Layer B needs cross-block visibility.
    files = sorted(p for p in ai_code_dir.iterdir() if p.is_file())
    texts: dict[str, str] = {}
    for f in files:
        try:
            texts[f.name] = f.read_text(errors="replace")
        except OSError:
            texts[f.name] = ""

    resolved: dict[str, ResolvedName] = {}

    # Layer A — header comment filename hint
    for f in files:
        hint = _layer_a_hint(texts[f.name], platform)
        if hint:
            kind = _classify_kind("." + hint.rsplit(".", 1)[-1].lower(), platform)
            resolved[f.name] = ResolvedName(
                logical_name=hint, kind=kind, source_layer="A"
            )

    # Layer B — relative-import reverse-inference.
    # For each unresolved file, check whether another resolved block imports
    # a relative path that matches this file's extension. Vice versa: if a
    # file IS imported by another block's `from "./foo"`, rename it to foo.<ext>.
    def _ext_of(name: str) -> str:
        return ("." + name.rsplit(".", 1)[-1]).lower() if "." in name else ""

    # Build inverse lookup: every relative import stem observed, source block
    stem_sources: list[tuple[str, str]] = []  # (stem, source_block_filename)
    for f in files:
        for stem in _all_relative_imports(texts[f.name]):
            stem_sources.append((stem, f.name))

    for f in files:
        if f.name in resolved:
            continue
        ext = _ext_of(f.name)
        if not ext:
            continue
        # Find a stem that nobody else with this ext has claimed.
        for stem, _src in stem_sources:
            wanted = Path(stem).name  # './auth' -> 'auth'
            candidate = f"{wanted}{ext}"
            # Don't collide with any already-resolved logical name
            if any(r.logical_name == candidate for r in resolved.values()):
                continue
            # Require the stem to at least plausibly match this file
            # (avoid blindly renaming every leftover block). Heuristic: pick the
            # FIRST unresolved file whose extension matches a missing import.
            resolved[f.name] = ResolvedName(
                logical_name=candidate,
                kind=_classify_kind(ext, platform),
                source_layer="B",
            )
            break

    # Layer C / entry enforcement — the profile's main.ts imports a fixed
    # filename (App.vue / App.tsx / index.ts), so for frameworks that need a
    # specific entry we guarantee one block lands on it.
    #
    # Decision logic:
    #   1. If some block's Layer A/B/D result already equals the default entry,
    #      mark it as entry.
    #   2. Otherwise, promote the FIRST block of the primary extension to the
    #      default entry, overriding its Layer A hint if any. We remember the
    #      original hint in ``source_layer`` for debugging.
    if platform == "web" and framework in _FRAMEWORK_ENTRY:
        primary_ext, default_entry = _FRAMEWORK_ENTRY[framework]
        entry_owner: str | None = None
        for name, rn in resolved.items():
            if rn.logical_name == default_entry:
                entry_owner = name
                break
        if entry_owner is None:
            # Promote: pick the first primary-ext file (resolved or not)
            for f in files:
                if _ext_of(f.name) != primary_ext:
                    continue
                rn = resolved.get(f.name)
                if rn is None:
                    resolved[f.name] = ResolvedName(
                        logical_name=default_entry,
                        kind="code",
                        source_layer="C",
                        is_entry=True,
                    )
                else:
                    original = rn.logical_name
                    rn.logical_name = default_entry
                    rn.is_entry = True
                    rn.source_layer = f"C-promoted(was:{original};layer:{rn.source_layer})"
                entry_owner = f.name
                break
        if entry_owner is not None:
            resolved[entry_owner].is_entry = True

    # Layer D — fallback to original filename
    for f in files:
        if f.name in resolved:
            continue
        ext = _ext_of(f.name)
        resolved[f.name] = ResolvedName(
            logical_name=f.name,
            kind=_classify_kind(ext, platform),
            source_layer="D",
        )

    return resolved


__all__ = ["resolve_ai_filenames", "ResolvedName"]
