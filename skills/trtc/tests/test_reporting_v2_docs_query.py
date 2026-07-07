from __future__ import annotations

import json
import subprocess
import sys
import textwrap
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[3]
TRTC = ROOT / "skills" / "trtc"
CHAT = ROOT / "skills" / "trtc-chat"

sys.path.insert(0, str(TRTC / "tools"))
import reporting_v2 as rv2  # noqa: E402


def test_derive_framework_sdk_uses_platform() -> None:
    assert rv2.derive_framework_from_docs_query("android+ios", ["sdk"]) == "android+ios"
    assert rv2.derive_framework_from_docs_query("web", ["uikit"]) == "web"


def test_derive_framework_non_sdk_joins_types() -> None:
    assert rv2.derive_framework_from_docs_query("", ["restapi", "webhook"]) == "restapi,webhook"


def test_payload_from_docs_query_prompt() -> None:
    dq = {
        "sessionId": "sess_test_1",
        "sdkappid": 1400000001,
        "platform": "web",
        "types": ["sdk"],
        "lastPrompt": "how to login",
        "lastAnswer": "Use login API.\n\n---\n\n反馈引导",
    }
    payload = rv2.payload_from_docs_query(dq, method="prompt")
    assert payload["product"] == "chat"
    assert payload["framework"] == "web"
    assert payload["method"] == "prompt"
    assert payload["text"] == "how to login"
    assert payload["answer"] == dq["lastAnswer"]
    assert payload["sessionid"] == "sess_test_1"
    assert payload["sdkappid"] == 1400000001


def test_payload_from_docs_query_feedback() -> None:
    dq = {
        "sessionId": "sess_test_1",
        "sdkappid": 0,
        "platform": "",
        "types": ["product"],
        "lastPrompt": "pricing?",
        "lastAnswer": "old answer",
    }
    payload = rv2.payload_from_docs_query(dq, method="feedback", feedback="1")
    assert payload["method"] == "feedback"
    assert payload["text"] == "pricing?"
    assert payload["feedback"] == "1"
    assert "answer" not in payload


def test_payload_from_docs_query_prompt_requires_last_answer() -> None:
    with pytest.raises(ValueError, match="lastAnswer"):
        rv2.payload_from_docs_query(
            {"sessionId": "s", "lastPrompt": "q", "lastAnswer": "", "types": [], "platform": ""},
            method="prompt",
        )


def test_resolve_report_method_aliases() -> None:
    assert rv2.resolve_report_method("p") == "prompt"
    assert rv2.resolve_report_method("e") == "event"
    assert rv2.resolve_report_method("f") == "feedback"


def test_payload_from_docs_query_event() -> None:
    dq = {
        "sessionId": "sess_test_1",
        "sdkappid": 0,
        "platform": "web",
        "types": ["sdk"],
        "lastPrompt": "ignored for event text field",
        "lastAnswer": "",
    }
    payload = rv2.payload_from_docs_query(
        dq, method="event", text="skill_start|path=D"
    )
    assert payload["method"] == "event"
    assert payload["text"] == "skill_start|path=D"


def test_send_query_dry_run_cli(tmp_path: Path) -> None:
    dq_path = tmp_path / ".docs-query.yaml"
    dq_path.write_text(
        textwrap.dedent(
            """\
            sessionId: sess_cli
            sessionStartedAt: 1
            platform: web
            types:
              - sdk
            sdkappid: 0
            lastPrompt: user question
            lastAnswer: |
              answer body

              ---

              footer
            """
        ),
        encoding="utf-8",
    )
    r = subprocess.run(
        [
            sys.executable,
            str(TRTC / "tools" / "reporting_v2.py"),
            "send-query",
            "--m",
            "p",
            "--docs-query",
            str(dq_path),
            "--dry-run",
            "--debug",
        ],
        cwd=TRTC,
        capture_output=True,
        text=True,
        check=False,
    )
    assert r.returncode == 0, r.stderr
    data = json.loads(r.stdout.strip())
    assert data["action"] == "dry-run"
    inner = json.loads(data["payload"])
    assert inner["method"] == "prompt"
    assert inner["text"] == "user question"
    assert "answer body" in inner["answer"]


def test_send_docs_query_legacy_alias(tmp_path: Path) -> None:
    dq_path = tmp_path / ".docs-query.yaml"
    dq_path.write_text(
        "sessionId: s1\nsdkappid: 0\nplatform: \"\"\ntypes: []\n"
        "lastPrompt: q\nlastAnswer: a\n",
        encoding="utf-8",
    )
    r = subprocess.run(
        [
            sys.executable,
            str(TRTC / "tools" / "reporting_v2.py"),
            "send-docs-query",
            "--method",
            "prompt",
            "--docs-query",
            str(dq_path),
            "--dry-run",
            "--debug",
        ],
        cwd=TRTC,
        capture_output=True,
        text=True,
        check=False,
    )
    assert r.returncode == 0, r.stderr


def test_find_docs_query_yaml_from_chat_cwd() -> None:
    found = rv2.find_docs_query_yaml()
    assert found == (CHAT / ".docs-query.yaml").resolve()


def test_chat_bundle_template_has_last_answer() -> None:
    text = (CHAT / ".docs-query.yaml").read_text(encoding="utf-8")
    assert "lastAnswer:" in text
