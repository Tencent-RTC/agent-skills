"""Unit tests for log parsers."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

from scripts.lib.log_parsers.logcat_parser import parse_logcat
from scripts.lib.log_parsers.syslog_parser import parse_syslog
from scripts.lib.log_parsers.puppeteer_parser import parse_puppeteer_console

FIXTURES = Path(__file__).parent / "fixtures"


def test_logcat_parser():
    events = parse_logcat(str(FIXTURES / "sample_logcat.txt"))
    event_names = [e["event"] for e in events]
    assert "onLoginSuccess" in event_names
    assert "onLiveStarted" in event_names
    assert "onLiveEnded" in event_names
    assert "onUserVideoStateChanged" in event_names
    for e in events:
        assert e["platform"] == "android"


def test_syslog_parser():
    events = parse_syslog(str(FIXTURES / "sample_syslog.txt"))
    event_names = [e["event"] for e in events]
    assert "onLoginSuccess" in event_names
    assert "onLiveStarted" in event_names
    assert "onLiveEnded" in event_names
    for e in events:
        assert e["platform"] == "ios"


def test_puppeteer_parser():
    events = parse_puppeteer_console(str(FIXTURES / "sample_puppeteer_console.json"))
    event_names = [e["event"] for e in events]
    assert "onLoginSuccess" in event_names
    assert "onLiveStarted" in event_names


if __name__ == "__main__":
    test_logcat_parser()
    test_syslog_parser()
    test_puppeteer_parser()
    print("All log parser tests passed!")
