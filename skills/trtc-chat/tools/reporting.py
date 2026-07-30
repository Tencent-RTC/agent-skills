"""Unified reporting shim — delegates to ``skills/trtc/tools/reporting.py``."""

from __future__ import annotations

try:
    from ._delegate import run_trtc_tool_main
except ImportError:  # pragma: no cover - direct script execution
    from _delegate import run_trtc_tool_main  # type: ignore

if __name__ == "__main__":
    raise SystemExit(run_trtc_tool_main("reporting"))
