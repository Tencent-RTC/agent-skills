from __future__ import annotations

import re
import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
CHAT = ROOT / "skills" / "trtc-chat"
ONBOARDING = CHAT / "flows" / "onboarding.md"
SKILL = CHAT / "SKILL.md"
INDEX = ROOT / "knowledge-base" / "chat" / "web" / "index.yaml"
SLICES = ROOT / "knowledge-base" / "slices" / "chat" / "web"


def _read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def test_onboarding_forbids_direct_session_yaml_edit() -> None:
    text = _read(ONBOARDING)
    assert "不得直接编辑 `.trtc-session.yaml`" in text or "不得直接编辑" in text
    assert "write-batch" in text
    assert "state_version" in text


def test_onboarding_flow_state_recovery() -> None:
    text = _read(ONBOARDING)
    assert "flow_state.chat.phase" in text
    assert "条件" in text or "为空" in text or "null" in text


def test_no_topic_flow() -> None:
    assert not (CHAT / "flows" / "topic.md").exists()
    skill = _read(SKILL)
    assert "enter --phase topic" in skill
    assert "禁止" in skill


def test_onboarding_session_finalize() -> None:
    text = _read(ONBOARDING)
    assert '"status": "completed"' in text or "'status': 'completed'" in text or "completed" in text
    assert "write-batch" in text


def test_slice_loop_in_references() -> None:
    a = _read(CHAT / "references" / "02-path-a-script.md")
    b = _read(CHAT / "references" / "03-path-b-script.md")
    loading = _read(CHAT / "references" / "05-slice-loading.md")
    assert "A.3" in a or "slice" in a.lower()
    assert "B.4" in b or "slice" in b.lower()
    assert "index.yaml" in loading


def test_no_reopen_add_feature() -> None:
    text = _read(ONBOARDING) + _read(SKILL)
    assert "reopen-add-feature" not in text or "禁止" in text


def test_reporting_reference_exists() -> None:
    rec = CHAT / "references" / "13-reporting.md"
    assert rec.exists()
    text = _read(rec)
    assert "reporting_v2" in text
    assert "skill_recall" not in text
    assert "REPORTING.md" not in text


def test_chat_skill_requires_dispatcher_entry() -> None:
    skill = _read(SKILL)
    assert "dispatcher_bypass" in skill or "BLOCKED: dispatcher_bypass" in skill
    assert "trtc/SKILL.md" in skill
    assert "skill_recall" not in skill
    assert "Step P" not in skill


def test_index_dual_schema() -> None:
    text = _read(INDEX)
    assert "trigger-keywords" in text
    assert "chat/login-auth" in text


def test_slice_loading_uses_tools_kb() -> None:
    text = _read(CHAT / "references" / "05-slice-loading.md")
    assert "python3 -m tools.kb resolve chat/web/index.yaml" in text
    assert "CLAUDE_PLUGIN_ROOT" not in text


def _legacy_scan_paths(targets: list[Path]) -> list[Path]:
    paths: list[Path] = []
    for target in targets:
        if target.is_file():
            paths.append(target)
        elif target.is_dir():
            paths.extend(p for p in target.rglob("*") if p.is_file())
    return paths


def test_legacy_paths_absent_in_trtc_chat() -> None:
    patterns = [
        r"\.trtc-chat",
        r"config\.json",
        r"state\.json",
        r"\.helper\.yaml",
        r"slices/vue3/",
        r"chat-custom-integration",
    ]
    targets = [CHAT / "references", CHAT / "flows", CHAT / "docs", CHAT / "SKILL.md"]
    compiled = [re.compile(pat) for pat in patterns]
    for path in _legacy_scan_paths(targets):
        try:
            text = path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            continue
        for pat, regex in zip(patterns, compiled, strict=True):
            if regex.search(text):
                assert False, f"pattern {pat} found in {path}"


def test_skill_md_uses_tools_kb() -> None:
    skill = _read(SKILL)
    assert "python3 -m tools.kb resolve" in skill
    assert re.search(r"\.\./(\.\./)*knowledge-base/", skill) is None


def test_no_relative_kb_paths_in_bundle() -> None:
    targets = _legacy_scan_paths(
        [CHAT / "references", CHAT / "flows", CHAT / "docs", CHAT / "SKILL.md"]
    )
    rel_kb = re.compile(r"\.\./(\.\./)*knowledge-base/")
    for path in targets:
        try:
            text = path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            continue
        for line in text.splitlines():
            if "禁止" in line and "../knowledge-base" in line:
                continue
            assert not rel_kb.search(line), f"relative kb path in {path}: {line.strip()}"


def test_no_legacy_kb_path_patterns() -> None:
    targets = _legacy_scan_paths(
        [CHAT / "references", CHAT / "flows", CHAT / "docs", CHAT / "SKILL.md"]
    )
    forbidden = [
        re.compile(r"_base/"),
        re.compile(r"knowledge-base/knowledge-base"),
        re.compile(r"_starter/"),
        re.compile(r"~/.trtc-chat"),
    ]
    for path in targets:
        try:
            text = path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            continue
        for regex in forbidden:
            assert not regex.search(text), f"{regex.pattern} found in {path}"


def test_state_config_documents_tools_kb() -> None:
    text = _read(CHAT / "references" / "08-state-config.md")
    assert "§8.0 knowledge-base 读取（`tools.kb`" in text
    assert "python3 -m tools.kb resolve" in text
    assert "tools.kb exists" in text


def test_kb_tool_resolves_core_paths() -> None:
    trtc_root = ROOT / "skills" / "trtc"
    cases = [
        "chat/web/index.yaml",
        "chat/web/path-d-signals.yaml",
        "slices/chat/web/login-auth.md",
        "docs/chat/gen-usersig.md",
    ]
    for rel in cases:
        r = subprocess.run(
            ["python3", "-m", "tools.kb", "resolve", rel],
            cwd=trtc_root,
            capture_output=True,
            text=True,
            check=False,
        )
        assert r.returncode == 0, r.stderr
        assert Path(r.stdout.strip()) == ROOT / "knowledge-base" / rel


def test_kb_tool_works_from_trtc_chat_cwd() -> None:
    chat_root = ROOT / "skills" / "trtc-chat"
    r = subprocess.run(
        ["python3", "-m", "tools.kb", "resolve", "chat/web/index.yaml"],
        cwd=chat_root,
        capture_output=True,
        text=True,
        check=False,
    )
    assert r.returncode == 0, r.stderr
    assert Path(r.stdout.strip()) == ROOT / "knowledge-base" / "chat/web/index.yaml"
    assert (chat_root / "tools" / "kb.py").is_file()


def test_fourteen_slices() -> None:
    assert len(list(SLICES.glob("*.md"))) == 14


def test_path_d_signals_exists() -> None:
    assert (ROOT / "knowledge-base" / "chat" / "web" / "path-d-signals.yaml").exists()


def test_execution_units_exists() -> None:
    assert (CHAT / "references" / "execution-units.yaml").exists()


def test_root_skill_description_keywords_consolidated() -> None:
    text = _read(ROOT / "skills" / "trtc" / "SKILL.md")
    assert "Keywords:" in text
    for token in ("TUIKit", "REST API", "Webhook", "path-d-signals.yaml"):
        assert token in text, f"missing in trtc/SKILL.md: {token}"
    desc_block = text.split("---", 2)[1]
    assert desc_block.count("TUIKit") == 1


def test_docs_query_schema_matches_helper() -> None:
    text = _read(CHAT / ".docs-query.yaml")
    assert "framework:" not in text
    for field in (
        "sessionId:",
        "sessionStartedAt:",
        "platform:",
        "types:",
        "sdkappid:",
        "lastPrompt:",
        "lastAnswer:",
    ):
        assert field in text


def test_path_d3_one_step_sdkappid_prompt() -> None:
    path_d = _read(CHAT / "references" / "05-path-d-script.md")
    assert "D.3 — SDKAppID 询问（一步交互）" in path_d
    assert "您可以直接输入数字，或选择跳过" in path_d
    assert "填写 SDKAppID（直接在输入框输入数字）" in path_d
    assert "当前消息内容即为 SDKAppID" in path_d
    assert "必须原文输出以下话术" not in path_d
    assert "禁止两步流程" in path_d or "禁止两步" in path_d


def test_path_d_send_docs_query_reporting() -> None:
    reporting = _read(CHAT / "references" / "13-reporting.md")
    path_d = _read(CHAT / "references" / "05-path-d-script.md")
    assert "send-query" in reporting
    assert "send-query --m p" in path_d
    assert "send-query --m f" in path_d
    assert "lastAnswer" in path_d
    assert "--m p" in reporting


def test_path_d_platform_detection_rules() -> None:
    text = _read(CHAT / "references" / "05-path-d-script.md")
    assert "android+ios" in text
    assert 'platform        = ""' in text or "platform: \"\"" in text
    assert "禁止复制 session.platform" in text or "禁止复制 session" in text
    assert "skills/trtc-chat/.docs-query.yaml" in text
    assert "{skill目录}/chat" not in text


def test_docs_skill_skips_path_d_signals_after_routing() -> None:
    text = _read(CHAT / "docs" / "SKILL.md")
    assert "禁止再 Read `path-d-signals.yaml`" in text
    assert "python3 -m tools.kb resolve chat/web/path-d-signals.yaml" not in text


def test_path_d_script_forbids_reread_signals() -> None:
    text = _read(CHAT / "references" / "05-path-d-script.md")
    assert "不在 Path D 执行链中" in text
    assert "禁止" in text and "path-d-signals.yaml" in text


def test_docs_query_session_id_init_at_d0a_only() -> None:
    path_d = _read(CHAT / "references" / "05-path-d-script.md")
    state = _read(CHAT / "references" / "08-state-config.md")
    template = _read(CHAT / ".docs-query.yaml")
    cli = _read(ROOT / "bin" / "cli.js")
    assert 'sessionId: ""' in template
    assert "stampTrtcChatDocsQuery" not in cli
    assert "D.0a-i" in path_d
    assert "永久保留" in path_d
    assert "install 不预填" in state or "install 不预填" in path_d


def test_path_d_docs_query_patch_write_guards() -> None:
    text = _read(CHAT / "references" / "05-path-d-script.md")
    assert "字段驻留守卫" in text
    assert "Patch-Write" in text
    assert "sdkappid: 0" in text and "null" in text
    assert "跨轮状态保护" in text
    state = _read(CHAT / "references" / "08-state-config.md")
    assert "Patch-Write" in state


def test_path_d_feedback_user_facing_wording() -> None:
    path_d = _read(CHAT / "references" / "05-path-d-script.md")
    reporting = _read(CHAT / "references" / "13-reporting.md")
    assert "记录反馈结果（已解决）" in path_d
    assert "记录反馈结果（未解决）" in path_d
    assert "发送 D.5 用户反馈上报" in reporting
    assert "记录反馈结果" in reporting
    assert "D.5 文末引导语" in reporting


def test_path_d5_footer_not_interactive() -> None:
    path_d = _read(CHAT / "references" / "05-path-d-script.md")
    assert "D.5 — 正向反馈（文末引导，非交互）" in path_d
    assert "问题解决了吗？方便的话告诉我" in path_d
    assert "回复 **解决了** 或 **没解决**" in path_d
    assert "D.5 反馈例外" in path_d
    assert path_d.count("ask_followup_question（D.5）") == 0
    assert "**7a — 写入 lastAnswer**" in path_d
    assert "**7c — 输出助手正文 + 反馈**" in path_d
    assert "7a=输出正文" in path_d or "错误顺序（禁止）" in path_d
    assert "先内部 7a → 7b，**最后** 7c" in path_d
    assert "回验确认" in path_d and "禁止" in path_d
    assert "如有后续问题，欢迎继续提问" in path_d


def test_state_config_documents_docs_query() -> None:
    text = _read(CHAT / "references" / "08-state-config.md")
    assert "§8.8 Path D" in text
    assert "android+ios" in text
    assert "framework" in text and "无" in text or "无 `framework`" in text
