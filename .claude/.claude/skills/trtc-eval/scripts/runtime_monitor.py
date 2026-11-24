"""runtime_monitor.py — Parse runtime.log and produce dynamic evaluation.

Does NOT write trace.jsonl (orchestrator only).
Does NOT generate nonce (only reads EVAL_RUN_NONCE from env to verify presence in log).

Web-platform scoring (the path covered by Enhancement 3 + 5):
  * events_hit_ratio uses semantic token matching (puppeteer_parser.expected_event_hit).
    Each ``expected_event`` is broken into identifier tokens; a line counts as
    a hit if it contains every token AND is not flagged as an error or
    runtime-health probe.
  * health_penalty subtracts up to 0.5 based on counts of page_errors,
    unhandled_rejections, vue_warnings, and request_failures captured by
    log-bridge's ``__probe`` channel.
  * The "compile_bonus is the only contributor" loophole — where
    events_hit_ratio==0 but compile passed still yielded score=0.4 — is
    closed by halving compile_bonus when nothing matched.

iOS / Android paths are unchanged.
"""
import argparse
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from scripts.lib.eval_config import skill_root
from scripts.lib.schemas import Case, DynamicResult
from scripts.lib.log_parsers.syslog_parser import parse_syslog
from scripts.lib.log_parsers.logcat_parser import parse_logcat
from scripts.lib.log_parsers.puppeteer_parser import (
    parse_puppeteer_console,
    expected_event_hit,
)


def _get_parser(platform: str):
    parsers = {
        "ios": parse_syslog,
        "android": parse_logcat,
        "web": parse_puppeteer_console,
    }
    return parsers.get(platform, parse_syslog)


# ---------------------------------------------------------------------------
# Health-probe accounting (web only)
# ---------------------------------------------------------------------------

# Per-incident weights. Each weight is a fraction of dynamic_score.
# - page_error / unhandled_rejection are unequivocal "code blew up" signals,
#   so each one carries a hefty 0.15.
# - vue_warn and request_failed are soft signals that do NOT contribute to
#   the health penalty. Warnings are often caused by headless environment
#   differences (missing props, mock mismatches) rather than real code errors.
#   Only hard errors (page_error, unhandled_rejection) should penalize the score.
_HEALTH_WEIGHTS = {
    "page_error": 0.15,
    "unhandled_rejection": 0.15,
    "vue_warn": 0.0,
    "request_failed": 0.0,
}
_HEALTH_PENALTY_CAP = 0.5

# v2 tiered penalty table: maps unique error count → penalty amount.
_TIERED_PENALTY_TABLE = {0: 0.0, 1: 0.10, 2: 0.20, 3: 0.30}
_TIERED_PENALTY_4PLUS = 0.50

# ---------------------------------------------------------------------------
# Headless environment noise patterns (web only)
# ---------------------------------------------------------------------------
# Lines matching any of these substrings are ignored when counting
# page_error / unhandled_rejection probes. They are artefacts of
# headless Chromium + Vite dev-server, NOT real code errors.
_NOISE_PATTERNS = [
    "favicon.ico",
    "LiveListManager",
    "sso_channel.cc",
    "net::ERR_BLOCKED_BY_CSP",
    "net::ERR_FAILED",
    "DevTools",
]


def _is_noise(line: str) -> bool:
    """Return True if ``line`` matches a known headless-environment noise pattern."""
    return any(p in line for p in _NOISE_PATTERNS)


import re as _re

_STACK_FRAME_RE = _re.compile(
    r"(?:at\s+.*?\(|at\s+)"
    r"https?://[^/]+/"
    r"(?:.*?/)*"
    r"([^/:?]+)"
    r":(\d+)"
)

def _extract_source_location(stack: str | None) -> str:
    if not stack:
        return "<no-source>"
    first_any: str | None = None
    for m in _STACK_FRAME_RE.finditer(stack):
        filename = m.group(1)
        lineno = m.group(2)
        loc = f"{filename}:{lineno}"
        if first_any is None:
            first_any = loc
        if "node_modules" not in stack[max(0, m.start() - 80):m.end()]:
            return loc
    return first_any or "<no-source>"


def _extract_error_fingerprint(line: str) -> str | None:
    if '"__probe"' not in line:
        return None
    if _is_noise(line):
        return None

    is_page_error = '"page_error"' in line
    is_rejection = '"unhandled_rejection"' in line
    if not is_page_error and not is_rejection:
        return None

    try:
        obj = json.loads(line.strip())
    except (json.JSONDecodeError, ValueError):
        return None

    probe_type = obj.get("__probe", "")
    if probe_type not in ("page_error", "unhandled_rejection"):
        return None

    message: str | None = None
    stack: str | None = None

    if probe_type == "page_error":
        text = obj.get("text", "")
        message = text.replace("[pageerror] ", "", 1) if text.startswith("[pageerror] ") else text
        stack = obj.get("stack")
    elif probe_type == "unhandled_rejection":
        if "message" in obj and obj["message"]:
            message = obj["message"]
            stack = obj.get("stack")
        else:
            text = obj.get("text", "")
            if text.strip().startswith("{"):
                try:
                    inner = json.loads(text)
                    message = inner.get("message", "")
                    stack = inner.get("stack")
                except (json.JSONDecodeError, ValueError):
                    message = text

    if not message:
        return None

    source = _extract_source_location(stack)
    return f"{message}|{source}"


def _scan_health_probes(runtime_log_path: Path) -> tuple[dict[str, int], list[str], bool, set[str], int, int]:
    """Walk runtime.log once, return (counts, raw_lines, dom_has_content, fingerprints, dom_text_length, dom_interactive_elements).

    counts keys mirror _HEALTH_WEIGHTS plus aggregate names ``page_errors``,
    ``unhandled_rejections``, ``vue_warnings``, ``request_failures`` for the
    DynamicResult schema.

    raw_lines is the in-memory snapshot used by ``expected_event_hit`` so
    we don't re-read the file twice.

    dom_has_content is extracted from the ``dom_snapshot`` probe emitted by
    log-bridge.mjs — True if the rendered DOM has substantive content.
    """
    counts = {k: 0 for k in _HEALTH_WEIGHTS}
    raw_lines: list[str] = []
    dom_has_content = False
    fingerprints: set[str] = set()
    dom_text_length = 0
    dom_interactive_elements = 0
    if not runtime_log_path.exists():
        return counts, raw_lines, dom_has_content, fingerprints, dom_text_length, dom_interactive_elements

    with open(runtime_log_path, "r", encoding="utf-8", errors="replace") as f:
        for line in f:
            raw_lines.append(line)
            # Extract dom_snapshot probe
            if '"dom_snapshot"' in line and '"hasContent"' in line:
                try:
                    obj = json.loads(line.strip())
                    if obj.get("__probe") == "dom_snapshot":
                        text_len = obj.get("textLength", None)
                        dom_interactive_elements = obj.get("interactiveElements", 0)
                        if text_len is not None:
                            dom_text_length = text_len
                            dom_has_content = text_len >= 50
                        else:
                            dom_has_content = bool(obj.get("hasContent", False))
                except (json.JSONDecodeError, KeyError):
                    pass
            if '"__probe"' not in line:
                continue
            # Cheap substring extraction; full JSON parse only if substring is
            # ambiguous. For our emitter (log-bridge.mjs), __probe values are
            # always one of the four below, so substring is sufficient.
            # Skip known headless-environment noise so that, e.g.,
            # a favicon.ico 404 does not inflate page_error count.
            if _is_noise(line):
                continue
            for probe_key in counts:
                if f'"__probe":"{probe_key}"' in line:
                    counts[probe_key] += 1
                    break
            fp = _extract_error_fingerprint(line)
            if fp is not None:
                fingerprints.add(fp)
    return counts, raw_lines, dom_has_content, fingerprints, dom_text_length, dom_interactive_elements


def _compute_health_penalty(counts: dict[str, int]) -> float:
    raw = sum(counts[k] * _HEALTH_WEIGHTS[k] for k in counts)
    return min(_HEALTH_PENALTY_CAP, raw)


def _compute_health_penalty_v2(unique_error_count: int) -> float:
    """v2 tiered penalty: deduped unique errors → penalty from lookup table."""
    if unique_error_count >= 4:
        return _TIERED_PENALTY_4PLUS
    return _TIERED_PENALTY_TABLE.get(unique_error_count, 0.0)


def main() -> int:
    ap = argparse.ArgumentParser(description="Dynamic evaluation: parse runtime.log")
    ap.add_argument("--case-id", required=True)
    ap.add_argument("--run-dir", required=True)
    args = ap.parse_args()

    nonce = os.environ.get("EVAL_RUN_NONCE")
    if not nonce:
        print("ERROR: EVAL_RUN_NONCE not in env", file=sys.stderr)
        return 1

    run_dir = Path(args.run_dir).resolve()
    case_dir = run_dir / "cases" / args.case_id

    # Load case
    cases_data = json.loads((skill_root() / "tests" / "benchmark" / "cases.json").read_text())
    case_raw = next((c for c in cases_data if c["test_id"] == args.case_id), None)
    if case_raw is None:
        print(f"ERROR: case '{args.case_id}' not found", file=sys.stderr)
        return 1
    case = Case(**case_raw)

    runtime_log = case_dir / "runtime.log"
    compile_log = case_dir / "compile.log"

    # Check compile status — prefer trace.jsonl exit code (reliable),
    # fall back to text matching only when trace is unavailable.
    compile_ok = True
    compile_exit_code = 0
    trace_path = case_dir / "trace.jsonl"
    _compile_status_from_trace = False
    if trace_path.exists():
        for _line in trace_path.read_text().splitlines():
            try:
                entry = json.loads(_line)
                if entry.get("step") == "demo_build":
                    compile_exit_code = entry.get("exit_code", 0) or 0
                    compile_ok = (compile_exit_code == 0)
                    _compile_status_from_trace = True
                    break
            except (json.JSONDecodeError, KeyError):
                continue
    if not _compile_status_from_trace and compile_log.exists():
        # Fallback: text matching (less reliable — "error:" may appear in
        # comments or strings, but acceptable when trace is unavailable)
        content = compile_log.read_text(errors="replace")
        if "BUILD FAILED" in content or "error:" in content.lower():
            compile_ok = False
            compile_exit_code = 1

    # If no runtime.log, dynamic score is 0 (compile_bonus alone no longer
    # rescues a run with zero runtime evidence; see Enhancement 5).
    if not runtime_log.exists() or runtime_log.stat().st_size == 0:
        result = DynamicResult(
            test_id=case.test_id,
            compile_ok=compile_ok,
            compile_exit_code=compile_exit_code,
            events_captured=[],
            events_missing=case.expected_events[:],
            events_hit_ratio=0.0,
            nonce_seen=False,
            score=0.0,
        )
        (case_dir / "dynamic_result.json").write_text(
            json.dumps(result.model_dump(), indent=2, ensure_ascii=False)
        )
        return 0

    # ------------------------------------------------------------------
    # Web platform: semantic-token matching + health probes + DOM snapshot
    # ------------------------------------------------------------------
    if case.platform == "web":
        probe_counts, raw_lines, dom_has_content, fingerprints, dom_text_length, dom_interactive_elements = _scan_health_probes(runtime_log)

        events_captured: list[str] = []
        events_missing: list[str] = []
        for expected in case.expected_events:
            if expected_event_hit(expected, raw_lines):
                events_captured.append(expected)
            else:
                events_missing.append(expected)

        # Nonce detection — same literal probe as before
        log_content = runtime_log.read_text(errors="replace")
        nonce_seen = f"TRTC_EVAL_NONCE={nonce}" in log_content

        total_expected = len(case.expected_events)
        if total_expected > 0:
            events_hit_ratio = len(events_captured) / total_expected
        else:
            # 0/0: no expected events defined. Use DOM probe as fallback.
            # If DOM has real content (Vue component rendered), treat as
            # neutral (1.0). If DOM is empty/skeleton-only, treat as
            # uninformative (0.5) — prevents the 0/0 = automatic full score.
            events_hit_ratio = 1.0 if dom_has_content else 0.5

        # Base score (legacy formula, then enhancement 5 adjustments)
        if not compile_ok:
            base = 0.0
        else:
            base = (
                events_hit_ratio * case.weights.w_events
                + case.weights.w_compile_bonus
            )
            # Enhancement 5: when nothing matched, halve compile_bonus so the
            # 0.4-just-for-compiling floor disappears. A clean compile is
            # worth something, but not a passing dynamic score on its own.
            if events_hit_ratio == 0.0:
                base -= case.weights.w_compile_bonus * 0.5

        unique_error_count = len(fingerprints)
        health_penalty = _compute_health_penalty_v2(unique_error_count)

        # UI interaction metrics (hybrid UI-driven mode)
        ui_count = 0
        ui_success = 0
        for raw in raw_lines:
            if "[eval:ui]" in raw:
                ui_count += 1
                if "click success" in raw:
                    ui_success += 1
        ui_driven_ratio = ui_success / ui_count if ui_count > 0 else 0.0

        # UI-driven bonus: reward AI code that produces clickable UI elements
        ui_bonus = 0.05 if ui_driven_ratio > 0.5 else 0.0
        dynamic_score = min(1.0, max(0.0, base - health_penalty + ui_bonus))

        result = DynamicResult(
            test_id=case.test_id,
            compile_ok=compile_ok,
            compile_exit_code=compile_exit_code,
            events_captured=events_captured,
            events_missing=events_missing,
            events_hit_ratio=round(events_hit_ratio, 4),
            nonce_seen=nonce_seen,
            score=round(dynamic_score, 4),
            page_errors=probe_counts["page_error"],
            unhandled_rejections=probe_counts["unhandled_rejection"],
            vue_warnings=probe_counts["vue_warn"],
            request_failures=probe_counts["request_failed"],
            health_penalty=round(health_penalty, 4),
            dom_has_content=dom_has_content,
            unique_error_count=unique_error_count,
            error_fingerprints=sorted(fingerprints),
            dom_text_length=dom_text_length,
            dom_interactive_elements=dom_interactive_elements,
            ui_interaction_count=ui_count,
            ui_interaction_success=ui_success,
            ui_driven_ratio=round(ui_driven_ratio, 4),
        )
        (case_dir / "dynamic_result.json").write_text(
            json.dumps(result.model_dump(), indent=2, ensure_ascii=False)
        )
        return 0

    # ------------------------------------------------------------------
    # iOS / Android / other: unchanged legacy path
    # ------------------------------------------------------------------
    parser = _get_parser(case.platform)
    events = parser(str(runtime_log))
    captured_event_names = {e["event"] for e in events}

    log_content = runtime_log.read_text(errors="replace")
    nonce_marker = f"TRTC_EVAL_NONCE={nonce}"
    nonce_seen = nonce_marker in log_content

    events_captured = [e for e in case.expected_events if e in captured_event_names]
    events_missing = [e for e in case.expected_events if e not in captured_event_names]

    total_expected = len(case.expected_events)
    events_hit_ratio = len(events_captured) / total_expected if total_expected > 0 else 1.0

    if not compile_ok:
        dynamic_score = 0.0
    else:
        dynamic_score = (
            events_hit_ratio * case.weights.w_events
            + (1.0 if compile_ok else 0.0) * case.weights.w_compile_bonus
        )

    result = DynamicResult(
        test_id=case.test_id,
        compile_ok=compile_ok,
        compile_exit_code=compile_exit_code,
        events_captured=events_captured,
        events_missing=events_missing,
        events_hit_ratio=round(events_hit_ratio, 4),
        nonce_seen=nonce_seen,
        score=round(dynamic_score, 4),
    )
    (case_dir / "dynamic_result.json").write_text(
        json.dumps(result.model_dump(), indent=2, ensure_ascii=False)
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
