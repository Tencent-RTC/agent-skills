"""iOS syslog / simctl log stream parser."""
import json
import re
from datetime import datetime


# Pattern for simctl log stream output (subsystem-filtered)
_SIMCTL_PATTERN = re.compile(
    r"(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\.\d+).*?\s+(on\w+|error\w*)",
    re.IGNORECASE,
)

# Pattern for idevicesyslog output
_SYSLOG_PATTERN = re.compile(
    r"(\w+\s+\d+\s+\d{2}:\d{2}:\d{2}).*?(?:TRTC|liteav).*?(on\w+|error\w*)",
    re.IGNORECASE,
)


def parse_syslog(log_path: str) -> list[dict]:
    """Parse iOS syslog/simctl log and extract TRTC events."""
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
    """Try to extract an event from a single log line."""
    # Try simctl format first
    m = _SIMCTL_PATTERN.search(line)
    if m:
        return {
            "ts": m.group(1),
            "platform": "ios",
            "event": m.group(2),
            "ok": "error" not in m.group(2).lower(),
            "raw": line.strip(),
        }
    # Try idevicesyslog format
    m = _SYSLOG_PATTERN.search(line)
    if m:
        return {
            "ts": m.group(1),
            "platform": "ios",
            "event": m.group(2),
            "ok": "error" not in m.group(2).lower(),
            "raw": line.strip(),
        }
    # Also match explicit TRTC event patterns like [event:onLiveStarted]
    event_match = re.search(r"\b(on\w+)\b", line)
    if event_match and any(kw in line.lower() for kw in ["trtc", "liteav", "livecoreview", "trtcsdk"]):
        return {
            "ts": datetime.now().isoformat(),
            "platform": "ios",
            "event": event_match.group(1),
            "ok": True,
            "raw": line.strip(),
        }
    return None
