"""Puppeteer / browser console log parser for Web platform.

Two responsibilities:
  1. ``parse_puppeteer_console`` — line-by-line extraction of events for the
     legacy event-name matcher (preserved unchanged for backwards compat).
  2. ``native_event_to_web_tokens`` + ``expected_event_hit`` — semantic token
     matcher used by runtime_monitor on the web platform. ``cases.json``
     ``expected_events`` are written in iOS/Android C++ log format (e.g.
     ``[account_manager.cc:46] |Login|login``); this matcher extracts the
     identifier tokens (``Login``, ``login``) and matches a captured line if
     it contains ALL the tokens. Lines tagged with ``__probe`` (page errors,
     vue warnings, request failures) are excluded from positive matches —
     they participate in dynamic_health, not events_hit_ratio.
"""
import json
import re
from datetime import datetime


# ---------------------------------------------------------------------------
# Public: legacy line parser (used by tests and any caller that just wants
# a pre-extracted event stream).
# ---------------------------------------------------------------------------

def parse_puppeteer_console(log_path: str) -> list[dict]:
    """Parse Web runtime.log (console output captured by log-bridge or Puppeteer)."""
    events: list[dict] = []
    try:
        with open(log_path, "r", encoding="utf-8", errors="replace") as f:
            for line in f:
                event = _parse_line(line)
                if event:
                    events.append(event)
    except FileNotFoundError:
        pass
    return events


def _parse_line(line: str) -> dict | None:
    """Extract event from a console log line."""
    # Try JSON format (CDP message)
    line_stripped = line.strip()
    if line_stripped.startswith("{"):
        try:
            obj = json.loads(line_stripped)
            if "event" in obj:
                return {
                    "ts": obj.get("ts", datetime.now().isoformat()),
                    "platform": "web",
                    "event": obj["event"],
                    "ok": obj.get("ok", True),
                    "raw": line_stripped,
                }
        except json.JSONDecodeError:
            pass

    # Try plain text with event pattern
    event_match = re.search(r"\b(on\w+)\b", line)
    if event_match and any(kw in line.lower() for kw in ["trtc", "liteav", "livecoreview"]):
        return {
            "ts": datetime.now().isoformat(),
            "platform": "web",
            "event": event_match.group(1),
            "ok": "error" not in line.lower(),
            "raw": line_stripped,
        }
    return None


# ---------------------------------------------------------------------------
# Semantic token matcher
# ---------------------------------------------------------------------------

# Reserved identifier tokens that show up everywhere in cpp log lines but
# carry no semantic value for matching. Excluding them prevents false positives
# (e.g. "operation" matching every log line about an SDK operation).
_TOKEN_NOISE = {
    "TRTC", "Login", "login",  # leave Login/login in noise? NO — they're
                                # the actual identity of the account_manager
                                # event. Keep them in.
}
# Actually: the noise list intentionally stays empty. The point of token
# matching is "the line contains these exact identifiers"; 'Login' is what
# distinguishes the login event from createRoom. Leaving it noisy was a
# misread of the design — reset to explicit empty.
_TOKEN_NOISE = set()  # noqa: PLW0128 — explicit reset, keeps history readable


_FILE_PREFIX_RE = re.compile(r"^\[[^\]]+\]\s*")
_TOKEN_SPLITTER = re.compile(r"[\s|]+")
_VALID_TOKEN_RE = re.compile(r"^[A-Za-z_][\w]*$")


def native_event_to_web_tokens(expected: str) -> set[str]:
    """Convert a native-format expected_event into a set of identifier tokens.

    Examples (each yields the listed token set):

        "[account_manager.cc:46] |Login|login"
            → {"Login", "login"}
        "[account_manager.cc:77] onLoginSuccess"
            → {"onLoginSuccess"}
        "[room_pipeline.cc:205] createRoom"
            → {"createRoom"}
        "[room_operation_handler.cc:685] |LeaveTRTCRoom|reason:LeaveRoom"
            → {"LeaveTRTCRoom", "LeaveRoom"}
        "[room_pipeline.cc:330] openLocalCamera"
            → {"openLocalCamera"}
        "[user_manager.cc:99] |GetUserList"
            → {"GetUserList"}

    Rules:
      1. Strip the leading ``[file.cc:N]`` prefix.
      2. Split on whitespace / pipe.
      3. For each segment, if it contains ``key:value`` keep the value side.
      4. Keep tokens that look like identifiers (start with letter/underscore,
         followed by word chars) and are at least 3 chars long.
    """
    s = _FILE_PREFIX_RE.sub("", expected)
    tokens: set[str] = set()
    for seg in _TOKEN_SPLITTER.split(s):
        if not seg:
            continue
        if ":" in seg:
            seg = seg.split(":", 1)[1]
        if len(seg) >= 3 and _VALID_TOKEN_RE.match(seg) and seg not in _TOKEN_NOISE:
            tokens.add(seg)
    return tokens


def expected_event_hit(expected: str, console_lines: list[str]) -> bool:
    """Return True if any non-error console line contains ALL tokens of ``expected``.

    Supports two formats:

    1. **New format** — ``[eval] step: xxx`` / ``[eval] done`` / ``[eval] fatal: ...``
       Exact substring match against raw log lines. Designed so test-case
       authors only need to know *what steps the AI should execute*, not
       SDK internal log formats.

    2. **Legacy format** — native C++ log tokens (e.g.
       ``[room_pipeline.cc:205] createRoom``).  Semantic token matching:
       each ``expected_event`` is broken into identifier tokens; a line
       counts as a hit if it contains every token AND is not flagged as an
       error or runtime-health probe.

    Lines tagged with ``__probe`` (page errors, vue warnings, request fails)
    are excluded from positive matches: those signals are about runtime
    health, not about successful SDK calls.
    """
    # ---- New format: [eval] prefix → exact substring match ----
    if expected.startswith("[eval]"):
        for raw in console_lines:
            if not raw or '"__probe"' in raw:
                continue
            if expected in raw:
                return True
        return False

    # ---- Legacy format: semantic token matching ----
    tokens = native_event_to_web_tokens(expected)
    if not tokens:
        return False
    for raw in console_lines:
        if not raw or '"__probe"' in raw:
            continue
        # Skip lines explicitly tagged as errors at the JSON level. Doing this
        # by string match instead of full JSON parse keeps the hot path fast
        # and tolerates malformed lines.
        if '"level":"error"' in raw:
            continue
        if all(t in raw for t in tokens):
            return True
    return False


__all__ = [
    "parse_puppeteer_console",
    "native_event_to_web_tokens",
    "expected_event_hit",
]
