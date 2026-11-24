"""CLI driver — subprocess wrapper for invoking AI CLI tools."""
import os
import subprocess
import sys
from pathlib import Path


def invoke_cli(prompt: str, cwd: Path, timeout: int = 300) -> tuple[int, str]:
    """Invoke the AI CLI in non-interactive mode.

    Returns (exit_code, raw_output_text).
    Raises TimeoutError if exceeds timeout.
    """
    # Try codebuddy CLI first, fall back to claude-internal, then claude
    cli_cmd = _find_cli()

    # Inherit env and ensure API key disabled flag is set
    env = os.environ.copy()
    env["CODEBUDDY_API_KEY_DISABLED"] = "1"

    try:
        proc = subprocess.run(
            [cli_cmd, "-p", prompt],
            capture_output=True,
            text=True,
            timeout=timeout,
            cwd=str(cwd),
            env=env,
            check=False,
        )
        return proc.returncode, proc.stdout
    except subprocess.TimeoutExpired:
        raise TimeoutError(f"CLI timed out after {timeout}s")
    except FileNotFoundError:
        print(f"ERROR: CLI '{cli_cmd}' not found", file=sys.stderr)
        return 127, ""


def _find_cli() -> str:
    """Find available CLI binary."""
    for cli in ["codebuddy", "claude-internal", "claude"]:
        try:
            proc = subprocess.run(
                [cli, "--version"],
                capture_output=True, check=False,
            )
            if proc.returncode == 0:
                return cli
        except (FileNotFoundError, PermissionError):
            continue
    return "codebuddy"  # default; will fail clearly if missing
