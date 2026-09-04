"""Load and run modules from sibling ``skills/trtc/tools/``."""

from __future__ import annotations

import importlib.util
import inspect
import sys
from pathlib import Path
from types import ModuleType

_TRTC_TOOLS = Path(__file__).resolve().parent.parent.parent / "trtc" / "tools"


def load_trtc_tool_module(name: str) -> ModuleType:
    target = _TRTC_TOOLS / f"{name}.py"
    if not target.is_file():
        raise ImportError(f"TRTC tool not found: {target}")
    module_name = f"_trtc_tools_{name}"
    spec = importlib.util.spec_from_file_location(module_name, target)
    if spec is None or spec.loader is None:
        raise ImportError(f"Cannot load TRTC tool module: {target}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module
    spec.loader.exec_module(module)
    return module


def run_trtc_tool_main(name: str, argv: list[str] | None = None) -> int:
    module = load_trtc_tool_module(name)
    main = getattr(module, "main", None)
    if main is None:
        raise ImportError(f"{name}.py has no main()")
    # Canonical tools written with argparse read sys.argv directly, while
    # newer tools expose main(argv).  Domain shims must support both without
    # catching an unrelated TypeError raised inside the tool.
    if len(inspect.signature(main).parameters) == 0:
        return main()
    return main(argv)
