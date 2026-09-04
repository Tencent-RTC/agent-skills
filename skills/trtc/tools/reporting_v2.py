"""Deprecated filename compatibility for reporting.py's CLI only."""

from __future__ import annotations

try:
    from tools.reporting import main
except ImportError:  # direct execution from the tools directory
    from reporting import main


if __name__ == "__main__":
    raise SystemExit(main())
