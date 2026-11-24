"""creds_normalizer.py — Replace AI placeholder credentials with eval test creds.

Why this exists
---------------
AI-generated code typically writes ``sdkAppId: 1400000000`` / ``userId: 'user_001'``
/ ``userSig: 'YOUR_USERSIG'`` straight from slice examples — these are deliberate
"do not commit real values to the frontend" placeholders. In production they
would be replaced via backend integration; in eval we have to substitute them
with the test account from ``config.json`` BEFORE the workspace is built and run,
otherwise login fails and the entire dynamic evaluation chain (room lifecycle,
device control, network quality) cannot be exercised.

Where this runs
---------------
``scripts/demo_runner.py`` invokes ``normalize_creds_in_workspace()`` AFTER
``code_injector.inject()`` and BEFORE ``builder.build()``. The AI raw output
(``ai_extracted_code/``) is left untouched — static evaluation continues to
score what the AI actually wrote.

Design rules
------------
1. Conservative matching: only replace literal values that are obviously
   placeholders. When unsure, do nothing — let dynamic eval surface the
   real shortcoming.
2. Audit trail: every replacement is recorded in ``creds_normalization.json``
   alongside the case so reviewers can tell "AI got it right" from
   "normalizer rescued it".
3. UserSig is logged as a 24-char prefix + ellipsis (never the full token).
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

from .eval_config import TrtcTestAccount


# ---------------------------------------------------------------------------
# Placeholder dictionaries — keep these literal so the matching logic stays
# auditable. New patterns should be added with a one-line justification.
# ---------------------------------------------------------------------------

# sdkAppId placeholders. Real production SDKAppIDs are also 14-digit ints, so
# we cannot reject by length alone. The values here are the ones slice examples
# and Tencent docs publicly use; treating them as placeholders is safe.
_PLACEHOLDER_SDK_APP_IDS: set[int] = {
    0,
    1400000000,
    1400000001,
    1400123456,
}

# userId placeholders. The exact value is irrelevant to business correctness —
# what matters is that login() runs at all — so any of these common example
# strings get rewritten to the configured test user_id.
_PLACEHOLDER_USER_IDS: set[str] = {
    "user_001", "user_002", "user_test", "test_user",
    "alice", "bob", "demo_user",
    "your_user_id", "YOUR_USER_ID",
    "replace-me", "REPLACE_ME",
}

# userSig placeholders. Real signatures are base64url (A-Z a-z 0-9 _ - *) and
# at least 32 chars; placeholders are short ASCII tokens that fail that test.
_PLACEHOLDER_USER_SIGS: set[str] = {
    "YOUR_USERSIG", "YOUR_USER_SIG", "YOUR-USERSIG",
    "REPLACE_ME", "replace-me",
    "TEST_USERSIG", "test_sig", "your-usersig",
}

# A real signature looks like this; if a value matches we leave it alone
# (covers the case where the AI happens to hard-code the test creds verbatim).
_LOOKS_LIKE_REAL_USERSIG = re.compile(r"^[A-Za-z0-9*_-]{32,}$")


# ---------------------------------------------------------------------------
# Regex patterns — each captures the assignment shape and the literal value
# so we can selectively rewrite the value while preserving formatting.
# ---------------------------------------------------------------------------

# sdkAppId: 1400000000   |   sdkAppId :  1_400_000_000
_SDK_APP_ID_RE = re.compile(
    r"""(?P<key>\bsdkAppId\b\s*:\s*)(?P<val>\d{1,15}(?:_\d+)*)""",
    re.MULTILINE,
)

# userId: 'user_001'  |  userId : "alice"  |  userId: `bob`
_USER_ID_RE = re.compile(
    r"""(?P<key>\buserId\b\s*:\s*)(?P<q>['"`])(?P<val>[^'"`\n]{0,128})(?P=q)""",
    re.MULTILINE,
)

# userSig: 'YOUR_USERSIG'  |  userSig: ""  |  userSig: `…`
_USER_SIG_RE = re.compile(
    r"""(?P<key>\buserSig\b\s*:\s*)(?P<q>['"`])(?P<val>[^'"`\n]{0,4096})(?P=q)""",
    re.MULTILINE,
)


@dataclass
class _Hit:
    field: str
    line: int
    old_value: str
    new_value: str


# ---------------------------------------------------------------------------
# Predicates — each one decides whether a captured literal is a placeholder.
# Erring on the side of "no" keeps real values safe from accidental rewrite.
# ---------------------------------------------------------------------------

def _is_placeholder_sdk_app_id(raw: str) -> bool:
    try:
        n = int(raw.replace("_", ""))
    except ValueError:
        return False
    return n in _PLACEHOLDER_SDK_APP_IDS


def _is_placeholder_user_id(raw: str) -> bool:
    s = raw.strip()
    if not s:
        return True
    return s in _PLACEHOLDER_USER_IDS


def _is_placeholder_user_sig(raw: str) -> bool:
    s = raw.strip()
    if not s:
        return True
    if s in _PLACEHOLDER_USER_SIGS:
        return True
    # Shapes like "YOUR_…" / "<…>" / "${…}" / "[…]" are obvious placeholders.
    if s.startswith(("YOUR", "<", "${", "[")):
        return True
    # Real signature shape — leave it alone.
    if _LOOKS_LIKE_REAL_USERSIG.match(s):
        return False
    # Anything shorter than 32 chars and not real-shaped is treated as placeholder.
    return len(s) < 32


# ---------------------------------------------------------------------------
# Core normalizer — operates on a single text blob, returns rewritten text +
# list of hits. Pure function, no I/O.
# ---------------------------------------------------------------------------

def _normalize_text(text: str, account: TrtcTestAccount) -> tuple[str, list[_Hit]]:
    hits: list[_Hit] = []

    def _line_of(idx: int) -> int:
        return text.count("\n", 0, idx) + 1

    # We mutate `text` step by step. Line numbers refer to the version of
    # `text` at the moment of the match, which is fine for the audit log
    # (line numbers stay stable as long as we only swap literal values of
    # equal-or-near-equal width — true for all 3 fields here).

    def _repl_sdk(m: re.Match) -> str:
        if _is_placeholder_sdk_app_id(m.group("val")):
            hits.append(_Hit(
                field="sdkAppId",
                line=_line_of(m.start()),
                old_value=m.group("val"),
                new_value=str(account.sdk_app_id),
            ))
            return f'{m.group("key")}{account.sdk_app_id}'
        return m.group(0)

    text = _SDK_APP_ID_RE.sub(_repl_sdk, text)

    def _repl_uid(m: re.Match) -> str:
        if _is_placeholder_user_id(m.group("val")):
            hits.append(_Hit(
                field="userId",
                line=_line_of(m.start()),
                old_value=m.group("val"),
                new_value=account.user_id,
            ))
            return f'{m.group("key")}{m.group("q")}{account.user_id}{m.group("q")}'
        return m.group(0)

    text = _USER_ID_RE.sub(_repl_uid, text)

    def _repl_sig(m: re.Match) -> str:
        old = m.group("val")
        if _is_placeholder_user_sig(old):
            old_preview = (old[:24] + "…") if len(old) > 24 else old or "<empty>"
            new_preview = account.user_sig[:24] + "…"
            hits.append(_Hit(
                field="userSig",
                line=_line_of(m.start()),
                old_value=old_preview,
                new_value=new_preview,
            ))
            return f'{m.group("key")}{m.group("q")}{account.user_sig}{m.group("q")}'
        return m.group(0)

    text = _USER_SIG_RE.sub(_repl_sig, text)

    return text, hits


# ---------------------------------------------------------------------------
# Public API — walks the workspace and returns an audit summary.
# ---------------------------------------------------------------------------

# Files we will rewrite. SFC and JS/TS variants cover Vue/React/vanilla.
_TARGET_SUFFIXES = {".vue", ".ts", ".tsx", ".js", ".jsx", ".mjs"}


def normalize_creds_in_workspace(
    workspace: Path,
    account: TrtcTestAccount,
    extra_dirs: Iterable[Path] = (),
) -> dict:
    """Rewrite placeholder creds in every AI-generated file under ``workspace``.

    Default scope: ``workspace/src/generated/`` (where code_injector lands the
    AI's code). Callers may pass extra_dirs for advanced cases (e.g. unit
    tests pointing at a fixture root).

    Returns a JSON-serializable summary suitable for writing to
    ``creds_normalization.json``::

        {
          "files": [
            {
              "path": "src/generated/App.vue",
              "hits": [
                {"field": "sdkAppId", "line": 150, "old": "1400000000", "new": "1400704311"},
                ...
              ]
            }
          ],
          "total_files_changed": 1,
          "total_hits": 3
        }
    """
    targets: list[Path] = [workspace / "src" / "generated"]
    targets.extend(extra_dirs)

    summary_files: list[dict] = []
    total_hits = 0

    for root in targets:
        if not root.exists():
            continue
        for f in sorted(root.rglob("*")):
            if not f.is_file():
                continue
            if f.suffix.lower() not in _TARGET_SUFFIXES:
                continue
            try:
                original = f.read_text()
            except (OSError, UnicodeDecodeError):
                continue
            new_text, hits = _normalize_text(original, account)
            if not hits:
                continue
            f.write_text(new_text)
            summary_files.append({
                "path": str(f.relative_to(workspace)),
                "hits": [
                    {
                        "field": h.field,
                        "line": h.line,
                        "old": h.old_value,
                        "new": h.new_value,
                    }
                    for h in hits
                ],
            })
            total_hits += len(hits)

    return {
        "files": summary_files,
        "total_files_changed": len(summary_files),
        "total_hits": total_hits,
    }


__all__ = ["normalize_creds_in_workspace"]
