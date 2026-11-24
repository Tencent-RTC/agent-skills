"""Builder — dispatches to PlatformAdapter.build()."""
from pathlib import Path
from scripts.lib.platforms.base import PlatformAdapter


def build(adapter: PlatformAdapter, workspace: Path, compile_log: Path) -> int:
    """Compile workspace using the given adapter. Returns exit code."""
    compile_log.parent.mkdir(parents=True, exist_ok=True)
    return adapter.build(workspace, compile_log)
