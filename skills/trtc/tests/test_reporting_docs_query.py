from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import textwrap
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[3]
TRTC = ROOT / "skills" / "trtc"
CHAT = ROOT / "skills" / "trtc-chat"

sys.path.insert(0, str(TRTC / "tools"))
import reporting  # noqa: E402


class ReportingDocsQueryTests(unittest.TestCase):
    def test_framework_uses_platform_and_never_document_type(self) -> None:
        self.assertEqual(
            reporting.derive_framework_from_docs_query("android+ios", ["sdk"]),
            "android+ios",
        )
        self.assertEqual(
            reporting.derive_framework_from_docs_query("web", ["uikit"]), "web"
        )
        self.assertEqual(
            reporting.derive_framework_from_docs_query("flutter", ["product"]),
            "flutter",
        )
        self.assertEqual(
            reporting.derive_framework_from_docs_query(
                "", ["restapi", "webhook"]
            ),
            "unknown",
        )

    def test_prompt_payload_does_not_claim_a_skill_invocation(self) -> None:
        dq = {
            "sessionId": "sess_test_1",
            "sdkappid": 1400000001,
            "platform": "web",
            "types": ["sdk"],
            "lastPrompt": "how to login",
            "lastAnswer": "Use login API.\n\n---\n\n反馈引导",
        }
        payload = reporting.payload_from_docs_query(dq, method="prompt")
        normalized = json.loads(reporting.build_payload(payload))
        self.assertEqual(payload["product"], "chat")
        self.assertNotIn("skillname", payload)
        self.assertEqual(payload["framework"], "web")
        self.assertEqual(normalized["product"], "chat")
        self.assertEqual(normalized["framework"], "web")
        self.assertEqual(payload["method"], "prompt")
        self.assertEqual(payload["text"], "how to login")
        self.assertEqual(payload["answer"], dq["lastAnswer"])
        self.assertEqual(payload["sessionid"], "sess_test_1")
        self.assertEqual(payload["sdkappid"], 1400000001)

    def test_document_type_never_overwrites_framework_in_final_payload(self) -> None:
        dq = {
            "sessionId": "sess_test_2",
            "sdkappid": 0,
            "platform": "flutter",
            "types": ["product"],
            "lastPrompt": "how to login",
            "lastAnswer": "Use login API.",
        }

        payload = json.loads(
            reporting.build_payload(
                reporting.payload_from_docs_query(dq, method="prompt")
            )
        )

        self.assertEqual(payload["product"], "chat")
        self.assertEqual(payload["framework"], "flutter")

    def test_docs_query_uses_active_host_session_over_persistent_yaml_id(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            project = Path(tmp) / "project"
            project.mkdir()
            state_path = Path(tmp) / "reporting-state.json"
            with (
                mock.patch.object(reporting, "_state_path", return_value=state_path),
                mock.patch.object(
                    reporting, "find_project_root", return_value=str(project)
                ),
            ):
                reporting.bind_host_session({"session_id": "new-ide-chat"})
                payload = reporting.payload_from_docs_query(
                    {
                        "sessionId": "stale-path-d-id",
                        "sdkappid": 0,
                        "platform": "web",
                        "types": ["sdk"],
                        "lastPrompt": "question",
                        "lastAnswer": "answer",
                    },
                    method="prompt",
                    sessionid_override=reporting._active_host_sessionid(
                        reporting._load_state()
                    ),
                )

            self.assertNotEqual(payload["sessionid"], "stale-path-d-id")
            self.assertTrue(payload["sessionid"].startswith("sess_"))

    def test_build_payload_redacts_prompt_and_answer(self) -> None:
        payload = json.loads(
            reporting.build_payload(
                {
                    "product": "chat",
                    "framework": "web",
                    "version": "1.0.0",
                    "sdkappid": 0,
                    "sessionid": "sess_test",
                    "method": "prompt",
                    "text": (
                        "联系 user@example.com，SecretKey: "
                        "abcdefghijklmnopqrstuvwxyz123456"
                    ),
                    "answer": "已读取 /Users/ethan/project",
                }
            )
        )
        self.assertNotIn("user@example.com", payload["text"])
        self.assertNotIn("abcdefghijklmnopqrstuvwxyz123456", payload["text"])
        self.assertNotIn("/Users/ethan", payload["answer"])

    def test_feedback_payload(self) -> None:
        payload = reporting.payload_from_docs_query(
            {
                "sessionId": "sess_test_1",
                "sdkappid": 0,
                "platform": "",
                "types": ["product"],
                "lastPrompt": "pricing?",
                "lastAnswer": "old answer",
            },
            method="feedback",
            feedback="1",
        )
        self.assertEqual(payload["method"], "feedback")
        self.assertEqual(payload["text"], "pricing?")
        self.assertEqual(payload["feedback"], "1")
        self.assertNotIn("answer", payload)

    def test_prompt_requires_last_answer(self) -> None:
        with self.assertRaisesRegex(ValueError, "lastAnswer"):
            reporting.payload_from_docs_query(
                {
                    "sessionId": "s",
                    "lastPrompt": "q",
                    "lastAnswer": "",
                    "types": [],
                    "platform": "",
                },
                method="prompt",
            )

    def test_method_aliases_and_event_payload(self) -> None:
        self.assertEqual(reporting.resolve_report_method("p"), "prompt")
        self.assertEqual(reporting.resolve_report_method("e"), "event")
        self.assertEqual(reporting.resolve_report_method("f"), "feedback")
        payload = reporting.payload_from_docs_query(
            {
                "sessionId": "sess_test_1",
                "sdkappid": 0,
                "platform": "web",
                "types": ["sdk"],
                "lastPrompt": "ignored",
                "lastAnswer": "",
            },
            method="event",
            text="skill_start|path=D",
        )
        self.assertEqual(payload["method"], "event")
        self.assertEqual(payload["text"], "skill_start|path=D")

    def test_send_query_and_legacy_alias_cli(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            dq_path = Path(tmp) / ".docs-query.yaml"
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
            common = [
                sys.executable,
                str(TRTC / "tools" / "reporting.py"),
            ]
            current = subprocess.run(
                common
                + [
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
            legacy = subprocess.run(
                common
                + [
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

        self.assertEqual(current.returncode, 0, current.stderr)
        data = json.loads(current.stdout)
        self.assertEqual(data["action"], "dry-run")
        inner = json.loads(data["payload"])
        self.assertEqual(inner["method"], "prompt")
        self.assertEqual(inner["text"], "user question")
        self.assertIn("answer body", inner["answer"])
        self.assertEqual(legacy.returncode, 0, legacy.stderr)

    def test_finds_chat_docs_query_and_template_has_answer(self) -> None:
        self.assertEqual(
            reporting.find_docs_query_yaml(),
            (CHAT / ".docs-query.yaml").resolve(),
        )
        self.assertIn(
            "lastAnswer:",
            (CHAT / ".docs-query.yaml").read_text(encoding="utf-8"),
        )


if __name__ == "__main__":
    unittest.main()
