"""PlatformAdapter ABC — the contract every platform must implement."""
from abc import ABC, abstractmethod
from dataclasses import dataclass
from pathlib import Path
from typing import Literal


@dataclass(frozen=True)
class Device:
    kind: Literal["real", "simulator"]
    id: str
    extra: dict


class PlatformAdapter(ABC):
    """Six-method contract. Implement all six to support a new platform."""

    platform_id: str

    @abstractmethod
    def discover_devices(self, policy: str) -> list[Device]:
        """Return available devices sorted by preference. Empty => no device."""

    @abstractmethod
    def build(self, workspace: Path, compile_log: Path) -> int:
        """Compile. Redirect stdout/stderr to compile_log. Return exit code."""

    @abstractmethod
    def install(self, workspace: Path, device: Device) -> int:
        """Install build artifacts onto device. Return exit code."""

    @abstractmethod
    def launch_with_nonce(self, workspace: Path, device: Device, nonce: str) -> int:
        """Launch demo with EVAL_RUN_NONCE injected. Return immediately (non-blocking)."""

    @abstractmethod
    def stop(self, workspace: Path, device: Device) -> None:
        """Gracefully stop the demo process."""

    @abstractmethod
    def log_stream_command(
        self,
        device: Device,
        *,
        nonce: str | None = None,
        workspace: Path | None = None,
    ) -> list[str]:
        """Return a command array for subprocess.Popen whose stdout IS runtime.log content.
        This method MUST NOT start the process itself.

        If nonce is provided, the command should launch the app with --console
        (combining launch + log capture in one process).

        `workspace` is used by platforms whose log stream driver must know the
        demo project path (e.g., Web's log-bridge spawning `npm run dev`).
        Native platforms (iOS/Android) can ignore it.
        """

    def ensure_booted(self, device: Device) -> int:
        """Ensure device is ready to receive installs/launches. Return exit code (0=ok).

        Default implementation is a no-op. Override for platforms that need explicit boot
        (e.g., iOS simulators).
        """
        return 0
