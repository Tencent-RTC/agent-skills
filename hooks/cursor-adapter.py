#!/usr/bin/env python3
"""cursor-adapter.py — Translate Cursor hook protocol to existing Claude-format guardrails.

Wired from hooks-cursor.json. Each Cursor hook event runs:

    python3 ./hooks/cursor-adapter.py <dispatch-key>

This script:
  1. Reads the Cursor hook envelope from stdin (camelCase fields).
  2. Normalizes it to the {tool_name, tool_input} shape the existing
     guardrail scripts in skills/*/guardrails/ expect.
  3. Sets CLAUDE_PLUGIN_ROOT and CLAUDE_PROJECT_DIR env vars so the
     existing scripts find sessions and shared libs unchanged.
  4. Spawns the underlying script and propagates stdout/stderr.
  5. Translates exit codes:
       Claude Code: 0=allow, 1=fail, 2=block
       Cursor:      0=success, 2=deny (with JSON), other=fail-open
     We map Claude exit 1 and exit 2 -> Cursor deny (exit 2 + JSON on stdout).

Fail-open principle: if anything goes wrong inside the adapter (missing
script, malformed stdin, dispatch key unknown), we exit 0 silently so a
broken adapter never blocks the user's workflow.

Cursor event mapping (see hooks-cursor.json):
  sessionStart        -> trtc-prepare-ui
  beforeReadFile      -> gate-slice-read
  preToolUse          -> gate-slice-write       (filtered to Write/Edit inside)
  afterFileEdit       -> verify-ui-post-write
  stop                -> stop-apply-evidence, trtc-verify-ui
                         (Claude Code's `Stop` event fires per agent loop
                          iteration end. Cursor's `stop` event has the same
                          semantic ("Called when the agent loop ends") and
                          uniquely supports {"followup_message": "..."} on
                          stdout to auto-resubmit a corrective user turn —
                          which is exactly what these end-of-task guardrails
                          need so the agent can self-correct. Auto-resubmit
                          is capped at 5 iterations by Cursor's loop_limit.

                          Historical note: a previous revision of this
                          adapter mapped these to `afterAgentResponse`
                          because the original author observed `stop` not
                          firing. Empirically (Cursor 3.3.8) `stop` does
                          fire reliably; the original "stop never fires"
                          observation was caused by hooks not being loaded
                          at all, not by the `stop` event itself. npx
                          installs to project-level `.cursor/hooks.json`;
                          plugin-level hooks declared in
                          .cursor-plugin/plugin.json are NOT loaded by
                          current Cursor versions.)

To enable verbose tracing during development, set the env var
TRTC_HOOK_DEBUG_LOG=/path/to/file.log; see _dbg() below. The default is
silent (no log file written) so production installs don't accumulate logs.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

ADAPTER_DIR = Path(__file__).resolve().parent


def _find_plugin_root(start: Path) -> Path:
    # Walk up until we find a directory that contains skills/. This makes the
    # adapter location-independent: it works whether it lives at
    # <plugin>/hooks/cursor-adapter.py (Cursor plugin install + the original
    # npx layout) or under a namespaced subdir like
    # <plugin>/hooks/trtc-agent-skills/cursor-adapter.py (current npx layout,
    # chosen so multiple skill packages can co-exist under .cursor/hooks/).
    # Falls back to the old `.parent` behaviour if no `skills/` is found, so
    # we never regress an existing install.
    for candidate in (start, *start.parents):
        if (candidate / "skills").is_dir():
            return candidate
    return start.parent


PLUGIN_ROOT = _find_plugin_root(ADAPTER_DIR)


# Optional debug logging — only writes when TRTC_HOOK_DEBUG_LOG is set to a
# path. Useful for diagnosing "why didn't my hook fire" without modifying
# the script.
def _dbg(msg: str) -> None:
    log_path = os.environ.get("TRTC_HOOK_DEBUG_LOG")
    if not log_path:
        return
    try:
        import datetime as _dt
        with open(log_path, "a") as f:
            f.write(f"[{_dt.datetime.now().isoformat(timespec='milliseconds')}] {msg}\n")
    except Exception:
        pass


# Always-on probe log: writes one line per adapter invocation to
# /tmp/trtc-hook-probe.log so we can confirm which Cursor hook events
# actually fire end-to-end. Off by default to avoid unbounded log files
# in production installs; enable by setting env TRTC_HOOK_PROBE=1.
def _probe_log(key, payload) -> None:
    if os.environ.get("TRTC_HOOK_PROBE") != "1":
        return
    try:
        import datetime as _dt
        ev = (payload or {}).get("hook_event_name", "?")
        with open("/tmp/trtc-hook-probe.log", "a") as f:
            f.write(
                f"[{_dt.datetime.now().isoformat(timespec='milliseconds')}] "
                f"event={ev!r} key={key!r} "
                f"pid={os.getpid()} "
                f"cwd={os.environ.get('CURSOR_PROJECT_DIR') or os.getcwd()!r}\n"
            )
    except Exception:
        pass


# Dispatch table: dispatch_key -> relative script path under PLUGIN_ROOT.
DISPATCH = {
    "bind-reporting-session":                  "skills/trtc/tools/reporting.py",
    "gate-slice-read":                        "skills/trtc/hooks/gate_slice_read.py",
    "topic-phase-gate":                       "skills/trtc/hooks/topic_phase_gate.py",
    "gate-slice-write":                       "skills/trtc/hooks/gate_slice_write.py",
    "stop-apply-evidence":                    "skills/trtc/hooks/stop_require_apply_evidence.py",
    "pretooluse-require-business-decisions":  "skills/trtc-conference/hooks/pretooluse_require_business_decisions.py",
}

# Dispatch keys whose underlying scripts read JSON from stdin.
# Other keys are CLI-only and will receive empty stdin.
STDIN_KEYS = {
    "bind-reporting-session",
    "gate-slice-read",
    "topic-phase-gate",
    "gate-slice-write",
    "pretooluse-require-business-decisions",
}


def _silent_allow() -> None:
    """Fail-open: never block the user because the adapter itself failed."""
    _dbg("  EXIT=0 (silent allow)")
    sys.exit(0)


def _read_cursor_payload() -> dict:
    raw = sys.stdin.read()
    if not raw or not raw.strip():
        return {}
    try:
        data = json.loads(raw)
        return data if isinstance(data, dict) else {}
    except (ValueError, TypeError):
        return {}


def _translate_payload(key: str, cursor: dict) -> dict:
    """Map Cursor's per-event payload to the {tool_name, tool_input} envelope
    the existing guardrails expect.

    The existing scripts read either:
      - {"tool_name": "Read",       "tool_input": {"file_path": "..."}}
      - {"tool_name": "Write|Edit", "tool_input": {"file_path": "..."}}
    """
    if key == "bind-reporting-session":
        return cursor

    if key == "gate-slice-read":
        # Cursor's beforeReadFile payload: {file_path, content, attachments, ...}
        file_path = cursor.get("file_path") or cursor.get("filePath")
        return {"tool_name": "Read", "tool_input": {"file_path": file_path}}

    if key == "gate-slice-write":
        # Cursor's preToolUse payload: {tool_name, tool_input, tool_use_id, cwd, ...}
        # Cursor only emits "Write" (no separate "Edit"); existing script
        # accepts both. Pass through unchanged when tool_name is Write/Edit;
        # silent allow for unrelated tools.
        tool_name = cursor.get("tool_name") or cursor.get("toolName")
        if tool_name not in ("Write", "Edit"):
            return {}  # caller will silent-allow
        tool_input = cursor.get("tool_input") or cursor.get("toolInput") or {}
        return {"tool_name": tool_name, "tool_input": tool_input}

    if key == "topic-phase-gate":
        tool_name = cursor.get("tool_name") or cursor.get("toolName")
        if tool_name not in ("Write", "Edit"):
            return {}
        tool_input = cursor.get("tool_input") or cursor.get("toolInput") or {}
        return {"tool_name": tool_name, "tool_input": tool_input}

    if key == "pretooluse-require-business-decisions":
        tool_name = cursor.get("tool_name") or cursor.get("toolName")
        if tool_name not in ("Write", "Edit"):
            return {}
        tool_input = cursor.get("tool_input") or cursor.get("toolInput") or {}
        return {"tool_name": tool_name, "tool_input": tool_input}

    if key in ("verify-ui-post-write",):
        # Cursor's afterFileEdit payload: {file_path, edits}
        file_path = cursor.get("file_path") or cursor.get("filePath")
        return {"tool_name": "Edit", "tool_input": {"file_path": file_path}}

    # CLI-only events (sessionStart, afterAgentResponse) get empty stdin —
    # they read state from session files and env vars, not stdin.
    return {}


def _emit_cursor_deny(message: str) -> None:
    """Cursor deny protocol for events that honor blocking (preToolUse,
    beforeReadFile, afterFileEdit): JSON on stdout + exit 2.

    Fields populated:
      - permission: "deny" — tells Cursor this action should be blocked.
      - user_message: surfaced in Cursor's UI on events that support it.
      - agent_message: shown to the agent so it can self-correct on hooks
        that run before the agent's loop ends (preToolUse, beforeReadFile).

    NOTE: do not call this for the `stop` event. Cursor docs confirm only
    `followup_message` is honored on stop; use _emit_cursor_followup()
    instead so the agent gets re-prompted to fix the issue.
    """
    _dbg(f"  EXIT=2 (deny) message={message[:160]!r}")
    msg = message or "Blocked by TRTC guardrail."
    payload = {
        "permission": "deny",
        "user_message": msg,
        "agent_message": msg,
    }
    sys.stdout.write(json.dumps(payload))
    sys.stdout.flush()
    sys.exit(2)


def _emit_cursor_followup(message: str) -> None:
    """Cursor stop-event protocol: emit {"followup_message": ...} on stdout
    and exit 0. Cursor will automatically submit the message as the next
    user turn, giving the agent a chance to self-correct.

    Per Cursor docs, the stop event only honors `followup_message`; other
    output fields (permission, user_message, agent_message) are accepted by
    the schema but not enforced by callers. Auto-resubmission is capped by
    `loop_limit` (default 5) so a guardrail that keeps failing won't loop
    forever.

    Exit 0 (not 2): we want Cursor to resubmit, not block. Exit 2 on stop
    just halts with no chance for the agent to fix the problem.
    """
    msg = (message or "TRTC guardrail failed; please review and fix.").strip()
    # Cursor caps message length on some events; keep this generous but bounded
    # so we don't ship a 50KB stderr trace as the next user message.
    if len(msg) > 4000:
        msg = msg[:4000] + "\n…(truncated)"
    _dbg(f"  EXIT=0 (followup) message={msg[:160]!r}")
    payload = {"followup_message": msg}
    sys.stdout.write(json.dumps(payload))
    sys.stdout.flush()
    sys.exit(0)


def main(argv: list[str]) -> None:
    key = argv[1] if len(argv) >= 2 else None
    _dbg(
        f"ENTER key={key!r} "
        f"cursor_project_dir={os.environ.get('CURSOR_PROJECT_DIR', '?')!r}"
    )
    if not key:
        _silent_allow()

    # Read stdin first so debug logs see Cursor's hook_event_name even when
    # the dispatch key is unknown or the script is missing.
    cursor_payload = _read_cursor_payload()
    _probe_log(key, cursor_payload)
    _dbg(
        f"  hook_event_name={cursor_payload.get('hook_event_name', '?')!r} "
        f"keys={sorted(cursor_payload.keys()) if cursor_payload else []}"
    )

    rel_script = DISPATCH.get(key)
    if not rel_script:
        # Unknown dispatch key — never block on adapter misconfiguration.
        _silent_allow()

    script = PLUGIN_ROOT / rel_script
    if not script.exists():
        # Script missing (e.g., skill not installed). Same convention the
        # existing hooks.json uses ("[ ! -f X ] || python3 X").
        _silent_allow()

    claude_payload = _translate_payload(key, cursor_payload)

    # gate-slice-write returns {} when tool isn't Write/Edit -> silent allow.
    if key == "gate-slice-write" and not claude_payload:
        _silent_allow()

    # Build env: surface Cursor's project dir as CLAUDE_PROJECT_DIR so
    # existing scripts that key off CLAUDE_PROJECT_DIR keep working.
    env = dict(os.environ)
    cursor_project_dir = env.get("CURSOR_PROJECT_DIR") or cursor_payload.get("cwd")
    if cursor_project_dir and not env.get("CLAUDE_PROJECT_DIR"):
        env["CLAUDE_PROJECT_DIR"] = cursor_project_dir
    env["CLAUDE_PLUGIN_ROOT"] = str(PLUGIN_ROOT)

    runner = ["bash", str(script)] if script.suffix == ".sh" else ["python3", str(script)]
    if key == "bind-reporting-session":
        runner.extend(["bind-session", "--ide", "cursor"])
    stdin_data = json.dumps(claude_payload) if key in STDIN_KEYS else ""

    try:
        proc = subprocess.run(
            runner,
            input=stdin_data,
            text=True,
            env=env,
            capture_output=True,
            timeout=30,
        )
    except (subprocess.TimeoutExpired, OSError):
        _silent_allow()

    # Forward whatever the inner script wrote.
    if proc.stdout:
        sys.stderr.write(proc.stdout)  # inner stdout -> stderr so we don't
                                       # corrupt our Cursor JSON channel
    if proc.stderr:
        sys.stderr.write(proc.stderr)

    rc = proc.returncode
    _dbg(f"  inner_rc={rc}")
    if rc == 0:
        sys.exit(0)
    if rc in (1, 2):
        # Translate fail/block into Cursor's response. Use stderr content as
        # the agent-facing message so the existing scripts' human-readable
        # explanations reach the user.
        msg = (proc.stderr or proc.stdout or "").strip()
        # On the `stop` event Cursor honors only `followup_message` (which
        # auto-resubmits a corrective user turn). On preToolUse /
        # beforeReadFile / afterFileEdit, the deny envelope is enforced.
        if cursor_payload.get("hook_event_name") == "stop":
            _emit_cursor_followup(msg)
        _emit_cursor_deny(msg)

    # Unknown exit code — fail open to mimic Claude Code's permissive default.
    _silent_allow()


if __name__ == "__main__":
    main(sys.argv)
