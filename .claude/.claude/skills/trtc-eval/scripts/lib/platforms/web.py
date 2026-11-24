"""Web PlatformAdapter implementation.

NOTE on lifecycle: matching iOS/Android, the Vite dev server is now started by
`log_stream_command` (via scripts/log-bridge.mjs), not by `launch_with_nonce`.
log-bridge is the single entry point: it writes .env.local, spawns `npm run dev`,
waits for the port, attaches Puppeteer, and forwards console events to stdout
(which log_streamer.py pipes to runtime.log). SIGTERM from log_streamer cascades
through log-bridge to the vite child. `launch_with_nonce` and `stop` are no-ops.
"""
from pathlib import Path
import subprocess

from ..eval_config import skill_root
from .base import PlatformAdapter, Device


class WebAdapter(PlatformAdapter):
    platform_id = "web"

    def discover_devices(self, policy: str) -> list[Device]:
        # Web always has a "local" virtual device
        return [Device(kind="simulator", id="local", extra={})]

    def build(self, workspace: Path, compile_log: Path) -> int:
        compile_log.parent.mkdir(parents=True, exist_ok=True)
        with open(compile_log, "w") as log_f:
            # npm ci
            proc = subprocess.run(
                ["npm", "ci"],
                cwd=str(workspace),
                stdout=log_f,
                stderr=subprocess.STDOUT,
                check=False,
            )
            if proc.returncode != 0:
                return proc.returncode
            # npm run build
            proc = subprocess.run(
                ["npm", "run", "build"],
                cwd=str(workspace),
                stdout=log_f,
                stderr=subprocess.STDOUT,
                check=False,
            )
        return proc.returncode

    def install(self, workspace: Path, device: Device) -> int:
        # No-op for web (npm ci already done in build phase)
        return 0

    def launch_with_nonce(self, workspace: Path, device: Device, nonce: str) -> int:
        # No-op: launch (and .env.local injection) is handled by log_stream_command
        # via scripts/log-bridge.mjs. Mirrors the iOS/Android pattern.
        return 0

    def stop(self, workspace: Path, device: Device) -> None:
        # No-op: vite is owned by log-bridge; log_stream_stop's SIGTERM to
        # log-bridge cascades down to the vite child.
        return None

    def log_stream_command(
        self,
        device: Device,
        *,
        nonce: str | None = None,
        workspace: Path | None = None,
    ) -> list[str]:
        # Web uses a Node log-bridge that writes .env.local, starts vite,
        # attaches Puppeteer, and forwards console events to stdout.
        if nonce is None:
            raise ValueError("web log_stream_command requires --nonce")
        if workspace is None:
            raise ValueError("web log_stream_command requires --workspace")
        return [
            "node",
            str(skill_root() / "scripts" / "log-bridge.mjs"),
            "--url",
            "http://127.0.0.1:5173",
            "--nonce",
            nonce,
            "--workspace",
            str(workspace),
        ]
