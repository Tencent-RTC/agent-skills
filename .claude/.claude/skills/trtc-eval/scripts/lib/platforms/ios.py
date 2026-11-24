"""iOS PlatformAdapter implementation."""
import json
import os
import subprocess
from pathlib import Path

from .base import PlatformAdapter, Device


class IOSAdapter(PlatformAdapter):
    platform_id = "ios"

    _BUNDLE_ID = "com.template.MyApplication"
    _SCHEME = "MyApplication"

    def _should_build_for_device(self) -> bool:
        """Check EVAL_DEVICE_POLICY to determine if we should build for real device."""
        policy = os.environ.get("EVAL_DEVICE_POLICY", "prefer-simulator")
        return policy in ("prefer-real", "real-only")

    def discover_devices(self, policy: str) -> list[Device]:
        devices: list[Device] = []
        devices.extend(self._discover_real_devices())
        devices.extend(self._discover_simulators())
        if policy == "simulator":
            devices.sort(key=lambda d: 0 if d.kind == "simulator" else 1)
        else:
            devices.sort(key=lambda d: 0 if d.kind == "real" else 1)
        return devices

    def _discover_real_devices(self) -> list[Device]:
        devices: list[Device] = []
        import tempfile
        try:
            with tempfile.NamedTemporaryFile(suffix=".json", delete=False) as tmp:
                tmp_path = tmp.name
            proc = subprocess.run(
                ["xcrun", "devicectl", "list", "devices", "--json-output", tmp_path],
                capture_output=True, text=True, check=False,
            )
            if proc.returncode != 0:
                return devices
            with open(tmp_path, "r") as f:
                data = json.load(f)
            os.unlink(tmp_path)
            for entry in data.get("result", {}).get("devices", []):
                conn_props = entry.get("connectionProperties", {})
                if conn_props.get("transportType") in ("localNetwork", "wired"):
                    udid = entry.get("hardwareProperties", {}).get("udid", "")
                    name = entry.get("deviceProperties", {}).get("name", "")
                    if udid:
                        devices.append(Device(kind="real", id=udid, extra={"name": name}))
        except (FileNotFoundError, json.JSONDecodeError):
            pass
        return devices

    def _discover_simulators(self) -> list[Device]:
        devices: list[Device] = []
        try:
            proc = subprocess.run(
                ["xcrun", "simctl", "list", "devices", "--json"],
                capture_output=True, text=True, check=False,
            )
            if proc.returncode != 0:
                return devices
            data = json.loads(proc.stdout)
            for runtime, devs in data.get("devices", {}).items():
                if "iOS" not in runtime:
                    continue
                for dev in devs:
                    if not dev.get("isAvailable", False):
                        continue
                    state = dev.get("state", "")
                    udid = dev.get("udid", "")
                    name = dev.get("name", "")
                    devices.append(Device(
                        kind="simulator",
                        id=udid,
                        extra={"name": name, "state": state, "runtime": runtime},
                    ))
            devices.sort(key=lambda d: 0 if d.extra.get("state") == "Booted" else 1)
        except (FileNotFoundError, json.JSONDecodeError):
            pass
        return devices

    def ensure_booted(self, device: Device) -> int:
        if device.kind == "real":
            return 0
        if device.extra.get("state") == "Booted":
            return 0
        proc = subprocess.run(
            ["xcrun", "simctl", "boot", device.id],
            capture_output=True, check=False,
        )
        if proc.returncode in (0, 149):
            return 0
        return proc.returncode

    def build(self, workspace: Path, compile_log: Path) -> int:
        compile_log.parent.mkdir(parents=True, exist_ok=True)
        xcodeproj = workspace / f"{self._SCHEME}.xcodeproj"
        xcworkspace = workspace / f"{self._SCHEME}.xcworkspace"

        for_device = self._should_build_for_device()
        if for_device:
            sdk = "iphoneos"
            destination = "generic/platform=iOS"
        else:
            sdk = "iphonesimulator"
            destination = "generic/platform=iOS Simulator"

        if xcworkspace.exists():
            build_cmd = [
                "xcodebuild", "-workspace", str(xcworkspace),
                "-scheme", self._SCHEME,
                "-sdk", sdk,
                "-destination", destination,
                "-derivedDataPath", str(workspace / "build"),
                "ENABLE_USER_SCRIPT_SANDBOXING=NO",
                "build",
            ]
        elif xcodeproj.exists():
            build_cmd = [
                "xcodebuild", "-project", str(xcodeproj),
                "-scheme", self._SCHEME,
                "-sdk", sdk,
                "-destination", destination,
                "-derivedDataPath", str(workspace / "build"),
                "ENABLE_USER_SCRIPT_SANDBOXING=NO",
                "build",
            ]
        else:
            with open(compile_log, "w") as f:
                f.write("ERROR: Neither .xcworkspace nor .xcodeproj found\n")
            return 1

        # For real device builds, enable automatic code signing
        if for_device:
            team_id = os.environ.get("EVAL_DEVELOPMENT_TEAM", "MK3T64SR69")
            build_cmd += [
                f"DEVELOPMENT_TEAM={team_id}",
                "CODE_SIGN_IDENTITY=Apple Development",
                "CODE_SIGNING_ALLOWED=YES",
                "CODE_SIGN_STYLE=Automatic",
                "-allowProvisioningUpdates",
            ]

        with open(compile_log, "w") as log_f:
            # Strip macOS extended attributes (AppleDouble `._*`,
            # com.apple.FinderInfo, com.apple.ResourceFork, com.apple.quarantine,
            # etc.) that CocoaPods-vendored frameworks often carry. Modern
            # codesign refuses to sign bundles containing these, which manifests
            # as:
            #   "resource fork, Finder information, or similar detritus not allowed"
            # xattr -cr is idempotent and cheap (~<1s on a typical workspace).
            log_f.write("=== xattr -cr (strip macOS extended attributes) ===\n")
            log_f.flush()
            xattr_proc = subprocess.run(
                ["xattr", "-cr", str(workspace)],
                stdout=log_f,
                stderr=subprocess.STDOUT,
                check=False,
            )
            log_f.write(f"=== xattr exit={xattr_proc.returncode} ===\n\n")
            log_f.flush()

            proc = subprocess.run(
                build_cmd,
                cwd=str(workspace),
                stdout=log_f,
                stderr=subprocess.STDOUT,
                check=False,
            )
        return proc.returncode

    def install(self, workspace: Path, device: Device) -> int:
        if device.kind == "simulator":
            config_dir = "Debug-iphonesimulator"
        else:
            config_dir = "Debug-iphoneos"
        app_dir = workspace / "build" / "Build" / "Products" / config_dir
        app_bundle = app_dir / f"{self._SCHEME}.app"
        if not app_bundle.exists():
            return 1
        if device.kind == "simulator":
            proc = subprocess.run(
                ["xcrun", "simctl", "install", device.id, str(app_bundle)],
                capture_output=True, check=False,
            )
            return proc.returncode
        else:
            proc = subprocess.run(
                ["xcrun", "devicectl", "device", "install", "app",
                 "--device", device.id, str(app_bundle)],
                capture_output=True, check=False,
            )
            return proc.returncode

    def launch_with_nonce(self, workspace: Path, device: Device, nonce: str) -> int:
        # No-op: app launch is now handled by log_stream_command (--console mode)
        return 0

    def stop(self, workspace: Path, device: Device) -> None:
        if device.kind == "simulator":
            subprocess.run(
                ["xcrun", "simctl", "terminate", device.id, self._BUNDLE_ID],
                capture_output=True, check=False,
            )
        else:
            subprocess.run(
                ["xcrun", "devicectl", "device", "process", "terminate",
                 "--device", device.id, self._BUNDLE_ID],
                capture_output=True, check=False,
            )

    def log_stream_command(
        self,
        device: Device,
        *,
        nonce: str | None = None,
        workspace: Path | None = None,
    ) -> list[str]:
        # `workspace` is unused on iOS (native tools handle launch); accepted
        # for ABC compatibility with Web's log-bridge contract.
        del workspace
        # Use --console mode: launch the app and bridge its stdout/stderr as the log stream.
        # This combines app launch + log capture into a single blocking process.
        if device.kind == "simulator":
            cmd = [
                "xcrun", "simctl", "launch", "--console", device.id, self._BUNDLE_ID,
            ]
        else:
            cmd = [
                "xcrun", "devicectl", "device", "process", "launch",
                "--device", device.id, "--console", self._BUNDLE_ID,
            ]
        if nonce:
            cmd += ["--eval-nonce", nonce]
        return cmd
