"""Launcher — install + launch with nonce + timed stop."""
import time
from pathlib import Path
from scripts.lib.platforms.base import PlatformAdapter, Device


def run(adapter: PlatformAdapter, workspace: Path, device: Device,
        nonce: str, duration_sec: int) -> int:
    """Wait duration_sec then stop. Install and launch are handled by log_stream_start.

    The app is already running (launched via log_streamer --console mode).
    This function just waits for the specified duration and then terminates the app.
    """
    time.sleep(duration_sec)
    adapter.stop(workspace, device)
    return 0
