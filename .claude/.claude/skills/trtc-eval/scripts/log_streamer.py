"""log_streamer.py — Independent log stream script.

Started by orchestrator BEFORE demo_run, stopped AFTER demo_run.
Does NOT parse logs (that's runtime_monitor.py's job).
Does NOT write trace.jsonl (orchestrator only).
"""
import argparse
import json
import os
import signal
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from scripts.lib.platforms import get_adapter
from scripts.lib.platforms.base import Device


def _read_launch_env(case_dir: Path) -> dict[str, str]:
    """Read <case_dir>/.eval-meta/launch.env — the single source of truth for
    TRTC test credentials at runtime.  Returns a dict of KEY=value pairs.

    Falls back to an empty dict if the file is missing (non-fatal; downstream
    will use os.environ as last resort).
    """
    launch_env_path = case_dir / ".eval-meta" / "launch.env"
    result: dict[str, str] = {}
    if not launch_env_path.exists():
        return result
    for line in launch_env_path.read_text().splitlines():
        if "=" in line and not line.startswith("#"):
            key, _, value = line.partition("=")
            result[key.strip()] = value.strip()
    return result


def main() -> int:
    ap = argparse.ArgumentParser(description="Log stream start/stop")
    ap.add_argument("--case-id", required=True)
    ap.add_argument("--run-dir", required=True)
    ap.add_argument("--platform", required=True)
    ap.add_argument("--device-kind", required=True)
    ap.add_argument("--device-id", required=True)
    ap.add_argument("--mode", required=True, choices=["start", "stop"])
    ap.add_argument("--nonce", default=None, help="EVAL_RUN_NONCE to pass to --console launch")
    args = ap.parse_args()

    case_dir = Path(args.run_dir).resolve() / "cases" / args.case_id
    case_dir.mkdir(parents=True, exist_ok=True)
    runtime_log = case_dir / "runtime.log"
    pid_file = case_dir / "runtime.log.pid"

    if args.mode == "start":
        device = Device(kind=args.device_kind, id=args.device_id, extra={})  # type: ignore[arg-type]
        adapter = get_adapter(args.platform)
        # Pass nonce so log_stream_command can build a --console launch command.
        # `workspace` is required by the Web adapter (log-bridge needs the demo
        # project path to spawn `npm run dev`); native platforms ignore it.
        nonce = args.nonce or os.environ.get("EVAL_RUN_NONCE")
        workspace = case_dir / "workspace"
        cmd = adapter.log_stream_command(device, nonce=nonce, workspace=workspace)

        # For real device launches via devicectl, environment variables need
        # the DEVICECTL_CHILD_ prefix to be forwarded to the remote app.
        # Read credentials from launch.env (single source of truth) rather
        # than os.environ, which may contain stale values from previous runs.
        popen_env = dict(os.environ)
        if device.kind == "real":
            launch_creds = _read_launch_env(case_dir)
            forward_keys = (
                "EVAL_RUN_NONCE",
                "EVAL_AUTO_RUN_FLOW",
                "TRTC_TEST_SDKAPPID",
                "TRTC_TEST_USERID",
                "TRTC_TEST_USERSIG",
            )
            for key in forward_keys:
                # launch.env is authoritative for TRTC_TEST_*; fall back to
                # os.environ only for non-credential keys (EVAL_RUN_NONCE etc.)
                val = launch_creds.get(key) or os.environ.get(key)
                if val:
                    popen_env[f"DEVICECTL_CHILD_{key}"] = val

        # Launch log stream in background; stdout → runtime.log
        f = open(runtime_log, "ab")
        try:
            proc = subprocess.Popen(cmd, stdout=f, stderr=subprocess.STDOUT, env=popen_env)
        except FileNotFoundError as e:
            f.close()
            print(json.dumps({"mode": "start", "error": str(e)}), file=sys.stderr)
            return 1
        pid_file.write_text(str(proc.pid))
        print(json.dumps({"mode": "start", "pid": proc.pid, "cmd": cmd}))
        return 0

    # mode == stop
    if not pid_file.exists():
        print(json.dumps({"mode": "stop", "skipped": "no pid file"}))
        return 0
    pid = int(pid_file.read_text().strip())
    try:
        os.kill(pid, signal.SIGTERM)
    except ProcessLookupError:
        pass
    pid_file.unlink(missing_ok=True)
    print(json.dumps({"mode": "stop", "pid": pid}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
