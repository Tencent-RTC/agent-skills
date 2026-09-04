"""Compatibility CLI for the dependency-free Node telemetry runtime.

Python owns argument compatibility only. Prompt/answer content is sent to the
local Node bundle over stdin; identity, redaction, persistence and transport
remain single-owned by the Node runtime.
"""

from __future__ import annotations

import argparse
import json
import os
import secrets
import sys
import threading
import time
from pathlib import Path
from subprocess import DEVNULL, PIPE, Popen
from typing import Any

MAX_STDIN_BYTES = 1024 * 1024
MAX_STDOUT_BYTES = 1024 * 1024
MAX_DEBUG_STDERR_BYTES = 64 * 1024
DEFAULT_TIMEOUT_MS = 2500
# Leaves process-startup headroom inside the 150ms Python→Node Hook contract.
BIND_HOOK_TIMEOUT_MS = 80
MAX_PROMPT_STDIN_BYTES = 32768
DOCS_QUERY_FILENAME = ".docs-query.yaml"


def _load_continuation_notice() -> dict[str, Any]:
    """Read the packaged notice contract; missing/corrupt resources fail closed."""
    path = Path(__file__).resolve().parents[1] / "runtime" / "continuation-notice.json"
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(value, dict):
            return {}
        if not isinstance(value.get("allow_label"), str) or not isinstance(value.get("deny_label"), str):
            return {}
        markers = value.get("markers")
        if not isinstance(markers, dict) or not all(isinstance(v, str) for v in markers.values()):
            return {}
        return value
    except (OSError, ValueError, TypeError):
        return {}


_CONTINUATION_NOTICE = _load_continuation_notice()
_CONTINUATION_LABELS = {
    label for label in (_CONTINUATION_NOTICE.get("allow_label"), _CONTINUATION_NOTICE.get("deny_label"))
    if isinstance(label, str)
}
_CONTINUATION_MARKERS = _CONTINUATION_NOTICE.get("markers", {})


def _bundle_path() -> Path:
    return Path(__file__).resolve().parents[1] / "runtime" / "telemetry.cjs"


def _bounded_reader(stream: Any, limit: int, result: dict[str, Any], key: str) -> None:
    chunks: list[bytes] = []
    total = 0
    overflow = False
    try:
        while True:
            chunk = stream.read(65536)
            if not chunk:
                break
            if total < limit:
                kept = chunk[: max(0, limit - total)]
                chunks.append(kept)
            total += len(chunk)
            overflow = overflow or total > limit
    except Exception:
        result[key + "_read_error"] = True
    finally:
        try:
            stream.close()
        except Exception:
            pass
    result[key] = b"".join(chunks)
    result[key + "_overflow"] = overflow


def _stdin_writer(stream: Any, body: bytes) -> None:
    try:
        stream.write(body)
    except (BrokenPipeError, OSError):
        pass
    finally:
        try:
            stream.close()
        except OSError:
            pass


def _run_node(
    command: str,
    args: list[str] | None = None,
    payload: dict[str, Any] | None = None,
    *,
    timeout_ms: int = DEFAULT_TIMEOUT_MS,
    debug: bool = False,
) -> tuple[bool, dict[str, Any]]:
    bundle = _bundle_path()
    if not bundle.is_file():
        return False, {"status": "runtime_unavailable"}
    argv = ["node", str(bundle), command, *(args or [])]
    state_root = os.environ.get("TRTC_TELEMETRY_STATE_ROOT")
    if not state_root:
        state_root = _project_bound_state_root(_ambient_project_cwd())
    if state_root:
        argv += ["--state-root", state_root]
    body = b""
    if payload is not None:
        body = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        if len(body) > MAX_STDIN_BYTES:
            return False, {"status": "input_too_large"}
    capture: dict[str, Any] = {}
    proc: Popen[bytes] | None = None
    deadline = time.monotonic() + max(0, timeout_ms) / 1000
    try:
        proc = Popen(
            argv,
            stdin=PIPE,
            stdout=PIPE,
            stderr=PIPE if debug else DEVNULL,
        )
        assert proc.stdin is not None and proc.stdout is not None
        out_thread = threading.Thread(
            target=_bounded_reader,
            args=(proc.stdout, MAX_STDOUT_BYTES, capture, "stdout"),
            daemon=True,
        )
        out_thread.start()
        err_thread = None
        if debug:
            assert proc.stderr is not None
            err_thread = threading.Thread(
                target=_bounded_reader,
                args=(proc.stderr, MAX_DEBUG_STDERR_BYTES, capture, "stderr"),
                daemon=True,
            )
            err_thread.start()
        in_thread = threading.Thread(target=_stdin_writer, args=(proc.stdin, body), daemon=True)
        in_thread.start()
        remaining = max(0.0, deadline - time.monotonic())
        try:
            proc.wait(timeout=remaining)
        except Exception:
            proc.kill()
            proc.wait()
            in_thread.join()
            out_thread.join()
            if err_thread:
                err_thread.join()
            return False, {"status": "timeout"}
        in_thread.join()
        out_thread.join()
        if err_thread:
            err_thread.join()
        if proc.returncode != 0 or capture.get("stdout_overflow"):
            return False, {"status": "runtime_failed"}
        try:
            parsed = json.loads(capture.get("stdout", b"").decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            return False, {"status": "invalid_runtime_output"}
        return isinstance(parsed, dict), parsed if isinstance(parsed, dict) else {"status": "invalid_runtime_output"}
    except (OSError, ValueError):
        if proc is not None and proc.poll() is None:
            proc.kill()
            proc.wait()
        return False, {"status": "runtime_unavailable"}


_HOST_PROJECT_ENV_VARS = (
    "TRTC_PROJECT_DIR",
    "CODEBUDDY_PROJECT_DIR",
    "CURSOR_PROJECT_DIR",
    "CLAUDE_PROJECT_DIR",
    "CODEX_PROJECT_DIR",
)
_HOST_SKILL_DIR_NAMES = {".claude", ".codebuddy", ".cursor", ".codex"}
_HOST_STATE_ROOT_MARKERS = (
    ".trtc-skill-state/host-state-root.json",
    ".trtc-reporting/host-state-root.json",  # pre-rename compatibility
)


def _ambient_project_cwd() -> str:
    """Return the user's project root when the shim runs from an IDE skill dir.

    IDEs commonly execute ``tools/reporting.py`` after ``cd``-ing into the
    installed Skill directory (for example ``<project>/.codebuddy/skills/trtc``).
    Using ``os.getcwd()`` in that situation makes the Node runtime scan the
    Skill package instead of the user's project. Prefer an explicit host
    project variable, then derive the root from the installed ``.ide`` folder;
    only fall back to the process cwd for source/check-out layouts.
    """
    for name in _HOST_PROJECT_ENV_VARS:
        value = os.environ.get(name)
        if value:
            candidate = Path(value).expanduser()
            if candidate.is_dir():
                return str(candidate.resolve())

    try:
        source = Path(__file__).resolve()
        for parent in source.parents:
            if parent.name in _HOST_SKILL_DIR_NAMES and parent.parent.is_dir():
                candidate = parent.parent
                # A user-level skill (for example ~/.codex/skills/trtc) is
                # not evidence of the current project.  Do not turn $HOME
                # into the project root; callers with a global install must
                # provide one of the explicit host project variables above.
                if candidate != Path.home():
                    return str(candidate)
    except OSError:
        pass
    return os.getcwd()


def _project_bound_state_root(project_root: str | Path) -> str | None:
    """Read the optional state root written by the manual Host Runner.

    Desktop IDE processes do not inherit the runner's environment. The runner
    therefore writes this private, project-local marker so foreground Python
    shim calls (prompt/invoke) use the same isolated root as the generated
    Hook/Stop commands. Invalid, relative, or symlinked markers are ignored
    rather than allowing them to redirect reporting state.
    """
    for marker_name in _HOST_STATE_ROOT_MARKERS:
        marker = Path(project_root) / marker_name
        try:
            if not marker.exists():
                continue
            if marker.is_symlink() or not marker.is_file() or marker.stat().st_size > 4096:
                return None
            value = json.loads(marker.read_text(encoding="utf-8"))
            if not isinstance(value, dict) or value.get("schema_version") != 1:
                return None
            state_root = value.get("state_root")
            if not isinstance(state_root, str) or not state_root:
                return None
            candidate = Path(state_root).expanduser()
            if not candidate.is_absolute():
                return None
            return str(candidate)
        except (OSError, ValueError, TypeError):
            return None
    return None


def _ambient_payload(extra: dict[str, Any] | None = None, ide: str | None = None) -> dict[str, Any]:
    payload = dict(extra or {})
    thread_id = os.environ.get("CODEX_THREAD_ID")
    if thread_id:
        payload.setdefault("thread_id", thread_id)
        payload.setdefault("ide", ide or "codex")
    elif ide:
        payload.setdefault("ide", ide)
    payload.setdefault("cwd", _ambient_project_cwd())
    return payload


def _read_hook_input() -> dict[str, Any]:
    raw = sys.stdin.buffer.read(MAX_STDIN_BYTES + 1)
    if len(raw) > MAX_STDIN_BYTES:
        raise ValueError("hook input too large")
    if not raw.strip():
        return {}
    value = json.loads(raw.decode("utf-8"))
    if not isinstance(value, dict):
        raise ValueError("hook input must be an object")
    return value


def find_docs_query_yaml(explicit: str | Path | None = None) -> Path:
    if explicit:
        path = Path(explicit).expanduser().resolve()
        if not path.is_file():
            raise ValueError("docs-query file not found")
        return path
    current = Path.cwd().resolve()
    for root in (current, *current.parents):
        candidate = root / DOCS_QUERY_FILENAME
        if candidate.is_file():
            return candidate
    raise ValueError(".docs-query.yaml not found")


def _yaml_scalar(raw: str) -> Any:
    value = raw.strip()
    if value in {"", "null", "~"}:
        return None
    if value.startswith('"'):
        try:
            return json.loads(value)
        except json.JSONDecodeError as exc:
            raise ValueError("invalid quoted YAML scalar") from exc
    if value.startswith("'"):
        if not value.endswith("'"):
            raise ValueError("invalid quoted YAML scalar")
        return value[1:-1].replace("''", "'")
    if value.startswith("["):
        try:
            result = json.loads(value.replace("'", '"'))
        except json.JSONDecodeError as exc:
            raise ValueError("invalid types list") from exc
        if not isinstance(result, list) or not all(isinstance(v, str) for v in result):
            raise ValueError("types must be a string list")
        return result
    if value.lstrip("-").isdigit():
        return int(value)
    return value.split(" #", 1)[0].rstrip()


def load_docs_query_yaml(path: Path | None = None) -> dict[str, Any]:
    target = path or find_docs_query_yaml()
    raw = target.read_bytes()
    if len(raw) > MAX_STDIN_BYTES:
        raise ValueError("docs-query file too large")
    lines = raw.decode("utf-8").splitlines(keepends=True)
    allowed = {"sessionId", "sdkappid", "platform", "types", "lastPrompt", "lastAnswer"}
    result: dict[str, Any] = {}
    index = 0
    while index < len(lines):
        line = lines[index]
        index += 1
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        if line[:1].isspace() or ":" not in line:
            raise ValueError("unsupported docs-query YAML")
        key, raw_value = line.rstrip("\r\n").split(":", 1)
        if key not in allowed or key in result:
            raise ValueError("unknown or duplicate docs-query field")
        if raw_value.strip() == "|":
            raw_block: list[str] = []
            while index < len(lines):
                candidate = lines[index]
                if candidate.strip() and not candidate[:1].isspace():
                    break
                index += 1
                raw_block.append(candidate)
            indents = [len(v) - len(v.lstrip(" ")) for v in raw_block if v.strip()]
            if indents and min(indents) < 1:
                raise ValueError("invalid block indentation")
            indent = min(indents) if indents else 0
            result[key] = "".join("\n" if not v.strip() else v[indent:] for v in raw_block)
        else:
            result[key] = _yaml_scalar(raw_value)
    if "types" in result and result["types"] is None:
        result["types"] = []
    return result


def derive_framework_from_docs_query(platform: Any, _types: Any) -> str:
    return str(platform).strip() if platform not in (None, "") else "unknown"


def resolve_report_method(alias: str) -> str:
    mapping = {"p": "prompt", "e": "event", "f": "feedback", "prompt": "prompt", "event": "event", "feedback": "feedback"}
    if alias not in mapping:
        raise ValueError("invalid report method")
    return mapping[alias]


def payload_from_docs_query(
    query: dict[str, Any], *, method: str, text: str | None = None,
    feedback: str | None = None, sessionid_override: str | None = None,
) -> dict[str, Any]:
    method = resolve_report_method(method)
    payload: dict[str, Any] = {
        "product": "chat",
        "framework": derive_framework_from_docs_query(query.get("platform"), query.get("types")),
        "version": "1.0.0",
        "sdkappid": query.get("sdkappid", 0),
        "sessionid": sessionid_override or query.get("sessionId"),
        "method": method,
        "text": text if text is not None else query.get("lastPrompt", ""),
    }
    if method == "prompt":
        answer = query.get("lastAnswer")
        if not isinstance(answer, str) or not answer:
            raise ValueError("lastAnswer is required")
        payload["answer"] = answer
    if method == "feedback":
        if feedback is None:
            raise ValueError("feedback is required")
        payload["feedback"] = feedback
    if not isinstance(payload["text"], str) or not payload["text"]:
        raise ValueError("text is required")
    return payload


def _validate_send_payload(payload: dict[str, Any]) -> None:
    method = payload.get("method")
    if method not in {"prompt", "event", "feedback"}:
        raise ValueError("method must be prompt, event, or feedback")
    if not isinstance(payload.get("text"), str) or not payload["text"]:
        raise ValueError("text is required")
    if payload.get("answer") is not None and not isinstance(payload["answer"], str):
        raise ValueError("answer must be a string")
    if method == "feedback" and str(payload.get("feedback")) not in {"0", "1"}:
        raise ValueError("feedback must be 0 or 1")


def _print_debug(enabled: bool, result: dict[str, Any]) -> None:
    if enabled:
        print(json.dumps(result, ensure_ascii=False))


def _invalid_prompt_input(status: str, *, require_input: bool, debug: bool) -> int:
    """Report a malformed/empty stdin payload without changing legacy mode.

    Hooks and older callers intentionally remain fail-open (exit 0, silent in
    non-debug mode).  Foreground dispatchers opt into ``--require-input`` so a
    missing pipe cannot be mistaken for a successfully recorded Prompt.
    """
    if require_input:
        print(f"prompt stdin invalid: {status}", file=sys.stderr)
        return 2
    if debug:
        print(json.dumps({"status": status}), file=sys.stderr)
    return 0


def _add_query_args(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--m", required=True, choices=("p", "e", "f"))
    parser.add_argument("--text")
    parser.add_argument("--feedback")
    parser.add_argument("--docs-query")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--debug", action="store_true")


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="TRTC telemetry compatibility shim")
    sub = parser.add_subparsers(dest="cmd", required=True)
    bind = sub.add_parser("bind-session"); bind.add_argument("--ide"); bind.add_argument("--debug", action="store_true")
    context = sub.add_parser("context"); context.add_argument("--question", required=True); context.add_argument("--options"); context.add_argument("--debug", action="store_true")
    prompt = sub.add_parser("prompt")
    _pg = prompt.add_mutually_exclusive_group(required=True)
    _pg.add_argument("--text")
    _pg.add_argument("--input-stdin", action="store_true", dest="input_stdin")
    _pg.add_argument("--control-choice", choices=["allow", "deny"])
    prompt.add_argument(
        "--require-input",
        action="store_true",
        help="fail when --input-stdin is empty or invalid (foreground callers)",
    )
    prompt.add_argument("--debug", action="store_true")
    invoke = sub.add_parser("invoke"); invoke.add_argument("--skillname", required=True); invoke.add_argument("--product"); invoke.add_argument("--framework"); invoke.add_argument("--debug", action="store_true")
    pref = sub.add_parser("preference"); pref.add_argument("--enabled", required=True, choices=("on", "off")); pref.add_argument("--debug", action="store_true")
    send = sub.add_parser("send")
    for name in ("json", "product", "framework", "version", "sdkappid", "sessionid", "method", "text", "answer", "feedback"):
        send.add_argument("--" + name)
    send.add_argument("--scope", choices=("experience", "runtime"), default="experience")
    send.add_argument("--dry-run", action="store_true"); send.add_argument("--debug", action="store_true")
    query = sub.add_parser("send-query"); _add_query_args(query)
    docs = sub.add_parser("send-docs-query")
    docs.add_argument("--method", required=True, choices=("prompt", "event", "feedback"))
    docs.add_argument("--text"); docs.add_argument("--feedback"); docs.add_argument("--docs-query")
    docs.add_argument("--dry-run", action="store_true"); docs.add_argument("--debug", action="store_true")
    return parser


def main(argv: list[str] | None = None) -> int:
    try:
        args = _parser().parse_args(argv)
        debug = bool(getattr(args, "debug", False))
        if args.cmd == "bind-session":
            try:
                payload = _ambient_payload(_read_hook_input(), args.ide)
            except (ValueError, json.JSONDecodeError, UnicodeDecodeError):
                return 0
            ok, result = _run_node("bind-session", payload=payload, timeout_ms=BIND_HOOK_TIMEOUT_MS, debug=debug)
        elif args.cmd == "context":
            payload = _ambient_payload({"question": args.question, "options": args.options})
            ok, result = _run_node("context", payload=payload, debug=debug)
        elif args.cmd == "prompt":
            if getattr(args, "control_choice", None):
                choice = args.control_choice
                label_key = "allow_label" if choice == "allow" else "deny_label"
                label = _CONTINUATION_NOTICE.get(label_key)
                if not isinstance(label, str):
                    marker = _CONTINUATION_MARKERS.get("choice_retry")
                    if marker:
                        print(marker)
                    return 0
                ok, result = _run_node(
                    "stage-prompt",
                    payload=_ambient_payload({
                        "text": label,
                        "source": "python",
                        "control_choice": choice,
                    }),
                    debug=debug,
                )
                marker = result.get("marker") if isinstance(result, dict) else None
                if isinstance(marker, str) and marker.startswith("TRTC_REPORTING_"):
                    print(marker)
                elif not ok or result.get("status") in {
                    "runtime_unavailable", "runtime_failed", "invalid_runtime_output", "timeout", "error",
                }:
                    retry = _CONTINUATION_MARKERS.get("choice_retry")
                    if retry:
                        print(retry)
                if debug:
                    print(json.dumps(result, ensure_ascii=False), file=sys.stderr)
                return 0
            if getattr(args, "input_stdin", False):
                require_input = bool(getattr(args, "require_input", False))
                _raw = sys.stdin.buffer.read(MAX_PROMPT_STDIN_BYTES + 1)
                if len(_raw) > MAX_PROMPT_STDIN_BYTES:
                    return _invalid_prompt_input("input_too_large", require_input=require_input, debug=debug)
                try:
                    _text_str = _raw.decode("utf-8")
                except UnicodeDecodeError:
                    return _invalid_prompt_input("invalid_utf8", require_input=require_input, debug=debug)
                if chr(0) in _text_str:
                    return _invalid_prompt_input("nul_byte", require_input=require_input, debug=debug)
                try:
                    _obj = json.loads(_text_str)
                except json.JSONDecodeError:
                    return _invalid_prompt_input("invalid_json", require_input=require_input, debug=debug)
                if not isinstance(_obj, dict) or not isinstance(_obj.get("text"), str):
                    return _invalid_prompt_input("missing_text_field", require_input=require_input, debug=debug)
                # Second NUL check: catches JSON-escaped NUL that survives raw-string scan
                if chr(0) in _obj["text"]:
                    return _invalid_prompt_input("nul_byte_in_text", require_input=require_input, debug=debug)
                ok, result = _run_node("stage-prompt", payload=_ambient_payload({"text": _obj["text"], "source": "python"}), debug=debug)
                marker = result.get("marker") if isinstance(result, dict) else None
                if isinstance(marker, str) and marker.startswith("TRTC_REPORTING_"):
                    print(marker)
                elif _obj["text"].strip().rstrip("。.!！?？") in _CONTINUATION_LABELS and result.get("status") in {
                    "runtime_unavailable", "runtime_failed", "invalid_runtime_output", "timeout", "error",
                }:
                    # Fixed options are never allowed to fail-open into the
                    # ordinary Prompt path when the Runtime cannot prove
                    # control state. Ordinary prompts keep the historical
                    # fail-open behavior below.
                    marker = _CONTINUATION_MARKERS.get("choice_retry")
                    if marker:
                        print(marker)
                if debug:
                    print(json.dumps(result, ensure_ascii=False), file=sys.stderr)
                return 0
            # --text is retained for older installed Skills, but the raw text
            # is sent to Node over stdin by _run_node and never appended to
            # the Node argv.  In non-debug mode expose the same control marker
            # protocol as --input-stdin so the old production entry cannot
            # silently swallow a choice result.  Debug mode keeps its legacy
            # single JSON stdout record; callers can inspect result.marker.
            ok, result = _run_node("stage-prompt", payload=_ambient_payload({"text": args.text}), debug=debug)
            if not debug:
                marker = result.get("marker") if isinstance(result, dict) else None
                if isinstance(marker, str) and marker.startswith("TRTC_REPORTING_"):
                    print(marker)
        elif args.cmd == "invoke":
            attempt_id = secrets.token_hex(16)
            node_args = ["--skillname", args.skillname, "--input-stdin"]
            for flag in ("product", "framework"):
                value = getattr(args, flag)
                if value:
                    node_args += ["--" + flag, value]
            invoke_payload = _ambient_payload({"notice_attempt_id": attempt_id})
            ok, result = _run_node("invoke", node_args, invoke_payload, debug=debug)
            # Do not call notice-status here.  That command transitions the
            # receipt from pending_output to awaiting_choice, which would
            # make the post-answer Stop Hook believe the notice had already
            # been rendered and skip it.  The foreground invoke already
            # proves delivery and returns notice.status=created; the Stop
            # Hook is the sole owner of the pending_output -> awaiting_choice
            # transition and host-visible rendering.
            invoke_marker = None
            notice = result.get("notice") if isinstance(result, dict) else None
            if isinstance(notice, dict) and notice.get("status") == "created":
                invoke_marker = _CONTINUATION_MARKERS.get("notice_required")
            if debug:
                # Preserve the legacy single JSON debug record; production
                # callers (without --debug) receive the exact marker stdout.
                if invoke_marker:
                    result["reporting_marker"] = invoke_marker
            elif invoke_marker:
                print(invoke_marker)
        elif args.cmd == "preference":
            ok, result = _run_node("preference", ["--enabled", args.enabled], debug=debug)
            # Compatibility with older installed instructions: if the Node
            # runtime recognized this as a pending first-use choice, surface
            # the same frozen marker as --control-choice.  Ordinary explicit
            # preference changes keep their historical silent behavior.
            if not debug:
                marker = result.get("marker") if isinstance(result, dict) else None
                if isinstance(marker, str) and marker.startswith("TRTC_REPORTING_"):
                    print(marker)
        else:
            if args.cmd in {"send-query", "send-docs-query"}:
                method = resolve_report_method(args.m if args.cmd == "send-query" else args.method)
                query = load_docs_query_yaml(find_docs_query_yaml(args.docs_query) if args.docs_query else None)
                payload = payload_from_docs_query(query, method=method, text=args.text, feedback=args.feedback)
            elif args.json:
                payload = json.loads(args.json)
                if not isinstance(payload, dict):
                    raise ValueError("--json must be an object")
            else:
                payload = {name: getattr(args, name) for name in ("product", "framework", "version", "sdkappid", "sessionid", "method", "text", "answer", "feedback") if getattr(args, name) is not None}
            payload["scope"] = getattr(args, "scope", "experience")
            _validate_send_payload(payload)
            node_args = ["--dry-run"] if getattr(args, "dry_run", False) else []
            ok, result = _run_node("send", node_args, payload, debug=debug)
        if debug or getattr(args, "dry_run", False):
            _print_debug(True, result)
        # Runtime failures are intentionally fail-open. Deterministic user
        # input errors are handled by the ValueError branch below.
        return 0
    except (ValueError, json.JSONDecodeError, UnicodeDecodeError) as exc:
        if "--debug" in (argv if argv is not None else sys.argv[1:]):
            print(json.dumps({"status": "invalid", "error": str(exc)}, ensure_ascii=False))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
