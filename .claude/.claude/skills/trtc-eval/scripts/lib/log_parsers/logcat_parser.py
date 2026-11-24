"""Android logcat parser."""
import re
from datetime import datetime


# logcat format: MM-DD HH:MM:SS.mmm PID TID Level Tag: message
_LOGCAT_PATTERN = re.compile(
    r"(\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\.\d+)\s+\d+\s+\d+\s+\w\s+(\w+)\s*:\s*(.*)"
)


def parse_logcat(log_path: str) -> list[dict]:
    """Parse Android logcat output and extract TRTC events."""
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
    """Extract event from a logcat line."""
    m = _LOGCAT_PATTERN.match(line)
    if m:
        ts, tag, msg = m.group(1), m.group(2), m.group(3)
        if tag in ("TRTCSDK", "LiveCore"):
            event_match = re.search(r"\b(on\w+)\b", msg)
            if event_match:
                return {
                    "ts": ts,
                    "platform": "android",
                    "event": event_match.group(1),
                    "ok": "error" not in msg.lower(),
                    "raw": line.strip(),
                }
    # Fallback: line contains TRTC keywords
    if any(kw in line for kw in ["TRTCSDK", "LiveCore"]):
        event_match = re.search(r"\b(on\w+)\b", line)
        if event_match:
            return {
                "ts": datetime.now().isoformat(),
                "platform": "android",
                "event": event_match.group(1),
                "ok": True,
                "raw": line.strip(),
            }
    return None
