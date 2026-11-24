"""Loader for the TRTC eval skill's config.json.

Single source of truth for TRTC test credentials. Resolution is per-field:

    1. .claude/skills/trtc-eval/config.json → trtc_test_account.{sdk_app_id, user_id, user_sig}
    2. Shell env vars TRTC_TEST_SDKAPPID / TRTC_TEST_USERID / TRTC_TEST_USERSIG

Any field still missing/empty after both sources triggers EvalConfigError with
a clear pointer to config.example.json.

This module intentionally does NOT read development_team / device_policy /
cli driver selection — those remain shell env vars (EVAL_DEVELOPMENT_TEAM,
EVAL_DEVICE_POLICY) so this PR's blast radius stays minimal.
"""
from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path


def skill_root() -> Path:
    """Absolute path to the trtc-eval skill directory.

    eval_config.py lives at <skill_root>/scripts/lib/eval_config.py, so we walk
    up three levels to reach the skill root. Every script in the engine should
    derive data paths (cases.json, templates/, etc.) from this anchor so that
    cwd no longer matters.
    """
    return Path(__file__).resolve().parent.parent.parent


def repo_root() -> Path:
    """Absolute path to the repo root (the directory containing .claude/).

    Layout: <repo>/.claude/skills/trtc-eval/scripts/lib/eval_config.py — five
    parents up from this file. Used for paths that intentionally stay outside
    the skill (e.g. .claude/eval-runs/ which is shared with other skills).
    """
    return Path(__file__).resolve().parents[5]


CONFIG_PATH = skill_root() / "config.json"
EXAMPLE_PATH = skill_root() / "config.example.json"


class EvalConfigError(Exception):
    """Raised when required credentials cannot be assembled from any source."""


@dataclass(frozen=True)
class TrtcTestAccount:
    sdk_app_id: int
    user_id: str
    user_sig: str


@dataclass(frozen=True)
class EvalConfig:
    trtc_test_account: TrtcTestAccount
    # "config.json" — every field came from config.json
    # "shell_env"   — every field came from shell env vars
    # "mixed"       — some fields from config.json, some from env
    source: str


def _load_raw_config() -> dict:
    """Read config.json. Returns {} if the file is missing (fallback path)."""
    if not CONFIG_PATH.exists():
        return {}
    try:
        data = json.loads(CONFIG_PATH.read_text())
    except json.JSONDecodeError as e:
        raise EvalConfigError(
            f"{CONFIG_PATH} is not valid JSON: {e.msg} at line {e.lineno}. "
            f"Compare with {EXAMPLE_PATH}."
        ) from e
    if not isinstance(data, dict):
        raise EvalConfigError(f"{CONFIG_PATH} must be a JSON object, got {type(data).__name__}")
    return data


def _pick_sdk_app_id(from_config: object | None, from_env: str | None) -> tuple[int, str] | tuple[None, None]:
    """Return (value, source) or (None, None) if unresolved.

    ``source`` is "config" or "env". config.json wins when non-empty/valid;
    env is the fallback. A placeholder "replace-me" style string is treated
    as "not really filled" and falls through to env.
    """
    # Try config.json first
    if isinstance(from_config, int) and from_config > 0:
        return from_config, "config"
    if isinstance(from_config, str) and from_config.strip() and from_config.strip() != "replace-me":
        try:
            v = int(from_config.strip())
            if v > 0:
                return v, "config"
        except ValueError:
            pass
    # Env fallback
    if from_env:
        try:
            v = int(from_env.strip())
            if v > 0:
                return v, "env"
        except ValueError:
            pass
    return None, None


def _pick_str(from_config: object | None, from_env: str | None) -> tuple[str, str] | tuple[None, None]:
    if isinstance(from_config, str):
        v = from_config.strip()
        # Treat example placeholders as unset so operators can't commit a
        # config.json that silently shadows their real shell env fallback.
        if v and not v.startswith("replace-me"):
            return v, "config"
    if from_env:
        v = from_env.strip()
        if v:
            return v, "env"
    return None, None


def load_config() -> EvalConfig:
    raw = _load_raw_config()
    account = raw.get("trtc_test_account", {}) if isinstance(raw, dict) else {}
    if not isinstance(account, dict):
        raise EvalConfigError(
            f"{CONFIG_PATH}.trtc_test_account must be an object, got {type(account).__name__}"
        )

    sdk_app_id, src_sdk = _pick_sdk_app_id(
        account.get("sdk_app_id"),
        os.environ.get("TRTC_TEST_SDKAPPID"),
    )
    user_id, src_uid = _pick_str(
        account.get("user_id"),
        os.environ.get("TRTC_TEST_USERID"),
    )
    user_sig, src_sig = _pick_str(
        account.get("user_sig"),
        os.environ.get("TRTC_TEST_USERSIG"),
    )

    missing: list[str] = []
    if sdk_app_id is None:
        missing.append("sdk_app_id / $TRTC_TEST_SDKAPPID (positive integer)")
    if user_id is None:
        missing.append("user_id / $TRTC_TEST_USERID (non-empty string)")
    if user_sig is None:
        missing.append("user_sig / $TRTC_TEST_USERSIG (non-empty string)")
    if missing:
        raise EvalConfigError(
            "TRTC test credentials incomplete. Missing:\n"
            + "\n".join(f"  - {m}" for m in missing)
            + f"\n\nFix one of:\n"
            f"  1. Create {CONFIG_PATH} (template: {EXAMPLE_PATH})\n"
            f"  2. Export shell env vars TRTC_TEST_SDKAPPID / TRTC_TEST_USERID / TRTC_TEST_USERSIG\n"
        )

    sources = {src_sdk, src_uid, src_sig}
    if sources == {"config"}:
        source = "config.json"
    elif sources == {"env"}:
        source = "shell_env"
    else:
        source = "mixed"

    return EvalConfig(
        trtc_test_account=TrtcTestAccount(
            sdk_app_id=sdk_app_id,
            user_id=user_id,
            user_sig=user_sig,
        ),
        source=source,
    )


__all__ = [
    "EvalConfig",
    "TrtcTestAccount",
    "EvalConfigError",
    "load_config",
    "CONFIG_PATH",
    "EXAMPLE_PATH",
    "skill_root",
    "repo_root",
]
