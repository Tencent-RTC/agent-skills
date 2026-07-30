from __future__ import annotations

import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]


class ReportingInstructionContractTests(unittest.TestCase):
    def test_root_has_one_prompt_reporting_command(self) -> None:
        text = (ROOT / "skills" / "trtc" / "SKILL.md").read_text(encoding="utf-8")
        self.assertEqual(text.count('reporting.py" prompt --text'), 1)
        self.assertEqual(text.count('invoke --skillname'), 1)

    def test_business_skills_keep_reporting_instructions_compact(self) -> None:
        skill_paths = [
            "skills/trtc-docs/SKILL.md",
            "skills/trtc-conference/SKILL.md",
            "skills/trtc-ai-service/SKILL.md",
            "skills/trtc-ai-oral-coach/SKILL.md",
            "skills/trtc-ai-realtime-interpreter/SKILL.md",
            "skills/trtc-push/SKILL.md",
        ]
        for relative in skill_paths:
            with self.subTest(skill=relative):
                text = (ROOT / relative).read_text(encoding="utf-8")
                self.assertLessEqual(text.count("tools/reporting.py"), 1)
                self.assertLessEqual(text.count("context --question"), 1)

    def test_host_bootstraps_have_one_reporting_command(self) -> None:
        for relative in ("AGENTS.md", "CLAUDE.md", "CODEBUDDY.md"):
            with self.subTest(host=relative):
                text = (ROOT / relative).read_text(encoding="utf-8")
                self.assertEqual(text.count("tools/reporting.py"), 2)
                self.assertIn("preference --enabled off", text)
                self.assertIn("ignore failure and continue", text)

        cursor_rule = (
            ROOT / ".cursor" / "rules" / "ui-mode.mdc"
        ).read_text(encoding="utf-8")
        self.assertEqual(cursor_rule.count("trtc/tools/reporting.py"), 2)
        self.assertIn("preference --enabled off", cursor_rule)
        self.assertIn("ignore failure and continue", cursor_rule)
        self.assertIn(".cursor/skills/trtc/SKILL.md", cursor_rule)

    def test_workflow_docs_never_call_reporting_mcp_directly(self) -> None:
        protocol = ROOT / "skills" / "trtc" / "runtime" / "REPORTING.md"
        for path in (ROOT / "skills").rglob("*.md"):
            if path == protocol:
                continue
            with self.subTest(path=path.relative_to(ROOT)):
                text = path.read_text(encoding="utf-8")
                self.assertNotIn(
                    "mcp__tencent-rtc-skill-tool__skill_analysis", text
                )

    def test_workflow_docs_use_unified_reporting_cli(self) -> None:
        for path in (ROOT / "skills").rglob("*.md"):
            with self.subTest(path=path.relative_to(ROOT)):
                text = path.read_text(encoding="utf-8")
                if path.name == "REPORTING.md":
                    continue
                self.assertNotIn("reporting_v2.py", text)


if __name__ == "__main__":
    unittest.main()
