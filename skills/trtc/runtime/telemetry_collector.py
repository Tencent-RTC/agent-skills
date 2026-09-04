"""telemetry_collector.py — Start/stop runtime log collection.

Usage:
    python3 telemetry_collector.py --mode start --platform web --workspace /path/to/project
    python3 telemetry_collector.py --mode stop --workspace /path/to/project

Starts a platform-specific log stream process in the background, piping its
stdout to <workspace>/.trtc-telemetry/runtime.log. Stores the PID for later
stop.

On stop: kills processes → filters errors from runtime.log → writes local
runtime_error.log + runtime_context.json files. This collector never uploads.
"""
import argparse
import json
import os
import re
import signal
import subprocess
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from lib.platforms import discover_devices, log_stream_command


# ---------------------------------------------------------------------------
# Error filtering patterns
# ---------------------------------------------------------------------------

# Match: lines that are actual SDK errors
_ERROR_PATTERNS = [
    re.compile(r"<ERROR>"),
    re.compile(r"error_code:\s*[1-9]\d*"),  # Non-zero error_code
]

# Exclude: false positives (skip even if _ERROR_PATTERNS match)
_ERROR_EXCLUSIONS = [
    re.compile(r"telemetry-bridge:"),
    re.compile(r"favicon\.ico.*404"),
    re.compile(r"AudioContext was not allowed"),
    re.compile(r"\[↑t\d\] on error"),         # Event listener registration
    re.compile(r"error_code:\s*0"),            # Success callback
    re.compile(r"error_message:\s*success"),   # Success callback
]

# ---------------------------------------------------------------------------
# Context extraction patterns
# ---------------------------------------------------------------------------

_CONTEXT_EXTRACTORS = {
    "trtc_web":    re.compile(r"TRTC Web SDK Version:\s*([\d.\w-]+)"),
    "trtc_cloud":  re.compile(r"TRTCCloud Version:\s*([\d.]+)"),
    "room_engine": re.compile(r"TUIRoomEngine Web SDK Version:\s*([\d.]+)"),
    "chat_engine": re.compile(r"TUIChatEngine-Lite\.VERSION:([\d.]+)"),
    "os":          re.compile(r"<INFO> OS:\s*(.+)"),
    "sdk_app_id":  re.compile(r"sdkAppId=(\d+)"),
    "user_id":     re.compile(r"userId=(\w+)"),
}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _telemetry_dir(workspace: Path) -> Path:
    """Return the .trtc-telemetry directory inside the workspace."""
    d = workspace / ".trtc-telemetry"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _filter_errors(runtime_log: Path, error_log: Path) -> list[str]:
    """Filter error lines from runtime.log, write to runtime_error.log."""
    if not runtime_log.exists() or runtime_log.stat().st_size == 0:
        return []

    errors: list[str] = []
    try:
        with open(runtime_log, "r", encoding="utf-8", errors="replace") as f:
            for line in f:
                line_stripped = line.strip()
                if not line_stripped:
                    continue
                # Check exclusions first
                if any(exc.search(line_stripped) for exc in _ERROR_EXCLUSIONS):
                    continue
                # Check if line matches any error pattern
                if any(pat.search(line_stripped) for pat in _ERROR_PATTERNS):
                    errors.append(line_stripped)
    except OSError:
        return []

    # Write error log (overwrite)
    if errors:
        try:
            error_log.write_text("\n".join(errors) + "\n", encoding="utf-8")
        except OSError:
            pass
    else:
        # Clear previous error log if no errors this run
        try:
            error_log.unlink(missing_ok=True)
        except OSError:
            pass

    return errors


def _extract_context(runtime_log: Path, context_file: Path) -> None:
    """Extract environment context from runtime.log, write to runtime_context.json."""
    if not runtime_log.exists() or runtime_log.stat().st_size == 0:
        return

    sdk_versions: dict[str, str] = {}
    context: dict[str, str] = {}

    version_keys = {"trtc_web", "trtc_cloud", "room_engine", "chat_engine"}

    try:
        with open(runtime_log, "r", encoding="utf-8", errors="replace") as f:
            for line in f:
                for key, pattern in _CONTEXT_EXTRACTORS.items():
                    if key in sdk_versions or key in context:
                        continue  # Already found
                    m = pattern.search(line)
                    if m:
                        value = m.group(1).strip()
                        if key in version_keys:
                            sdk_versions[key] = value
                        else:
                            context[key] = value
                # Early exit if all found
                if len(sdk_versions) + len(context) == len(_CONTEXT_EXTRACTORS):
                    break
    except OSError:
        return

    result = {}
    if sdk_versions:
        result["sdk_versions"] = sdk_versions
    if context.get("os"):
        result["os"] = context["os"]
    if context.get("sdk_app_id"):
        result["sdk_app_id"] = context["sdk_app_id"]
    if context.get("user_id"):
        result["user_id"] = context["user_id"]

    if result:
        try:
            context_file.write_text(
                json.dumps(result, indent=2, ensure_ascii=False) + "\n",
                encoding="utf-8",
            )
        except OSError:
            pass


# ---------------------------------------------------------------------------
# Start / Stop
# ---------------------------------------------------------------------------

def _start(platform: str, workspace: Path, connect: str | None = None) -> int:
    """Start log collection in the background."""
    tel_dir = _telemetry_dir(workspace)
    runtime_log = tel_dir / "runtime.log"
    pid_file = tel_dir / "collector.pid"

    # Check if already running
    if pid_file.exists():
        pid = int(pid_file.read_text().strip())
        try:
            os.kill(pid, 0)  # Check if process exists
            print(json.dumps({
                "status": "already_running",
                "pid": pid,
            }))
            return 0
        except ProcessLookupError:
            pid_file.unlink(missing_ok=True)

    # Discover device
    devices = discover_devices(platform)
    if not devices:
        print(json.dumps({
            "status": "error",
            "message": f"No {platform} device found.",
        }))
        return 1

    device = devices[0]

    # Get log stream command
    try:
        cmd = log_stream_command(platform, device, workspace=workspace, connect=connect)
    except ValueError as e:
        print(json.dumps({"status": "error", "message": str(e)}))
        return 1

    # Launch in background, stdout → runtime.log (truncate previous)
    f = open(runtime_log, "wb")
    try:
        proc = subprocess.Popen(
            cmd,
            stdout=f,
            stderr=subprocess.STDOUT,
            start_new_session=True,  # Create new process group for clean kill
        )
    except FileNotFoundError as e:
        f.close()
        print(json.dumps({"status": "error", "message": f"Command not found: {e}"}))
        return 1

    pid_file.write_text(str(proc.pid))

    print(json.dumps({
        "status": "started",
        "pid": proc.pid,
        "platform": platform,
        "device": device.name or device.id,
    }))
    return 0


def _stop(workspace: Path) -> int:
    """Stop log collection, filter errors, extract context."""
    tel_dir = _telemetry_dir(workspace)
    pid_file = tel_dir / "collector.pid"

    if not pid_file.exists():
        print(json.dumps({"status": "not_running"}))
        return 0

    pid = int(pid_file.read_text().strip())

    # Kill the entire process group (node + Chromium + Vite) to avoid orphans
    try:
        os.killpg(pid, signal.SIGTERM)
    except ProcessLookupError:
        pass
    except PermissionError:
        # Fallback: kill just the main process if group kill fails
        try:
            os.kill(pid, signal.SIGTERM)
        except ProcessLookupError:
            pass

    # Wait briefly for graceful shutdown (browser.close() in bridge)
    time.sleep(1)

    # Force-kill any remaining processes in the group
    try:
        os.killpg(pid, signal.SIGKILL)
    except (ProcessLookupError, PermissionError):
        pass

    pid_file.unlink(missing_ok=True)

    # --- Post-stop: filter errors + extract context ---
    runtime_log = tel_dir / "runtime.log"
    error_log = tel_dir / "runtime_error.log"
    context_file = tel_dir / "runtime_context.json"

    errors = _filter_errors(runtime_log, error_log)
    _extract_context(runtime_log, context_file)

    print(json.dumps({
        "status": "stopped",
        "errors_found": len(errors),
    }))
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description="Runtime telemetry collector (start/stop)")
    ap.add_argument("--mode", required=True, choices=["start", "stop"])
    ap.add_argument("--platform", choices=["web", "ios", "android"], default="web")
    ap.add_argument("--workspace", required=True, help="Path to the user's project")
    ap.add_argument("--connect", default=None,
                    help="CDP endpoint to connect to existing browser (e.g. http://localhost:9222)")
    args = ap.parse_args()

    workspace = Path(args.workspace).resolve()

    if args.mode == "start":
        return _start(args.platform, workspace, connect=args.connect)
    else:
        return _stop(workspace)


if __name__ == "__main__":
    sys.exit(main())
