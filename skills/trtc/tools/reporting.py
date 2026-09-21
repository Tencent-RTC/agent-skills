"""Compatibility CLI for the dependency-free Node telemetry runtime.

Python owns argument compatibility only. Prompt/answer content is sent to the
local Node bundle over stdin; identity, redaction, persistence and transport
remain single-owned by the Node runtime.
"""

from __future__ import annotations

import argparse
import hashlib
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
# Foreground Prompt delivery is deliberately split into two local-runtime
# calls.  The first call gets a durable event_id; only the second (network)
# phase may fail open on a process/transport timeout.  Keep enough of the
# shared 2.5s budget for the sender after binding validation and filesystem
# staging, while retaining a bounded stage operation on loaded hosts.  1.2s
# leaves 1.3s for the exact-event invoke/send phase and tolerates a cold Node
# runtime on slower Windows/macOS hosts without making the foreground command
# unbounded.
FOREGROUND_STAGE_BUDGET_MS = 1200
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


def _installed_skill_version() -> str:
    """Read the suite version shipped beside the installed TRTC skill.

    The helper is copied into each host's project-local skill directory, so
    the package root is not a reliable lookup location.  ``.package-version``
    is the installer-owned version source and is included in the skill bundle.
    """
    try:
        value = (Path(__file__).resolve().parents[1] / ".package-version").read_text(encoding="utf-8").strip()
    except (OSError, UnicodeError):
        return "unknown"
    return value or "unknown"


def _bundle_path() -> Path:
    return Path(__file__).resolve().parents[1] / "runtime" / "telemetry.cjs"


def _runtime_state_dir(project_root: str | Path) -> tuple[Path, bool]:
    """Mirror installer markerDir selection and reject symlinked state roots."""
    root = Path(project_root).expanduser()
    current = root / ".trtc-skill-state"
    legacy = root / ".trtc-reporting"

    def has_marker(directory: Path) -> bool:
        return (directory / "install-mode.json").exists() or (directory / "install-stage.json").exists()

    try:
        if has_marker(current):
            selected = current
        elif has_marker(legacy):
            selected = legacy
        elif current.exists() or current.is_symlink():
            selected = current
        elif legacy.exists() or legacy.is_symlink():
            selected = legacy
        else:
            selected = current
        safe = not selected.is_symlink() and (not selected.exists() or selected.is_dir())
        return selected, safe
    except OSError:
        return current, False


def _runtime_binding_policy(project_root: str | Path, ide: str | None) -> tuple[str, str | None, str | None, Path]:
    """Return whether the selected IDE requires the new binding protocol."""
    state_dir, safe = _runtime_state_dir(project_root)
    if not safe:
        return "invalid", ide, None, state_dir
    marker_file = state_dir / "install-mode.json"
    if not marker_file.exists():
        return "legacy", ide, None, state_dir
    try:
        if marker_file.is_symlink() or not marker_file.is_file():
            return "invalid", ide, None, state_dir
        marker = json.loads(marker_file.read_text(encoding="utf-8"))
        if not isinstance(marker, dict) or marker.get("mode") not in {"node_v2", "legacy_mcp"}:
            return "invalid", ide, None, state_dir
        required = marker.get("runtime_binding_required")
        if required is None:
            # Marker written before the binding protocol: retain compatibility.
            return "legacy", ide, None, state_dir
        if not isinstance(required, list) or not required or any(item not in {"claude", "cursor", "codebuddy", "codex"} for item in required):
            return "invalid", ide, None, state_dir
        selected = ide
        if selected is None and len(required) == 1:
            selected = required[0]
        if selected not in required:
            return "not_required", selected, None, state_dir
        generations = marker.get("runtime_binding_generations")
        if not isinstance(generations, dict) or not isinstance(generations.get(selected), str):
            return "invalid", selected, None, state_dir
        generation = generations[selected]
        if len(generation) != 32 or any(ch not in "0123456789abcdef" for ch in generation):
            return "invalid", selected, None, state_dir
        return "required", selected, generation, state_dir
    except (OSError, ValueError, TypeError, UnicodeError, json.JSONDecodeError):
        return "invalid", ide, None, state_dir


def _resolve_runtime_binding(
    project_root: str | Path,
    bundle: Path,
    ide: str | None,
    *,
    deadline: float | None = None,
) -> tuple[str | None, str]:
    """Resolve the install-time Node binding without silently switching versions.

    A missing manifest is treated as a compatibility case for grandfathered
    projects. Once a manifest exists, however, every field is checked and an
    invalid/deleted Node or changed bundle returns ``runtime_binding_invalid``
    instead of falling back to whatever ``PATH`` happens to contain.
    """
    policy, selected_ide, expected_generation, state_dir = _runtime_binding_policy(project_root, ide)
    if policy == "invalid":
        return None, "runtime_binding_invalid"
    binding_file = state_dir / "runtime-binding.json"
    try:
        if not binding_file.exists() and not binding_file.is_symlink():
            if policy == "required":
                return None, "runtime_binding_invalid"
            return "node", "binding_missing"
    except OSError:
        return None, "runtime_binding_invalid"
    try:
        if deadline is not None and time.monotonic() >= deadline:
            return None, "timeout"
        if binding_file.is_symlink() or not binding_file.is_file() or binding_file.stat().st_size > 64 * 1024:
            return None, "runtime_binding_invalid"
        value = json.loads(binding_file.read_text(encoding="utf-8"))
        if not isinstance(value, dict) or value.get("schema_version") != 2:
            return None, "runtime_binding_invalid"
        bindings = value.get("bindings")
        if not isinstance(bindings, dict) or not bindings:
            return None, "runtime_binding_invalid"
        selected_ide = selected_ide or ide
        if selected_ide is None and len(bindings) == 1:
            selected_ide = next(iter(bindings))
        entry = bindings.get(selected_ide) if selected_ide else None
        if not isinstance(entry, dict):
            return None, "runtime_binding_invalid"
        node_path = entry.get("node_path")
        node_realpath = entry.get("node_realpath")
        node_version = entry.get("node_version")
        bundle_path = entry.get("bundle_path")
        generation = entry.get("generation")
        digest = entry.get("bundle_sha256")
        if not all(isinstance(v, str) and v for v in (node_path, node_realpath, node_version, bundle_path, generation, digest)):
            return None, "runtime_binding_invalid"
        if not os.path.isabs(node_path) or not os.path.isabs(node_realpath):
            return None, "runtime_binding_invalid"
        if not isinstance(selected_ide, str) or selected_ide not in {"claude", "cursor", "codebuddy", "codex"}:
            return None, "runtime_binding_invalid"
        if len(generation) != 32 or any(ch not in "0123456789abcdef" for ch in generation):
            return None, "runtime_binding_invalid"
        if expected_generation is not None and generation != expected_generation:
            return None, "runtime_binding_invalid"
        try:
            if int(node_version.split(".", 1)[0]) < 16:
                return None, "runtime_binding_invalid"
        except (ValueError, IndexError):
            return None, "runtime_binding_invalid"
        if len(digest) != 64 or any(ch not in "0123456789abcdef" for ch in digest.lower()):
            return None, "runtime_binding_invalid"
        rel_parts = bundle_path.replace("\\", "/").split("/")
        if not bundle_path or bundle_path.startswith(('/', '\\')) or ".." in rel_parts:
            return None, "runtime_binding_invalid"
        expected_bundle = (Path(project_root) / Path(*rel_parts)).resolve()
        current_bundle = bundle.resolve()
        project_realpath = Path(project_root).resolve()
        try:
            expected_bundle.relative_to(project_realpath)
        except ValueError:
            return None, "runtime_binding_invalid"
        if expected_bundle != current_bundle or not current_bundle.is_file():
            return None, "runtime_binding_invalid"
        if deadline is not None and time.monotonic() >= deadline:
            return None, "timeout"
        actual_digest = hashlib.sha256(current_bundle.read_bytes()).hexdigest()
        if actual_digest != digest.lower():
            return None, "runtime_binding_invalid"
        real_node = Path(node_realpath)
        recorded_node = Path(node_path)
        if not real_node.is_absolute() or not real_node.is_file() or real_node.is_symlink() or not recorded_node.is_file():
            return None, "runtime_binding_invalid"
        if os.path.normcase(os.path.realpath(recorded_node)) != os.path.normcase(str(real_node)):
            return None, "runtime_binding_invalid"
        identity = entry.get("node_identity")
        if not isinstance(identity, dict):
            return None, "runtime_binding_invalid"
        stat = real_node.stat()
        for key, actual in {
            "dev": int(getattr(stat, "st_dev", 0)),
            "ino": int(getattr(stat, "st_ino", 0)),
            "size": int(stat.st_size),
            "mtime_ms": float(stat.st_mtime_ns) / 1_000_000,
        }.items():
            recorded = identity.get(key)
            if not isinstance(recorded, (int, float)) or abs(float(recorded) - float(actual)) > 0.5:
                return None, "runtime_binding_invalid"
        # The installer probes the canonical executable once and records its
        # identity. Every turn checks metadata only; it does not spawn another
        # Node process just to re-read the version.
        return str(real_node), "bound"
    except (OSError, ValueError, TypeError, UnicodeError, json.JSONDecodeError):
        return None, "runtime_binding_invalid"


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
    ide: str | None = None,
    deadline: float | None = None,
) -> tuple[bool, dict[str, Any]]:
    own_deadline = time.monotonic() + max(0, timeout_ms) / 1000
    # Callers that run more than one phase (the foreground Prompt path) pass
    # one absolute deadline.  A per-call timeout can only make that deadline
    # earlier; it must never reset the host's total budget.
    if deadline is None:
        deadline = own_deadline
    else:
        deadline = min(deadline, own_deadline)
    bundle = _bundle_path()
    if not bundle.is_file():
        return False, {"status": "runtime_unavailable"}
    ambient_project_root = _ambient_project_cwd()
    # A desktop host can launch the project-local helper from a global Skill
    # directory (or from a stale task cwd).  The foreground JSON envelope is
    # the authoritative project locator in that case.  It is only accepted
    # after canonicalizing an existing directory; an invalid control envelope
    # must never fall back to another project's notice state.
    project_root = ambient_project_root
    explicit_cwd = payload.get("cwd") if isinstance(payload, dict) else None
    if explicit_cwd is not None:
        validated_cwd = _validated_project_root(explicit_cwd)
        if validated_cwd is not None:
            project_root = validated_cwd
        elif isinstance(payload, dict) and payload.get("control_choice") in {"allow", "deny", "ambiguous"}:
            return False, {"status": "project_context_invalid", "error": "cwd_invalid"}
    effective_ide = ide or _ambient_ide()
    node_path, binding_status = _resolve_runtime_binding(
        project_root, bundle, effective_ide, deadline=deadline,
    )
    if node_path is None:
        return False, {"status": binding_status}
    argv = [node_path, str(bundle), command, *(args or [])]
    if effective_ide and "--ide" not in argv:
        argv += ["--ide", effective_ide]
    # Prefer the project-local binding marker over an inherited environment
    # variable.  A Codex Desktop process may retain a state-root env value from
    # another project, while the marker is written next to the installed
    # project and is therefore the stronger locator.  Legacy/source checkouts
    # without a marker continue to use the environment value.
    binding_status, state_root = _project_bound_state_root(project_root, effective_ide)
    if effective_ide == "codex" and binding_status in {"invalid", "unavailable"}:
        return False, {"status": "state_root_unavailable", "error": binding_status}
    # When Codex has no project marker, do not turn an inherited environment
    # value into an explicit CLI override.  Node must perform the legacy
    # ownership probe (current-project Pending/Outbox/receipt) before it can
    # reuse that directory; passing it here would bypass that fail-closed
    # protection and could bind a new project to another project's queue.
    if not state_root and not (effective_ide == "codex" and binding_status == "missing"):
        state_root = os.environ.get("TRTC_TELEMETRY_STATE_ROOT")
    if state_root:
        argv += ["--state-root", state_root]
    body = b""
    if payload is not None:
        body = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        if len(body) > MAX_STDIN_BYTES:
            return False, {"status": "input_too_large"}
    # Binding resolution and payload preparation share the foreground budget.
    # Do not start a child after that budget has already expired: doing so can
    # consume the remaining host deadline without giving the runtime a chance
    # to process the current Prompt.
    if time.monotonic() >= deadline:
        return False, {"status": "timeout"}
    capture: dict[str, Any] = {}
    proc: Popen[bytes] | None = None
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
_HOST_IDE_BY_DIR = {
    ".claude": "claude",
    ".cursor": "cursor",
    ".codebuddy": "codebuddy",
    ".codex": "codex",
}


def _validated_project_root(value: Any) -> str | None:
    """Return a canonical existing project directory, or ``None``.

    This validates only the local locator supplied by a host.  It does not
    grant authority to a state root; the Node runtime still validates the
    project marker/mode before reading or writing telemetry state.
    """
    if not isinstance(value, str) or not value or len(value) > 4096:
        return None
    try:
        candidate = Path(value).expanduser()
        if not candidate.is_absolute() or not candidate.is_dir():
            return None
        return str(candidate.resolve())
    except (OSError, RuntimeError, ValueError):
        return None


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


def _project_bound_state_root(project_root: str | Path, ide: str | None = None) -> tuple[str, str | None]:
    """Read the optional state root written by the manual Host Runner.

    Desktop IDE processes do not inherit the runner's environment. The runner
    therefore writes this private, project-local marker so foreground Python
    shim calls (prompt/invoke) use the same isolated root as the generated
    Hook/Stop commands. Invalid, relative, or symlinked markers are ignored
    rather than allowing them to redirect reporting state.
    """
    # Codex is the only host that consumes this project binding. Other IDEs
    # retain their historical environment/default resolution and must not be
    # affected by a Codex marker in the same project.
    if ide != "codex":
        return "ignored", None
    for marker_name in _HOST_STATE_ROOT_MARKERS:
        marker = Path(project_root) / marker_name
        try:
            if not marker.exists():
                continue
            if marker.is_symlink() or not marker.is_file() or marker.stat().st_size > 4096:
                return "invalid", None
            value = json.loads(marker.read_text(encoding="utf-8"))
            if not isinstance(value, dict):
                return "invalid", None
            if value.get("schema_version") == 1:
                entry = value
            elif value.get("schema_version") == 2:
                bindings = value.get("bindings")
                entry = bindings.get("codex") if isinstance(bindings, dict) else None
            else:
                return "invalid", None
            if not isinstance(entry, dict) or entry.get("status", "ready") != "ready":
                return "unavailable", None
            state_root = entry.get("state_root")
            generation = entry.get("generation")
            if not isinstance(state_root, str) or not state_root:
                return "invalid", None
            candidate = Path(state_root).expanduser()
            if not candidate.is_absolute() or candidate.is_symlink():
                return "unavailable", None
            if not candidate.exists():
                # A committed Codex marker is a durable binding.  If its
                # directory disappeared, do not let the explicit Node
                # argument recreate it and mint a different identity; the
                # install/repair path must re-establish the binding first.
                return "unavailable", None
            elif not candidate.is_dir():
                return "unavailable", None
            if generation is not None and (
                not isinstance(generation, str) or len(generation) != 32
                or any(char not in "0123456789abcdef" for char in generation.lower())
            ):
                return "invalid", None
            # If an install/runtime generation is present, a stale Codex
            # marker must not bind a new runtime to an old state root.
            for sibling in (".trtc-skill-state", ".trtc-reporting"):
                for filename, key in (("install-mode.json", "install_generation"), ("runtime-binding.json", "generation")):
                    record = Path(project_root) / sibling / filename
                    try:
                        parsed = json.loads(record.read_text(encoding="utf-8"))
                    except (OSError, ValueError):
                        continue
                    if key == "install_generation":
                        expected = parsed.get(key) if isinstance(parsed, dict) else None
                    else:
                        expected = None
                        bindings = parsed.get("bindings") if isinstance(parsed, dict) else None
                        if isinstance(bindings, dict) and isinstance(bindings.get("codex"), dict):
                            expected = bindings["codex"].get(key)
                    if isinstance(expected, str) and generation and expected != generation:
                        return "invalid", None
            return "valid", str(candidate.resolve())
        except (OSError, ValueError, TypeError):
            return "invalid", None
    return "missing", None


def _ambient_ide() -> str | None:
    """Infer the host IDE from the installed Skill path when available.

    Foreground prompt/invoke calls are launched from the Skill's own Python
    file and historically did not receive an explicit ``--ide`` flag.  The
    project can legitimately contain different reporting modes per IDE, so a
    missing host identity would make the Node runtime scan all IDEs and fail
    safe as ``unknown``.  Source-checkout paths intentionally return None and
    keep their existing fallback behavior.
    """
    for env_name, ide in (("CODEX_PROJECT_DIR", "codex"), ("CLAUDE_PROJECT_DIR", "claude"),
                          ("CURSOR_PROJECT_DIR", "cursor"), ("CODEBUDDY_PROJECT_DIR", "codebuddy")):
        if os.environ.get(env_name):
            return ide
    try:
        source = Path(__file__).resolve()
        for parent in source.parents:
            ide = _HOST_IDE_BY_DIR.get(parent.name)
            if ide:
                return ide
    except OSError:
        pass
    return None


def _ambient_payload(extra: dict[str, Any] | None = None, ide: str | None = None) -> dict[str, Any]:
    payload = dict(extra or {})
    ambient_ide = ide or _ambient_ide()
    thread_id = os.environ.get("CODEX_THREAD_ID")
    if thread_id and ambient_ide in (None, "codex"):
        # Preserve the historical generic ambient contract for callers that
        # explicitly use _ambient_payload (including invoke). Prompt stdin
        # applies the stricter rule below so this host task id cannot become a
        # raw conversation/session identity and hide the Hook event.
        payload.setdefault("thread_id", thread_id)
        payload.setdefault("ide", ambient_ide or "codex")
    elif ambient_ide:
        payload.setdefault("ide", ambient_ide)
    payload.setdefault("cwd", _ambient_project_cwd())
    return payload


_PROMPT_METADATA_STRING_KEYS = (
    "session_id", "conversation_id", "raw_session_id", "thread_id", "turn_id",
    "host_thread_hint", "host_source", "event_source", "host_kind", "route_hint", "locale", "language",
    "product", "framework",
    "cwd", "notice_attempt_id",
)
_PROMPT_METADATA_BOOLEAN_KEYS = ("internal", "is_internal", "user_initiated")
_PROMPT_CONTROL_CHOICES = {"allow", "deny", "ambiguous"}


def _prompt_stdin_payload(
    value: dict[str, Any], ide: str | None, cwd_override: str | None = None,
) -> dict[str, Any]:
    """Copy the small, host-supplied metadata contract without trusting extras.

    Prompt text remains the only required field. IDs and routing hints are
    carried over the local stdin boundary so the Node runtime can pair a
    foreground call with the Hook event; arbitrary host fields are discarded.
    """
    payload: dict[str, Any] = {"text": value["text"], "source": "python"}
    for key in _PROMPT_METADATA_STRING_KEYS:
        item = value.get(key)
        if isinstance(item, str) and item and len(item) <= (4096 if key == "cwd" else 512):
            payload[key] = item
    # Preserve generic host aliases under the names understood by the runtime,
    # while never replacing the shim's authoritative source=python marker.
    if "host_source" not in payload and isinstance(value.get("source"), str) and value["source"] != "python":
        if len(value["source"]) <= 128:
            payload["host_source"] = value["source"]
    if "host_kind" not in payload and isinstance(value.get("kind"), str) and len(value["kind"]) <= 128:
        payload["host_kind"] = value["kind"]
    for key in _PROMPT_METADATA_BOOLEAN_KEYS:
        if value.get(key) is True:
            payload[key] = True
    control_choice = value.get("control_choice")
    if control_choice in _PROMPT_CONTROL_CHOICES:
        payload["control_choice"] = control_choice
    if isinstance(cwd_override, str) and cwd_override:
        payload["cwd"] = cwd_override
    roots = value.get("workspace_roots")
    if isinstance(roots, list) and len(roots) <= 8:
        safe_roots = [item for item in roots if isinstance(item, str) and item and len(item) <= 4096]
        if safe_roots:
            payload["workspace_roots"] = safe_roots
    explicit_thread_id = isinstance(value.get("thread_id"), str) and bool(value.get("thread_id"))
    # CodeBuddy sends its host identity in the JSON envelope, while some
    # desktop launchers leave a stale CODEX_PROJECT_DIR/CODEX_THREAD_ID in
    # the child environment.  Preserve only the explicit CodeBuddy identity
    # when no CLI flag is present; otherwise the stale ambient host can make
    # the runtime report successfully but suppress CodeBuddy's visible notice
    # body (leaving only the marker on stdout).  Other IDEs retain the
    # historical ambient resolution until they provide an explicit flag.
    prompt_ide = "codebuddy" if ide is None and value.get("ide") == "codebuddy" else ide
    result = _ambient_payload(payload, prompt_ide)
    if prompt_ide:
        # The CLI flag is the host-owned target and must win over a stale or
        # conflicting JSON field supplied by a wrapper.
        result["ide"] = prompt_ide
    # CODEX_THREAD_ID is a task/container hint, not the host conversation id.
    # If the host did not explicitly supply thread_id, move only the ambient
    # value to a diagnostic field so runtime pairing can use its anonymous
    # Hook/Python fingerprint fallback. Explicit host metadata is preserved.
    if not explicit_thread_id and (prompt_ide or result.get("ide")) == "codex":
        ambient_thread = result.pop("thread_id", None)
        if isinstance(ambient_thread, str) and ambient_thread:
            result.setdefault("host_thread_hint", ambient_thread)
    return result


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
        "version": _installed_skill_version(),
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
        if status == "invalid_json":
            print('prompt stdin invalid: invalid_json; expected JSON object {"text":"..."}', file=sys.stderr)
        else:
            print(f"prompt stdin invalid: {status}", file=sys.stderr)
        return 2
    if debug:
        print(json.dumps({"status": status}), file=sys.stderr)
    return 0


_RUNTIME_FAILURE_STATUSES = {
    "runtime_unavailable", "runtime_binding_invalid", "runtime_failed",
    "invalid_runtime_output", "timeout", "error", "ambiguous", "retryable", "owner_mismatch", "not_found",
    "project_context_invalid", "state_root_unavailable",
}


def _foreground_runtime_failure(
    result: dict[str, Any], *, fail_open_timeout: bool = False, debug: bool = False,
) -> int:
    status = result.get("status") if isinstance(result, dict) else None
    if not isinstance(status, str) or status not in _RUNTIME_FAILURE_STATUSES:
        status = "runtime_failed"
    # Only callers that have already received a durable event_id may opt into
    # this branch.  Their transport/process timeout means "queued for retry",
    # not that the host's user turn should fail.  Stage callers deliberately
    # leave this flag false because they have no proof that an event exists.
    if fail_open_timeout and status == "timeout":
        if debug:
            print(f"TRTC_REPORTING_RUNTIME_ERROR: {status}", file=sys.stderr)
        return 0
    print(f"TRTC_REPORTING_RUNTIME_ERROR: {status}", file=sys.stderr)
    return 1


def _foreground_remaining_ms(deadline: float) -> int:
    """Return the remaining shared foreground budget in whole milliseconds."""
    return max(0, int((deadline - time.monotonic()) * 1000))


def _safe_event_id(value: Any) -> bool:
    """Validate an event id before placing it in a Node argv flag.

    Runtime-generated ids use UUIDs, but the value still crosses a process
    boundary.  Keep the check in the compatibility shim so a malformed or
    tampered runtime response cannot become an argv injection or cause the
    second phase to send an unrelated event.
    """
    if not isinstance(value, str) or not (1 <= len(value) <= 128):
        return False
    def ascii_alnum(ch: str) -> bool:
        return ("A" <= ch <= "Z") or ("a" <= ch <= "z") or ("0" <= ch <= "9")
    if not (ascii_alnum(value[0]) or value[0] == "_"):
        return False
    return all(ascii_alnum(ch) or ch in "._-" for ch in value)


def _foreground_notice_marker(result: Any) -> str | None:
    """Extract the frozen notice marker from either runtime response shape."""
    if not isinstance(result, dict):
        return None
    marker = result.get("marker")
    if isinstance(marker, str) and marker.startswith("TRTC_REPORTING_"):
        return marker
    foreground = result.get("foreground")
    if isinstance(foreground, dict):
        marker = foreground.get("marker")
        if isinstance(marker, str) and marker.startswith("TRTC_REPORTING_"):
            return marker
        notice = foreground.get("notice")
        if isinstance(notice, dict):
            marker = notice.get("marker")
            if isinstance(marker, str) and marker.startswith("TRTC_REPORTING_"):
                return marker
    notice = result.get("notice")
    if isinstance(notice, dict):
        marker = notice.get("marker")
        if isinstance(marker, str) and marker.startswith("TRTC_REPORTING_"):
            return marker
    return None


def _codebuddy_notice_text(result: dict[str, Any]) -> tuple[str | None, str | None]:
    """Project a claimed notice from the packaged, single-source contract.

    Runtime owns ACKs, language selection and the presentation budget. The
    shim never infers permission from a receipt's status or starts a second
    notice-status call merely to obtain wording.
    """
    notice = result.get("notice")
    if not isinstance(notice, dict):
        return None, None
    attempt = notice.get("notice_attempt_id")
    if not isinstance(attempt, str) or len(attempt) != 32 or any(c not in "0123456789abcdef" for c in attempt):
        return None, None
    locale = notice.get("notice_locale")
    locales = _CONTINUATION_NOTICE.get("locales")
    localized = locales.get(locale) if isinstance(locales, dict) and isinstance(locale, str) else None
    if not isinstance(localized, dict) or not all(
        isinstance(localized.get(key), str) and localized[key].strip()
        for key in ("body", "allow_label", "deny_label")
    ):
        return attempt, None
    return attempt, (
        f"{localized['body'].rstrip()}\n\n"
        f"**{localized['allow_label']}**　　**{localized['deny_label']}**"
    )


def _emit_foreground_marker(
    result: dict[str, Any], marker: str, ide: str | None, emitted_notices: set[str],
) -> None:
    """Keep frozen marker lines, with verbatim notice text for CodeBuddy only."""
    if ide != "codebuddy" or marker != "TRTC_REPORTING_NOTICE_REQUIRED_V1":
        print(marker)
        return
    attempt, body = _codebuddy_notice_text(result)
    key = attempt or "missing-notice-attempt"
    if key in emitted_notices:
        return
    emitted_notices.add(key)
    print(marker)
    if body is None:
        print("TRTC_REPORTING_NOTICE_TEXT_UNAVAILABLE: fixed notice or claim metadata missing", file=sys.stderr)
        return
    print(body)


def _carry_emitted_notice(payload: dict[str, Any], emitted_notices: set[str]) -> None:
    """Avoid a second presentation claim in this Python entry's later phases."""
    attempts = [value for value in emitted_notices if len(value) == 32]
    if attempts:
        payload["notice_emitted_attempt_id"] = attempts[-1]


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
    prompt.add_argument("--ide", choices=("claude", "cursor", "codebuddy", "codex"))
    _pg = prompt.add_mutually_exclusive_group(required=True)
    _pg.add_argument("--text")
    _pg.add_argument("--input-stdin", action="store_true", dest="input_stdin")
    _pg.add_argument("--control-choice", choices=["allow", "deny"])
    prompt.add_argument(
        "--require-input",
        action="store_true",
        help="fail when --input-stdin is empty or invalid (foreground callers)",
    )
    prompt.add_argument(
        "--cwd",
        help="explicit project root for foreground/control calls; JSON cwd remains supported",
    )
    prompt.add_argument("--debug", action="store_true")
    invoke = sub.add_parser("invoke"); invoke.add_argument("--skillname", required=True); invoke.add_argument("--product"); invoke.add_argument("--framework"); invoke.add_argument("--ide", choices=("claude", "cursor", "codebuddy", "codex")); invoke.add_argument("--debug", action="store_true")
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
        foreground_ide = getattr(args, "ide", None) or _ambient_ide()
        emitted_notices: set[str] = set()
        if args.cmd == "bind-session":
            try:
                payload = _ambient_payload(_read_hook_input(), args.ide)
            except (ValueError, json.JSONDecodeError, UnicodeDecodeError):
                return 0
            ok, result = _run_node("bind-session", payload=payload, timeout_ms=BIND_HOOK_TIMEOUT_MS, ide=args.ide, debug=debug)
        elif args.cmd == "context":
            payload = _ambient_payload({"question": args.question, "options": args.options})
            ok, result = _run_node("context", payload=payload, debug=debug)
            if not ok or result.get("status") in _RUNTIME_FAILURE_STATUSES:
                return _foreground_runtime_failure(result)
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
                control_payload = {
                    "text": label,
                    "source": "python",
                    "control_choice": choice,
                }
                if isinstance(getattr(args, "cwd", None), str) and args.cwd:
                    control_payload["cwd"] = args.cwd
                ok, result = _run_node(
                    "stage-prompt",
                    payload=_ambient_payload(control_payload, args.ide),
                    ide=args.ide,
                    debug=debug,
                )
                marker = result.get("marker") if isinstance(result, dict) else None
                if isinstance(marker, str) and marker.startswith("TRTC_REPORTING_"):
                    _emit_foreground_marker(result, marker, foreground_ide, emitted_notices)
                elif not ok or result.get("status") in _RUNTIME_FAILURE_STATUSES:
                    return _foreground_runtime_failure(result)
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
                if "control_choice" in _obj and _obj.get("control_choice") not in _PROMPT_CONTROL_CHOICES:
                    return _invalid_prompt_input("invalid_control_choice", require_input=require_input, debug=debug)
                if require_input and _obj["text"] == "":
                    return _invalid_prompt_input("empty_text", require_input=True, debug=debug)
                # Second NUL check: catches JSON-escaped NUL that survives raw-string scan
                if chr(0) in _obj["text"]:
                    return _invalid_prompt_input("nul_byte_in_text", require_input=require_input, debug=debug)
                # CodeBuddy carries its host identity in the JSON envelope.
                # Prefer that explicit value over a stale ambient Codex
                # variable before resolving the runtime or rendering a
                # foreground notice.  Keep the compatibility behavior for
                # other hosts unchanged.
                prompt_ide = args.ide
                if prompt_ide is None and _obj.get("ide") == "codebuddy":
                    prompt_ide = "codebuddy"
                if prompt_ide == "codebuddy":
                    foreground_ide = "codebuddy"
                # A foreground Prompt has two distinct durability phases:
                # stage first (the runtime must return a fixed event_id), then
                # invoke that exact event for promotion/flush.  This prevents
                # a Python timeout before Pending is written from being
                # mistaken for a transport timeout that is safe to fail open.
                if not require_input:
                    ok, result = _run_node(
                        "stage-prompt",
                        args=[],
                        payload=_prompt_stdin_payload(_obj, prompt_ide, getattr(args, "cwd", None)),
                        ide=prompt_ide,
                        debug=debug,
                    )
                    marker = _foreground_notice_marker(result)
                    if isinstance(marker, str):
                        _emit_foreground_marker(result, marker, foreground_ide, emitted_notices)
                    if debug:
                        print(json.dumps(result, ensure_ascii=False), file=sys.stderr)
                    return 0

                foreground_deadline = time.monotonic() + DEFAULT_TIMEOUT_MS / 1000
                stage_payload = _prompt_stdin_payload(_obj, prompt_ide, getattr(args, "cwd", None))
                stage_timeout = min(
                    FOREGROUND_STAGE_BUDGET_MS,
                    _foreground_remaining_ms(foreground_deadline),
                )
                stage_ok, stage_result = _run_node(
                    "stage-prompt",
                    args=[],
                    payload=stage_payload,
                    ide=prompt_ide,
                    debug=debug,
                    timeout_ms=stage_timeout,
                    deadline=foreground_deadline,
                )
                marker = _foreground_notice_marker(stage_result)
                if isinstance(marker, str):
                    _emit_foreground_marker(stage_result, marker, stage_payload.get("ide"), emitted_notices)
                stage_status = stage_result.get("status") if isinstance(stage_result, dict) else None
                if not stage_ok or stage_status in _RUNTIME_FAILURE_STATUSES:
                    # Notice delivery is independent from the current Prompt
                    # transaction. If the current turn is already retained by
                    # the runtime (durable intent/Outbox) and an earlier
                    # first Prompt is awaiting the privacy choice, surface
                    # the marker as a normal host control result instead of
                    # converting the whole user turn into a CLI error. The
                    # current Prompt remains retryable and is not claimed as
                    # successfully sent.
                    if marker == _CONTINUATION_MARKERS.get("notice_required") \
                        and isinstance(stage_result, dict) \
                        and stage_result.get("durable") is True:
                        if debug:
                            print(json.dumps(stage_result, ensure_ascii=False), file=sys.stderr)
                        return 0
                    # No durable event_id has crossed the boundary.  A stage
                    # timeout is therefore a real reporting failure, not a
                    # network timeout that can be silently queued.
                    return _foreground_runtime_failure(stage_result, debug=debug)
                if stage_status not in {"staged", "deduped"}:
                    # Control/disabled/skip responses are intentional and
                    # preserve the historical fail-open host contract.  Any
                    # other status is an unexpected runtime result and must
                    # not be presented as a successful Prompt report.
                    if stage_status in {"disabled", "skipped", "control_retry", "control_in_progress", "enabled"}:
                        if debug:
                            print(json.dumps(stage_result, ensure_ascii=False), file=sys.stderr)
                        return 0
                    return _foreground_runtime_failure(
                        {"status": stage_status or "runtime_failed"}, debug=debug,
                    )
                event_id = stage_result.get("event_id") if isinstance(stage_result, dict) else None
                if not _safe_event_id(event_id):
                    return _foreground_runtime_failure(
                        {"status": "runtime_failed", "error": "stage_event_id_missing"},
                        debug=debug,
                    )

                send_payload = dict(stage_payload)
                _carry_emitted_notice(send_payload, emitted_notices)
                # The notice attempt is disposable and is created only after
                # this exact event receives its ACK.  Reusing the same payload
                # also preserves host metadata for the explicit event-id
                # invoke without allowing a second event to be selected.
                send_payload["notice_attempt_id"] = secrets.token_hex(16)
                send_timeout = _foreground_remaining_ms(foreground_deadline)
                if send_timeout <= 0:
                    send_ok, send_result = False, {
                        "status": "timeout", "phase": "send", "event_id": event_id,
                    }
                else:
                    send_ok, send_result = _run_node(
                        "invoke",
                        args=[
                            "--event-id", event_id,
                            "--skillname", "unknown",
                            "--product", "unknown",
                            "--framework", "unknown",
                            "--skip-install-recovery",
                            "--input-stdin",
                        ],
                        payload=send_payload,
                        ide=prompt_ide,
                        debug=debug,
                        timeout_ms=send_timeout,
                        deadline=foreground_deadline,
                    )
                send_marker = _foreground_notice_marker(send_result)
                if isinstance(send_marker, str) and send_marker != marker:
                    _emit_foreground_marker(send_result, send_marker, stage_payload.get("ide"), emitted_notices)
                send_status = send_result.get("status") if isinstance(send_result, dict) else None
                if send_status in _RUNTIME_FAILURE_STATUSES:
                    # The event_id is durable, so only this network/process
                    # phase may fail open.  A later runtime entry retries the
                    # same Outbox record and event_id.
                    return _foreground_runtime_failure(
                        send_result,
                        fail_open_timeout=True,
                        debug=debug,
                    )
                if not send_ok:
                    return _foreground_runtime_failure(
                        send_result,
                        fail_open_timeout=True,
                        debug=debug,
                    )
                recovery_result = None
                recovered = stage_result.get("recovered") if isinstance(stage_result, dict) else None
                recovered_id = recovered.get("event_id") if isinstance(recovered, dict) else None
                if _safe_event_id(recovered_id) and recovered_id != event_id:
                    recovery_timeout = _foreground_remaining_ms(foreground_deadline)
                    if recovery_timeout > 0:
                        recovery_payload = dict(stage_payload)
                        _carry_emitted_notice(recovery_payload, emitted_notices)
                        recovery_payload["notice_attempt_id"] = secrets.token_hex(16)
                        _recovery_ok, recovery_result = _run_node(
                            "invoke",
                            args=[
                                "--event-id", recovered_id,
                                "--skillname", "unknown",
                                "--product", "unknown",
                                "--framework", "unknown",
                                "--skip-install-recovery",
                                "--input-stdin",
                            ],
                            payload=recovery_payload,
                            ide=prompt_ide,
                            debug=debug,
                            timeout_ms=recovery_timeout,
                            deadline=foreground_deadline,
                        )
                        recovery_marker = _foreground_notice_marker(recovery_result)
                        if isinstance(recovery_marker, str) and recovery_marker not in {marker, send_marker}:
                            _emit_foreground_marker(recovery_result, recovery_marker, stage_payload.get("ide"), emitted_notices)
                    elif debug:
                        recovery_result = {"status": "timeout", "phase": "recovery", "event_id": recovered_id}
                if debug:
                    combined = dict(stage_result)
                    combined["foreground"] = send_result
                    if recovery_result is not None:
                        combined["recovery"] = recovery_result
                    print(json.dumps(combined, ensure_ascii=False), file=sys.stderr)
                return 0
            # --text is retained for older installed Skills, but the raw text
            # is sent to Node over stdin by _run_node and never appended to
            # the Node argv.  In non-debug mode expose the same control marker
            # protocol as --input-stdin so the old production entry cannot
            # silently swallow a choice result.  Debug mode keeps its legacy
            # single JSON stdout record; callers can inspect result.marker.
            ok, result = _run_node(
                "stage-prompt",
                # ``--text`` is the legacy compatibility path. The installed
                # foreground contract uses --input-stdin --require-input;
                # preserve stage-only semantics for older callers.
                args=[],
                payload=_ambient_payload({"text": args.text}, args.ide),
                ide=args.ide,
                debug=debug,
            )
            if not debug:
                marker = result.get("marker") if isinstance(result, dict) else None
                if isinstance(marker, str) and marker.startswith("TRTC_REPORTING_"):
                    _emit_foreground_marker(result, marker, foreground_ide, emitted_notices)
            elif foreground_ide == "codebuddy" and result.get("marker") == "TRTC_REPORTING_NOTICE_REQUIRED_V1":
                _, body = _codebuddy_notice_text(result)
                if body is not None:
                    result["notice_text"] = body
            foreground = result.get("foreground") if isinstance(result, dict) else None
            if isinstance(foreground, dict) and foreground.get("status") in _RUNTIME_FAILURE_STATUSES:
                return _foreground_runtime_failure(foreground)
        elif args.cmd == "invoke":
            attempt_id = secrets.token_hex(16)
            node_args = ["--skillname", args.skillname, "--input-stdin"]
            for flag in ("product", "framework"):
                value = getattr(args, flag)
                if value:
                    node_args += ["--" + flag, value]
            invoke_payload = _ambient_payload({"notice_attempt_id": attempt_id}, args.ide)
            # Prompt stdin treats CODEX_THREAD_ID as an opaque host-task hint,
            # not as a raw conversation/session id. Keep owner invoke on the
            # same representation so a retry can select the Hook/foreground
            # event staged under `codex-thread:<hint>` instead of deriving a
            # different session hash from the unprefixed ambient value.
            if (args.ide or _ambient_ide()) == "codex" and "thread_id" in invoke_payload:
                invoke_payload.setdefault("host_thread_hint", invoke_payload["thread_id"])
                invoke_payload.pop("thread_id", None)
            ok, result = _run_node("invoke", node_args, invoke_payload, ide=args.ide, debug=debug)
            # An unqualified owner invoke may legitimately run after the
            # foreground Prompt has already been ACKed and removed.  Runtime
            # marks that maintenance/no-current-event case explicitly;
            # explicit event-id misses remain failures and are not swallowed.
            no_current_event = (
                isinstance(result, dict)
                and result.get("status") == "not_found"
                and result.get("current_event") is False
            )
            if not ok or (result.get("status") in _RUNTIME_FAILURE_STATUSES and not no_current_event):
                return _foreground_runtime_failure(result)
            # Runtime owns the CodeBuddy foreground presentation budget.
            # A created receipt is not permission to render: the attempt
            # counter may have failed to persist or already be exhausted.
            # Trust only its explicit marker, including installed paths
            # whose host is inferred rather than passed with --ide.
            # Other hosts retain their existing created-receipt contract.
            invoke_marker = None
            notice = result.get("notice") if isinstance(result, dict) else None
            if (args.ide or _ambient_ide()) == "codebuddy":
                if result.get("marker") == _CONTINUATION_MARKERS.get("notice_required"):
                    invoke_marker = _CONTINUATION_MARKERS.get("notice_required")
            elif isinstance(notice, dict) and notice.get("status") == "created":
                invoke_marker = _CONTINUATION_MARKERS.get("notice_required")
            if debug:
                # Preserve the legacy single JSON debug record; production
                # callers (without --debug) receive the exact marker stdout.
                if invoke_marker:
                    result["reporting_marker"] = invoke_marker
                    if foreground_ide == "codebuddy":
                        _, body = _codebuddy_notice_text(result)
                        if body is not None:
                            result["notice_text"] = body
            elif isinstance(result, dict) and result.get("marker") == "TRTC_REPORTING_ROOT_INVOKE_REJECTED_V1":
                print("TRTC_REPORTING_ROOT_INVOKE_REJECTED_V1")
            elif invoke_marker:
                _emit_foreground_marker(result, invoke_marker, foreground_ide, emitted_notices)
        elif args.cmd == "preference":
            ok, result = _run_node("preference", ["--enabled", args.enabled], debug=debug)
            if not ok or result.get("status") in _RUNTIME_FAILURE_STATUSES:
                return _foreground_runtime_failure(result)
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
