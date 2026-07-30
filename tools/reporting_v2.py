"""Deprecated compatibility entrypoint for the unified TRTC reporting helper."""
from __future__ import annotations

import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from skills.trtc.tools.reporting import *  # noqa: F401,F403
from skills.trtc.tools.reporting import main

if __name__ == "__main__":
    sys.exit(main())
