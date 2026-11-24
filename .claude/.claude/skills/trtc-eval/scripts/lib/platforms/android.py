"""Android PlatformAdapter implementation."""
import subprocess
from pathlib import Path

from .base import PlatformAdapter, Device


class AndroidAdapter(PlatformAdapter):
    platform_id = "android"

    def discover_devices(self, policy: str) -> list[Device]:
        devices: list[Device] = []
        try:
            proc = subprocess.run(
                ["adb", "devices", "-l"],
                capture_output=True, text=True, check=False,
            )
            if proc.returncode != 0:
                return devices
            for line in proc.stdout.strip().splitlines()[1:]:  # skip header
                parts = line.split()
                if len(parts) < 2 or parts[1] != "device":
                    continue
                serial = parts[0]
                kind: str = "simulator" if serial.startswith("emulator-") else "real"
                devices.append(Device(kind=kind, id=serial, extra={}))  # type: ignore[arg-type]
        except FileNotFoundError:
            pass
        return devices

    def build(self, workspace: Path, compile_log: Path) -> int:
        compile_log.parent.mkdir(parents=True, exist_ok=True)
        gradlew = workspace / "gradlew"
        if not gradlew.exists():
            with open(compile_log, "w") as f:
                f.write("ERROR: gradlew not found\n")
            return 1
        with open(compile_log, "w") as log_f:
            proc = subprocess.run(
                ["./gradlew", ":app:assembleDebug"],
                cwd=str(workspace),
                stdout=log_f,
                stderr=subprocess.STDOUT,
                check=False,
            )
        return proc.returncode

    def install(self, workspace: Path, device: Device) -> int:
        apk = workspace / "app" / "build" / "outputs" / "apk" / "debug" / "app-debug.apk"
        if not apk.exists():
            return 1
        proc = subprocess.run(
            ["adb", "-s", device.id, "install", "-r", str(apk)],
            capture_output=True, check=False,
        )
        return proc.returncode

    def launch_with_nonce(self, workspace: Path, device: Device, nonce: str) -> int:
        pkg = "com.template.myapplication"
        activity = f"{pkg}.MainActivity"
        proc = subprocess.run(
            [
                "adb", "-s", device.id, "shell", "am", "start",
                "-n", f"{pkg}/{activity}",
                "--es", "EVAL_RUN_NONCE", nonce,
            ],
            capture_output=True, check=False,
        )
        return proc.returncode

    def stop(self, workspace: Path, device: Device) -> None:
        pkg = "com.template.myapplication"
        subprocess.run(
            ["adb", "-s", device.id, "shell", "am", "force-stop", pkg],
            capture_output=True, check=False,
        )

    def log_stream_command(
        self,
        device: Device,
        *,
        nonce: str | None = None,
        workspace: Path | None = None,
    ) -> list[str]:
        # `nonce`/`workspace` unused on Android (adb logcat captures the
        # already-launched app); accepted for ABC compatibility.
        del nonce, workspace
        return ["adb", "-s", device.id, "logcat", "-s", "TRTCSDK:*", "LiveCore:*"]
