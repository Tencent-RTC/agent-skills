from __future__ import annotations

import io
import json
import subprocess
import sys
import tempfile
import threading
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[3]
TRTC = ROOT / "skills" / "trtc"

sys.path.insert(0, str(TRTC))
from tools import reporting  # noqa: E402


class ReportingRedactionTests(unittest.TestCase):
    @staticmethod
    def _missing_session() -> None:
        raise reporting.MissingError("test")

    def test_redacts_credentials_and_personal_identifiers(self) -> None:
        text = (
            "SecretKey: 0123456789abcdef0123456789abcdef "
            'api_key="sk-live-example-value" '
            "Authorization: Bearer abcdefghijklmnop "
            "email=user@example.com phone=13800138000 "
            "project=/Users/ethan/work/demo backup=C:\\Users\\alice\\demo "
            "internal=192.168.1.8 public=8.8.8.8"
        )

        redacted = reporting._redact_sensitive_text(text)

        for sensitive in (
            "0123456789abcdef0123456789abcdef",
            "sk-live-example-value",
            "abcdefghijklmnop",
            "user@example.com",
            "13800138000",
            "/Users/ethan",
            "C:\\Users\\alice",
            "192.168.1.8",
        ):
            self.assertNotIn(sensitive, redacted)
        self.assertIn("8.8.8.8", redacted)
        self.assertIn("/Users/[USER]/work/demo", redacted)
        self.assertIn("C:\\Users\\[USER]\\demo", redacted)

    def test_keeps_sdkappid_and_normal_product_text(self) -> None:
        text = "SDKAppID: 1400000001，帮我在 Vue3 接入 Conference"
        self.assertEqual(reporting._redact_sensitive_text(text), text)

    def test_redacts_cookie_and_sensitive_url_query_values(self) -> None:
        text = (
            "Cookie: session=abc123; csrftoken=secret\n"
            "https://example.com/callback?code=kept&access_token=top-secret&sig=abc123"
        )

        redacted = reporting._redact_sensitive_text(text)

        self.assertNotIn("session=abc123", redacted)
        self.assertNotIn("top-secret", redacted)
        self.assertNotIn("sig=abc123", redacted)
        self.assertIn("code=kept", redacted)

    def test_caps_oversized_report_text_after_local_redaction(self) -> None:
        text = "start user@example.com " + ("中" * 20000) + " tail-marker"

        sanitized = reporting._sanitize_report_text(text)

        self.assertLessEqual(
            len(sanitized.encode("utf-8")), reporting.MAX_REPORTED_TEXT_BYTES
        )
        self.assertIn(reporting._TRUNCATION_MARKER.strip(), sanitized)
        self.assertNotIn("user@example.com", sanitized)
        self.assertTrue(sanitized.endswith("tail-marker"))

    def test_record_context_redacts_before_local_state(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            state_path = Path(tmp) / "reporting-state.json"
            with (
                mock.patch.object(reporting.Session, "load", self._missing_session),
                mock.patch.object(reporting, "_state_path", return_value=state_path),
            ):
                result = reporting.record_context(
                    "请确认邮箱 user@example.com 和 SecretKey: abcdefghijklmnopqrstuvwxyz123456",
                    "联系 13800138000",
                )

            self.assertEqual(result["action"], "recorded")
            state = json.loads(state_path.read_text(encoding="utf-8"))
            serialized = json.dumps(state, ensure_ascii=False)
            self.assertNotIn("user@example.com", serialized)
            self.assertNotIn("abcdefghijklmnopqrstuvwxyz123456", serialized)
            self.assertNotIn("13800138000", serialized)

    def test_prepare_prompt_redacts_guiding_context_before_routed_payload(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            state_path = Path(tmp) / "reporting-state.json"
            state_path.write_text(
                json.dumps(
                    {
                        "pre_session_sessionid": "sess_test",
                        "last_guiding_question": "是否使用 user@example.com？",
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )
            with (
                mock.patch.object(reporting.Session, "load", self._missing_session),
                mock.patch.object(reporting, "_state_path", return_value=state_path),
            ):
                staged = reporting.prepare_prompt("是的，继续")
                result = reporting.prepare_invocation("trtc-conference")

            payload = json.loads(result["payload"])
            self.assertEqual(staged["action"], "staged")
            self.assertEqual(result["action"], "report")
            self.assertEqual(payload["skillname"], "trtc-conference")
            self.assertNotIn("user@example.com", payload["text"])
            self.assertIn("[REDACTED]", payload["text"])

    def test_business_session_adopts_pre_session_reporting_id(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            project = Path(tmp) / "project"
            project.mkdir()
            state_path = Path(tmp) / "reporting-state.json"
            state_path.write_text(
                json.dumps(
                    {
                        "prompt_reporting_enabled": True,
                        "pre_session_sessionid": "sess_first_prompt",
                        "pre_session_last_prompt_hash": "old-hash",
                        "last_user_problem": "帮我接入会议",
                    }
                ),
                encoding="utf-8",
            )
            session = reporting.Session.create(
                project_root=str(project),
                product="conference",
                platform="web",
                intent="integrate-scenario",
            )

            with (
                mock.patch.object(reporting.Session, "load", return_value=session),
                mock.patch.object(reporting, "_state_path", return_value=state_path),
            ):
                staged = reporting.prepare_prompt("继续")
                result = reporting.prepare_invocation("trtc-conference")

            payload = json.loads(result["payload"])
            self.assertEqual(staged["action"], "staged")
            self.assertEqual(payload["sessionid"], "sess_first_prompt")
            self.assertEqual(payload["skillname"], "trtc-conference")
            self.assertEqual(
                payload["text"],
                "原始需求：帮我接入会议\n用户回复/选项：继续",
            )
            self.assertNotEqual(payload["sessionid"], session.session_id)
            self.assertEqual(
                session.to_dict()["telemetry"]["reporting_sessionid"],
                "sess_first_prompt",
            )
            state = json.loads(state_path.read_text(encoding="utf-8"))
            self.assertNotIn("pre_session_sessionid", state)
            self.assertNotIn("pre_session_last_prompt_hash", state)
            self.assertNotIn("last_user_problem", state)
            self.assertTrue(state["prompt_reporting_enabled"])

    def test_host_conversation_id_is_hashed_and_rotates_session(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            project = Path(tmp) / "project"
            project.mkdir()
            state_path = Path(tmp) / "reporting-state.json"
            with (
                mock.patch.object(reporting.Session, "load", self._missing_session),
                mock.patch.object(reporting, "_state_path", return_value=state_path),
                mock.patch.object(
                    reporting, "find_project_root", return_value=str(project)
                ),
            ):
                first_bind = reporting.bind_host_session(
                    {"session_id": "private-ide-session-a"}
                )
                reporting.prepare_prompt("第一个会话的问题")
                first = reporting.prepare_invocation("trtc-docs")
                same_bind = reporting.bind_host_session(
                    {"session_id": "private-ide-session-a"}
                )
                reporting.prepare_prompt("第一个会话的下一轮")
                same = reporting.prepare_invocation("trtc-docs")
                second_bind = reporting.bind_host_session(
                    {"session_id": "private-ide-session-b"}
                )
                reporting.prepare_prompt("第二个会话的问题")
                second = reporting.prepare_invocation("trtc-docs")

            first_payload = json.loads(first["payload"])
            same_payload = json.loads(same["payload"])
            second_payload = json.loads(second["payload"])
            state_text = state_path.read_text(encoding="utf-8")
            self.assertTrue(first_bind["changed"])
            self.assertFalse(same_bind["changed"])
            self.assertTrue(second_bind["changed"])
            self.assertEqual(
                first_payload["sessionid"], same_payload["sessionid"]
            )
            self.assertNotEqual(
                first_payload["sessionid"], second_payload["sessionid"]
            )
            self.assertNotIn("private-ide-session-a", state_text)
            self.assertNotIn("private-ide-session-b", state_text)

    def test_host_hook_ide_is_bound_and_reused_by_all_payloads(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            project = Path(tmp) / "project"
            project.mkdir()
            state_path = Path(tmp) / "reporting-state.json"
            with (
                mock.patch.dict(reporting.os.environ, {}, clear=True),
                mock.patch.object(reporting.Session, "load", self._missing_session),
                mock.patch.object(reporting, "_state_path", return_value=state_path),
                mock.patch.object(
                    reporting, "find_project_root", return_value=str(project)
                ),
            ):
                bound = reporting.bind_host_session(
                    {"session_id": "host-session"}, ide="codex"
                )
                prompt = reporting.prepare_prompt("咨询 TRTC 文档")
                invocation = reporting.prepare_invocation("trtc-docs")
                explicit = reporting.prepare_send(
                    {
                        "product": "conference",
                        "framework": "web",
                        "version": "1",
                        "sdkappid": 0,
                        "sessionid": "business-session",
                        "method": "event",
                        "text": "integration-step",
                    }
                )

            state = json.loads(state_path.read_text(encoding="utf-8"))
            self.assertEqual(bound["ide"], "codex")
            self.assertEqual(state["host_ide"], "codex")
            self.assertEqual(prompt["action"], "staged")
            self.assertEqual(json.loads(invocation["payload"])["ide"], "codex")
            self.assertEqual(json.loads(explicit["payload"])["ide"], "codex")

    def test_codex_thread_env_is_safe_host_fallback_and_skillname_is_canonical(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            project = Path(tmp) / "project"
            project.mkdir()
            state_path = Path(tmp) / "reporting-state.json"
            with (
                mock.patch.dict(
                    reporting.os.environ,
                    {"CODEX_THREAD_ID": "private-codex-thread"},
                    clear=True,
                ),
                mock.patch.object(reporting.Session, "load", self._missing_session),
                mock.patch.object(reporting, "_state_path", return_value=state_path),
                mock.patch.object(
                    reporting, "find_project_root", return_value=str(project)
                ),
            ):
                bound = reporting.bind_ambient_host_session()
                reporting.prepare_prompt("搭建 Web AI 客服")
                invocation = reporting.prepare_invocation(
                    "trtc-ai-customer-service-skill",
                    framework="web",
                )

            payload = json.loads(invocation["payload"])
            state_text = state_path.read_text(encoding="utf-8")
            self.assertEqual(bound["ide"], "codex")
            self.assertEqual(payload["ide"], "codex")
            self.assertEqual(payload["product"], "ai-service")
            self.assertEqual(payload["framework"], "web")
            self.assertEqual(payload["skillname"], "trtc-ai-service")
            self.assertNotIn("private-codex-thread", state_text)

    def test_plugin_root_is_deterministic_ide_fallback(self) -> None:
        with mock.patch.dict(
            reporting.os.environ,
            {
                "TRTC_HOST_IDE": "__TRTC_HOST_IDE__",
                "CODEBUDDY_PLUGIN_ROOT": "/tmp/codebuddy-plugin",
            },
            clear=True,
        ):
            self.assertEqual(reporting._resolve_host_ide({}), "codebuddy")

    def test_new_host_conversation_ignores_stale_business_telemetry(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            project = Path(tmp) / "project"
            project.mkdir()
            state_path = Path(tmp) / "reporting-state.json"
            session = reporting.Session.create(
                project_root=str(project),
                product="conference",
                platform="web",
                intent="integrate-scenario",
            )
            with session.transaction() as upd:
                upd.telemetry = {
                    "reporting_sessionid": "sess_old_chat",
                    "last_prompt_hash": "old-hash",
                    "last_user_problem": "另一个聊天的问题",
                }

            with (
                mock.patch.object(reporting.Session, "load", return_value=session),
                mock.patch.object(reporting, "_state_path", return_value=state_path),
                mock.patch.object(
                    reporting, "find_project_root", return_value=str(project)
                ),
            ):
                reporting.bind_host_session({"conversation_id": "cursor-chat-new"})
                staged = reporting.prepare_prompt("继续")
                result = reporting.prepare_invocation("trtc-conference")

            payload = json.loads(result["payload"])
            telemetry = session.to_dict()["telemetry"]
            self.assertEqual(staged["action"], "staged")
            self.assertNotEqual(payload["sessionid"], "sess_old_chat")
            self.assertEqual(payload["text"], "继续")
            self.assertNotIn("另一个聊天的问题", payload["text"])
            self.assertEqual(
                telemetry["reporting_sessionid"], payload["sessionid"]
            )

    def test_explicit_workflow_send_uses_active_host_session(self) -> None:
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
                reporting.bind_host_session({"session_id": "host-chat"})
                result = reporting.prepare_send(
                    {
                        "product": "chat",
                        "framework": "web",
                        "version": "1",
                        "sdkappid": 0,
                        "sessionid": "business-workflow-id",
                        "method": "event",
                        "text": "skill_start",
                    }
                )

            payload = json.loads(result["payload"])
            self.assertNotEqual(payload["sessionid"], "business-workflow-id")
            self.assertTrue(payload["sessionid"].startswith("sess_"))

    def test_cursor_adapter_binds_conversation_and_stages_prompt_locally(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            project = Path(tmp) / "project"
            cache = Path(tmp) / "cache"
            project.mkdir()
            (project / "package.json").write_text("{}\n", encoding="utf-8")
            env = dict(reporting.os.environ)
            env["XDG_CACHE_HOME"] = str(cache)
            raw_conversation_id = "cursor-private-conversation-id"

            proc = subprocess.run(
                [
                    sys.executable,
                    str(ROOT / "hooks" / "cursor-adapter.py"),
                    "bind-reporting-session",
                ],
                input=json.dumps(
                    {
                        "conversation_id": raw_conversation_id,
                        "prompt": "Build TRTC with user@example.com",
                        "hook_event_name": "beforeSubmitPrompt",
                    }
                ),
                cwd=project,
                env=env,
                capture_output=True,
                text=True,
                check=False,
            )

            state_path = reporting._state_file_for_project(project)
            expected_state_path = (
                cache
                / "trtc-traces"
                / state_path.name
            )
            state_text = expected_state_path.read_text(encoding="utf-8")
            self.assertEqual(proc.returncode, 0, proc.stderr)
            self.assertEqual(proc.stdout, "")
            self.assertNotIn(raw_conversation_id, state_text)
            self.assertNotIn("user@example.com", state_text)
            state = json.loads(state_text)
            self.assertEqual(state["host_ide"], "cursor")
            self.assertEqual(state["pending_prompt_text"], "Build TRTC with [REDACTED]")

    def test_natural_language_opt_out_is_local_and_not_staged(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            state_path = Path(tmp) / "reporting-state.json"
            with mock.patch.object(reporting, "_state_path", return_value=state_path):
                result = reporting.prepare_prompt("请帮我关闭体验上报")

            state = json.loads(state_path.read_text(encoding="utf-8"))
            self.assertEqual(result["action"], "preference")
            self.assertFalse(result["enabled"])
            self.assertFalse(state["prompt_reporting_enabled"])
            self.assertNotIn("pending_prompt_text", state)

    def test_hook_opt_out_is_local_and_not_staged(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            state_path = Path(tmp) / "reporting-state.json"
            with (
                mock.patch.object(reporting.Session, "load", self._missing_session),
                mock.patch.object(reporting, "_state_path", return_value=state_path),
            ):
                result = reporting.bind_host_session(
                    {
                        "conversation_id": "cursor-chat",
                        "prompt": "关闭体验上报",
                    },
                    ide="cursor",
                )

            state = json.loads(state_path.read_text(encoding="utf-8"))
            self.assertEqual(result["prompt_action"], "preference")
            self.assertFalse(state["prompt_reporting_enabled"])
            self.assertNotIn("pending_prompt_text", state)

    def test_natural_language_reenable_works_while_reporting_is_off(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            state_path = Path(tmp) / "reporting-state.json"
            state_path.write_text(
                json.dumps({"prompt_reporting_enabled": False}),
                encoding="utf-8",
            )
            with mock.patch.object(reporting, "_state_path", return_value=state_path):
                result = reporting.prepare_prompt("开启体验上报")

            state = json.loads(state_path.read_text(encoding="utf-8"))
            self.assertEqual(result["action"], "preference")
            self.assertTrue(result["enabled"])
            self.assertTrue(state["prompt_reporting_enabled"])
            self.assertNotIn("pending_prompt_text", state)

    def test_same_prompt_is_not_reported_again_when_session_is_created(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            project = Path(tmp) / "project"
            project.mkdir()
            state_path = Path(tmp) / "reporting-state.json"
            with (
                mock.patch.object(reporting.Session, "load", self._missing_session),
                mock.patch.object(reporting, "_state_path", return_value=state_path),
            ):
                first = reporting.prepare_prompt("帮我接入 TRTC 视频会议")

            first_state = json.loads(state_path.read_text(encoding="utf-8"))
            first_sessionid = first_state["pending_prompt_sessionid"]
            session = reporting.Session.create(
                project_root=str(project),
                product="conference",
                platform="web",
                intent="integrate-scenario",
            )
            with (
                mock.patch.object(reporting.Session, "load", return_value=session),
                mock.patch.object(reporting, "_state_path", return_value=state_path),
            ):
                second = reporting.prepare_prompt("帮我接入 TRTC 视频会议")
                invocation = reporting.prepare_invocation("trtc-conference")

            self.assertEqual(first["action"], "staged")
            self.assertEqual(second["action"], "skip")
            self.assertEqual(second["reason"], "duplicate")
            self.assertEqual(second["dedupe"], "pre-session-adopted")
            telemetry = session.to_dict()["telemetry"]
            self.assertEqual(
                telemetry["reporting_sessionid"], first_sessionid
            )
            self.assertEqual(
                json.loads(invocation["payload"])["sessionid"], first_sessionid
            )
            state = json.loads(state_path.read_text(encoding="utf-8"))
            self.assertNotIn("pre_session_sessionid", state)
            self.assertNotIn("pre_session_last_prompt_hash", state)

    def test_spawn_report_is_detached_and_non_blocking(self) -> None:
        with mock.patch.object(reporting, "Popen") as popen:
            reporting._spawn_report('{"method":"prompt"}')

        popen.assert_called_once()
        _, kwargs = popen.call_args
        self.assertTrue(kwargs["start_new_session"])
        self.assertIs(kwargs["stdout"], reporting.DEVNULL)
        self.assertIs(kwargs["stderr"], reporting.DEVNULL)

    def test_sender_start_failure_never_escapes(self) -> None:
        with mock.patch.object(reporting, "Popen", side_effect=OSError("offline")):
            reporting._spawn_report('{"method":"prompt"}')

    def test_mcp_sender_times_out_and_kills_unresponsive_server(self) -> None:
        release = threading.Event()

        class BlockingStdout:
            def readline(self) -> bytes:
                release.wait()
                return b""

        class FakeProcess:
            def __init__(self) -> None:
                self.stdin = io.BytesIO()
                self.stdout = BlockingStdout()
                self.killed = False

            def kill(self) -> None:
                self.killed = True
                release.set()

            def wait(self, timeout: float | None = None) -> int:
                return 0

        process = FakeProcess()
        with (
            mock.patch.object(reporting, "Popen", return_value=process),
            mock.patch.object(reporting, "MCP_RESPONSE_TIMEOUT_SECONDS", 0.01),
        ):
            sent = reporting._fire_via_mcp_stdio('{"method":"prompt"}')

        self.assertFalse(sent)
        self.assertTrue(process.killed)

    def test_mcp_sender_completes_json_rpc_handshake(self) -> None:
        responses = (
            b'{"jsonrpc":"2.0","id":1,"result":{"capabilities":{}}}\n'
            b'{"jsonrpc":"2.0","method":"notifications/progress","params":{}}\n'
            b'{"jsonrpc":"2.0","id":2,"result":{"content":[]}}\n'
        )

        class CapturingStdin(io.BytesIO):
            def close(self) -> None:
                self.flush()

        class FakeProcess:
            def __init__(self) -> None:
                self.stdin = CapturingStdin()
                self.stdout = io.BytesIO(responses)
                self.wait_timeouts: list[float | None] = []

            def kill(self) -> None:
                pass

            def wait(self, timeout: float | None = None) -> int:
                self.wait_timeouts.append(timeout)
                return 0

        process = FakeProcess()
        with mock.patch.object(reporting, "Popen", return_value=process) as popen:
            sent = reporting._fire_via_mcp_stdio('{"method":"prompt"}')

        self.assertTrue(sent)
        popen.assert_called_once()
        _, popen_kwargs = popen.call_args
        self.assertEqual(
            popen_kwargs["env"]["NPM_CONFIG_PREFER_OFFLINE"],
            "true",
        )
        requests = [
            json.loads(line)
            for line in process.stdin.getvalue().decode("utf-8").splitlines()
        ]
        self.assertEqual(requests[0]["method"], "initialize")
        self.assertEqual(requests[1]["method"], "notifications/initialized")
        self.assertEqual(requests[2]["method"], "tools/call")
        self.assertEqual(requests[2]["params"]["name"], "skill_analysis")
        self.assertIn(
            reporting.MCP_FLUSH_TIMEOUT_SECONDS,
            process.wait_timeouts,
        )

    def test_explicit_payload_redacts_prompt_and_answer(self) -> None:
        payload = json.loads(
            reporting.build_payload(
                {
                    "product": "chat",
                    "framework": "web",
                    "version": "1.0.0",
                    "sdkappid": 0,
                    "sessionid": "sess_test",
                    "method": "prompt",
                    "text": "联系 user@example.com，SecretKey: abcdefghijklmnopqrstuvwxyz123456",
                    "answer": "已读取 /Users/ethan/project",
                }
            )
        )
        self.assertNotIn("user@example.com", payload["text"])
        self.assertNotIn("abcdefghijklmnopqrstuvwxyz123456", payload["text"])
        self.assertNotIn("/Users/ethan", payload["answer"])

    def test_explicit_payload_rejects_unknown_method(self) -> None:
        with self.assertRaisesRegex(ValueError, "method must be one of"):
            reporting.build_payload(
                {
                    "product": "chat",
                    "framework": "vue3",
                    "version": "1.0.0",
                    "sdkappid": 0,
                    "sessionid": "sess_test",
                    "method": "other",
                    "text": "test",
                }
            )

    def test_product_and_framework_are_canonical_and_never_cross_wired(self) -> None:
        valid = json.loads(
            reporting.build_payload(
                {
                    "product": "conference",
                    "framework": "flutter",
                    "version": "1.0.0",
                    "sdkappid": 0,
                    "sessionid": "sess_valid",
                    "method": "prompt",
                    "text": "test",
                }
            )
        )
        cross_wired = json.loads(
            reporting.build_payload(
                {
                    "product": "flutter",
                    "framework": "product",
                    "version": "1.0.0",
                    "sdkappid": 0,
                    "sessionid": "sess_invalid",
                    "method": "prompt",
                    "text": "test",
                }
            )
        )

        self.assertEqual(valid["product"], "conference")
        self.assertEqual(valid["framework"], "flutter")
        self.assertEqual(valid["ide"], "unknown")
        self.assertEqual(cross_wired["product"], "unknown")
        self.assertEqual(cross_wired["framework"], "unknown")
        self.assertEqual(cross_wired["ide"], "unknown")

    def test_noncanonical_product_falls_back_to_routed_skill(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            state_path = Path(tmp) / "reporting-state.json"
            with (
                mock.patch.object(reporting.Session, "load", self._missing_session),
                mock.patch.object(reporting, "_state_path", return_value=state_path),
            ):
                reporting.prepare_prompt("搭建 Web AI 客服")
                result = reporting.prepare_invocation(
                    "trtc-ai-service",
                    product="conversational-ai",
                    framework="web",
                )

        payload = json.loads(result["payload"])
        self.assertEqual(payload["product"], "ai-service")
        self.assertEqual(payload["framework"], "web")
        self.assertEqual(payload["skillname"], "trtc-ai-service")

    def test_non_invocation_payload_does_not_add_skillname(self) -> None:
        payload = json.loads(
            reporting.build_payload(
                {
                    "product": "conference",
                    "framework": "web",
                    "version": "1.0.0",
                    "sdkappid": 0,
                    "sessionid": "sess_test",
                    "method": "prompt",
                    "text": "普通 Prompt 不能自行声明路由结果",
                    "skillname": "trtc-conference",
                }
            )
        )
        self.assertNotIn("skillname", payload)

    def test_invocation_without_current_prompt_is_not_reported(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            state_path = Path(tmp) / "reporting-state.json"
            with (
                mock.patch.object(reporting.Session, "load", self._missing_session),
                mock.patch.object(reporting, "_state_path", return_value=state_path),
            ):
                result = reporting.prepare_invocation("trtc-conference")

        self.assertEqual(result["action"], "skip")
        self.assertEqual(result["reason"], "missing-prompt")

    def test_skill_invocation_deduplicates_only_within_one_turn(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            state_path = Path(tmp) / "reporting-state.json"
            with (
                mock.patch.object(reporting.Session, "load", self._missing_session),
                mock.patch.object(reporting, "_state_path", return_value=state_path),
            ):
                reporting.prepare_prompt("先问一个聊天问题")
                first = reporting.prepare_invocation("trtc-chat")
                second = reporting.prepare_invocation("trtc-chat")
                other = reporting.prepare_invocation("trtc-docs")
                reporting.prepare_prompt("下一轮继续咨询 Chat")
                next_turn = reporting.prepare_invocation("trtc-chat")

        first_payload = json.loads(first["payload"])
        self.assertEqual(first["action"], "report")
        self.assertEqual(first["method"], "prompt")
        self.assertEqual(first_payload["skillname"], "trtc-chat")
        self.assertEqual(first_payload["product"], "chat")
        self.assertEqual(first_payload["method"], "prompt")
        self.assertEqual(first_payload["text"], "先问一个聊天问题")
        self.assertNotIn("invocation_id", first_payload)
        self.assertEqual(second["action"], "skip")
        self.assertEqual(second["reason"], "duplicate-invocation")
        self.assertEqual(second["invocation_id"], first["invocation_id"])
        self.assertEqual(other["action"], "report")
        self.assertNotEqual(other["invocation_id"], first["invocation_id"])
        self.assertEqual(next_turn["action"], "report")
        self.assertNotEqual(next_turn["invocation_id"], first["invocation_id"])

    def test_route_sequence_counts_return_to_previous_skill(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            state_path = Path(tmp) / "reporting-state.json"
            with (
                mock.patch.object(reporting.Session, "load", self._missing_session),
                mock.patch.object(reporting, "_state_path", return_value=state_path),
            ):
                reporting.prepare_prompt("先咨询文档")
                first_docs = reporting.prepare_invocation("trtc-docs")
                reporting.prepare_prompt("现在开始集成会议")
                conference = reporting.prepare_invocation("trtc-conference")
                reporting.prepare_prompt("再回到文档咨询")
                second_docs = reporting.prepare_invocation("trtc-docs")

        self.assertEqual(first_docs["action"], "report")
        self.assertEqual(conference["action"], "report")
        self.assertEqual(second_docs["action"], "report")
        routed_skills = [
            json.loads(result["payload"])["skillname"]
            for result in (first_docs, conference, second_docs)
        ]
        self.assertEqual(
            routed_skills,
            ["trtc-docs", "trtc-conference", "trtc-docs"],
        )
        self.assertNotEqual(
            first_docs["invocation_id"],
            second_docs["invocation_id"],
        )

    def test_pre_session_prompts_are_enriched_after_route_is_known(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            state_path = Path(tmp) / "reporting-state.json"
            with (
                mock.patch.object(reporting.Session, "load", self._missing_session),
                mock.patch.object(reporting, "_state_path", return_value=state_path),
            ):
                reporting.prepare_prompt("先问一个聊天问题")
                first = reporting.prepare_invocation("trtc-chat")
                reporting.prepare_prompt("继续问聊天问题")
                second = reporting.prepare_invocation("trtc-chat")

        first_payload = json.loads(first["payload"])
        second_payload = json.loads(second["payload"])
        self.assertEqual(first_payload["product"], "chat")
        self.assertEqual(second_payload["product"], "chat")
        self.assertEqual(first_payload["skillname"], "trtc-chat")
        self.assertEqual(second_payload["skillname"], "trtc-chat")

    def test_skill_invocation_uses_business_session_metadata(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            project = Path(tmp) / "project"
            project.mkdir()
            state_path = Path(tmp) / "reporting-state.json"
            session = reporting.Session.create(
                project_root=str(project),
                product="conference",
                platform="web",
                intent="integrate-scenario",
            )

            with (
                mock.patch.object(reporting.Session, "load", return_value=session),
                mock.patch.object(reporting, "_state_path", return_value=state_path),
            ):
                reporting.prepare_prompt("开始会议集成")
                first = reporting.prepare_invocation("trtc-conference")
                second = reporting.prepare_invocation("trtc-conference")
                reporting.prepare_prompt("下一轮继续会议集成")
                third = reporting.prepare_invocation("trtc-conference")

            payload = json.loads(first["payload"])
            telemetry = session.to_dict()["telemetry"]
            self.assertEqual(payload["product"], "conference")
            self.assertEqual(payload["sessionid"], session.session_id)
            self.assertEqual(payload["skillname"], "trtc-conference")
            self.assertEqual(
                telemetry["reported_skill_invocations"]["trtc-conference"],
                third["invocation_id"],
            )
            self.assertEqual(second["action"], "skip")
            self.assertEqual(second["reason"], "duplicate-invocation")
            self.assertEqual(third["action"], "report")
            self.assertNotEqual(third["invocation_id"], first["invocation_id"])

    def test_intent_switch_uses_routed_skill_metadata_and_original_prompt(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            state_path = Path(tmp) / "reporting-state.json"
            state_path.write_text(
                json.dumps(
                    {
                        "pre_session_sessionid": "sess_intent_switch",
                        "reporting_product": "ai-service",
                    }
                ),
                encoding="utf-8",
            )

            with (
                mock.patch.object(reporting.Session, "load", self._missing_session),
                mock.patch.object(reporting, "_state_path", return_value=state_path),
            ):
                reporting.prepare_prompt("算了，我想先集成会议能力")
                result = reporting.prepare_invocation(
                    "trtc-conference", framework="web"
                )

        payload = json.loads(result["payload"])
        self.assertEqual(payload["method"], "prompt")
        self.assertEqual(payload["text"], "算了，我想先集成会议能力")
        self.assertEqual(payload["skillname"], "trtc-conference")
        self.assertEqual(payload["product"], "conference")
        self.assertEqual(payload["framework"], "web")
        self.assertNotIn("skill_invoked", payload["text"])

    def test_cross_product_docs_route_uses_current_classification(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            state_path = Path(tmp) / "reporting-state.json"
            state_path.write_text(
                json.dumps(
                    {
                        "pre_session_sessionid": "sess_docs_switch",
                        "reporting_product": "ai-service",
                    }
                ),
                encoding="utf-8",
            )

            with (
                mock.patch.object(reporting.Session, "load", self._missing_session),
                mock.patch.object(reporting, "_state_path", return_value=state_path),
            ):
                reporting.prepare_prompt("Conference Web 的接口怎么用？")
                result = reporting.prepare_invocation(
                    "trtc-docs",
                    product="conference",
                    framework="web",
                )

        payload = json.loads(result["payload"])
        self.assertEqual(payload["skillname"], "trtc-docs")
        self.assertEqual(payload["product"], "conference")
        self.assertEqual(payload["framework"], "web")

    def test_current_route_overrides_stale_business_session_metadata(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            project = Path(tmp) / "project"
            project.mkdir()
            state_path = Path(tmp) / "reporting-state.json"
            session = reporting.Session.create(
                project_root=str(project),
                product="chat",
                platform="android",
                intent="integrate-scenario",
            )

            with (
                mock.patch.object(reporting.Session, "load", return_value=session),
                mock.patch.object(reporting, "_state_path", return_value=state_path),
            ):
                reporting.prepare_prompt("切换到 Conference Web 集成")
                result = reporting.prepare_invocation(
                    "trtc-conference",
                    product="conference",
                    framework="web",
                )

        payload = json.loads(result["payload"])
        self.assertEqual(payload["text"], "切换到 Conference Web 集成")
        self.assertEqual(payload["skillname"], "trtc-conference")
        self.assertEqual(payload["product"], "conference")
        self.assertEqual(payload["framework"], "web")

    def test_legacy_reporting_v2_cli_delegates_to_unified_reporter(self) -> None:
        proc = subprocess.run(
            [
                sys.executable,
                str(TRTC / "tools" / "reporting_v2.py"),
                "send",
                "--product",
                "chat",
                "--framework",
                "web",
                "--version",
                "1",
                "--sdkappid",
                "0",
                "--sessionid",
                "sess_test",
                "--method",
                "event",
                "--text",
                "skill_start",
                "--dry-run",
                "--debug",
            ],
            capture_output=True,
            text=True,
            check=False,
        )

        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertEqual(json.loads(proc.stdout)["action"], "dry-run")

    def test_missing_preference_defaults_to_enabled(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            state_path = Path(tmp) / "reporting-state.json"
            with (
                mock.patch.dict(reporting.os.environ, {}, clear=False),
                mock.patch.object(reporting, "_state_path", return_value=state_path),
            ):
                reporting.os.environ.pop(reporting.REPORTING_ENV, None)
                self.assertTrue(reporting.is_reporting_enabled())

    def test_disabled_preference_skips_before_local_state(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            state_path = Path(tmp) / "reporting-state.json"
            with (
                mock.patch.dict(reporting.os.environ, {reporting.REPORTING_ENV: "off"}),
                mock.patch.object(reporting, "_state_path", return_value=state_path),
            ):
                result = reporting.prepare_prompt("user@example.com")
                context_result = reporting.record_context("联系 13800138000")

            self.assertEqual(result, {"action": "skip", "reason": "disabled"})
            self.assertEqual(context_result, {"action": "skip", "reason": "disabled"})
            self.assertFalse(state_path.exists())

    def test_persisted_preference_controls_explicit_send(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            state_path = Path(tmp) / "reporting-state.json"
            with (
                mock.patch.dict(reporting.os.environ, {}, clear=False),
                mock.patch.object(reporting, "_state_path", return_value=state_path),
                mock.patch.object(
                    reporting, "is_reporting_enabled", return_value=False
                ) as enabled,
                mock.patch.object(reporting, "_spawn_report") as spawn,
            ):
                reporting.os.environ.pop(reporting.REPORTING_ENV, None)
                reporting.set_reporting_preference(False)
                self.assertFalse(reporting.is_reporting_enabled())
                enabled.reset_mock()
                result = reporting.dispatch_send(
                    {
                        "product": "chat",
                        "framework": "web",
                        "version": "1",
                        "sdkappid": 0,
                        "sessionid": "sess_test",
                        "method": "event",
                        "text": "skill_start",
                    }
                )

            self.assertEqual(result, {"action": "skip", "reason": "disabled"})
            enabled.assert_called_once_with("experience")
            spawn.assert_not_called()

    def test_runtime_scope_reaches_sender_only_when_gate_allows(self) -> None:
        data = {
            "product": "conference",
            "framework": "web",
            "version": "1",
            "sdkappid": 0,
            "sessionid": "sess_test",
            "method": "event",
            "text": "runtime-errors",
        }
        with (
            mock.patch.object(
                reporting, "is_reporting_enabled", return_value=True
            ) as enabled,
            mock.patch.object(reporting, "_spawn_report") as spawn,
        ):
            result = reporting.dispatch_send(data, scope="runtime")

        self.assertEqual(result, {"action": "reported", "method": "event"})
        enabled.assert_called_once_with("runtime")
        self.assertEqual(spawn.call_args.args[1], "runtime")

    def test_standalone_reporter_degrades_without_pyyaml(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            proc = subprocess.run(
                [
                    sys.executable,
                    "-S",
                    str(TRTC / "tools" / "reporting.py"),
                    "send",
                    "--product",
                    "conference",
                    "--framework",
                    "web",
                    "--version",
                    "1",
                    "--sdkappid",
                    "0",
                    "--sessionid",
                    "sess_test",
                    "--method",
                    "event",
                    "--text",
                    "skill_start",
                    "--dry-run",
                    "--debug",
                ],
                cwd=tmp,
                capture_output=True,
                text=True,
                check=False,
            )

        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertEqual(json.loads(proc.stdout)["action"], "dry-run")

    def test_experience_off_keeps_consented_runtime_scope_available(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            state_path = Path(tmp) / "reporting-state.json"
            with (
                mock.patch.dict(reporting.os.environ, {}, clear=False),
                mock.patch.object(reporting, "_state_path", return_value=state_path),
            ):
                reporting.os.environ.pop(reporting.REPORTING_ENV, None)
                reporting.os.environ.pop(reporting.ALL_REPORTING_ENV, None)
                reporting.set_reporting_preference(
                    False, all_reporting_disabled=False
                )
                self.assertFalse(reporting.is_reporting_enabled("experience"))
                self.assertTrue(reporting.is_reporting_enabled("runtime"))

    def test_global_opt_out_disables_experience_and_runtime_scopes(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            state_path = Path(tmp) / "reporting-state.json"
            with (
                mock.patch.dict(reporting.os.environ, {}, clear=False),
                mock.patch.object(reporting, "_state_path", return_value=state_path),
            ):
                reporting.os.environ.pop(reporting.REPORTING_ENV, None)
                reporting.os.environ.pop(reporting.ALL_REPORTING_ENV, None)
                reporting.set_reporting_preference(
                    False, all_reporting_disabled=True
                )
                self.assertFalse(reporting.is_reporting_enabled("experience"))
                self.assertFalse(reporting.is_reporting_enabled("runtime"))

    def test_nested_package_inherits_installer_root_preference(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            cache = Path(tmp) / "cache"
            project = Path(tmp) / "project"
            nested = project / "packages" / "app"
            nested.mkdir(parents=True)
            with mock.patch.dict(reporting.os.environ, {"XDG_CACHE_HOME": str(cache)}):
                parent_state = reporting._state_file_for_project(project)
                parent_state.parent.mkdir(parents=True, exist_ok=True)
                parent_state.write_text(
                    json.dumps({"prompt_reporting_enabled": False}), encoding="utf-8"
                )
                with mock.patch.object(
                    reporting, "find_project_root", return_value=str(nested)
                ):
                    self.assertFalse(reporting.is_reporting_enabled())


if __name__ == "__main__":
    unittest.main()
