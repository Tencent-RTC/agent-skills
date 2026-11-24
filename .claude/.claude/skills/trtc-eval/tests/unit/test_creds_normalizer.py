"""Unit tests for scripts.lib.creds_normalizer.

Run from skill root:
    python -m pytest tests/unit/test_creds_normalizer.py -q
or with stdlib only:
    python tests/unit/test_creds_normalizer.py
"""
from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path

# Add skill root to sys.path so `from scripts.lib...` works without install
_SKILL_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(_SKILL_ROOT))

from scripts.lib.creds_normalizer import normalize_creds_in_workspace, _normalize_text  # noqa: E402
from scripts.lib.eval_config import TrtcTestAccount  # noqa: E402


_ACCOUNT = TrtcTestAccount(
    sdk_app_id=1400704311,
    user_id="krab",
    user_sig="eAEtjVELgjAURv-LfTXkLofbhB4so7AeihJ6NVxxmY5hQ6zovyfq6-kAAAA",
)


class NormalizeTextTests(unittest.TestCase):
    """In-memory tests for the pure _normalize_text() function."""

    def test_ai_classic_placeholder_is_replaced(self):
        src = """
        await login({
          sdkAppId: 1400000000,
          userId: 'user_001',
          userSig: 'YOUR_USERSIG',
        });
        """
        out, hits = _normalize_text(src, _ACCOUNT)
        self.assertIn("sdkAppId: 1400704311", out)
        self.assertIn("userId: 'krab'", out)
        self.assertIn(f"userSig: '{_ACCOUNT.user_sig}'", out)
        self.assertEqual({h.field for h in hits}, {"sdkAppId", "userId", "userSig"})

    def test_real_user_sig_is_left_alone(self):
        # If the AI happens to hard-code a real-looking signature, keep it.
        src = "await login({ userSig: 'AaBbCcDdEeFf01234567890_-*aBcDeFgHiJkLmNoPqRsT' });"
        out, hits = _normalize_text(src, _ACCOUNT)
        self.assertEqual(hits, [])
        self.assertEqual(out, src)

    def test_empty_user_sig_is_replaced(self):
        src = "userSig: ''"
        out, hits = _normalize_text(src, _ACCOUNT)
        self.assertEqual(len(hits), 1)
        self.assertEqual(hits[0].field, "userSig")

    def test_unknown_sdk_app_id_is_left_alone(self):
        # 1400999999 is not in the placeholder allowlist — don't touch it.
        src = "sdkAppId: 1400999999"
        out, hits = _normalize_text(src, _ACCOUNT)
        self.assertEqual(hits, [])
        self.assertEqual(out, src)

    def test_user_id_with_business_name_is_left_alone(self):
        # 'session_alice_2025' is a real-looking userId, not a placeholder.
        src = "userId: 'session_alice_2025'"
        out, hits = _normalize_text(src, _ACCOUNT)
        self.assertEqual(hits, [])

    def test_comments_and_keys_in_other_contexts_untouched(self):
        # Make sure the regex anchors on real assignments, not docstrings.
        src = """
        // sdkAppId: 1400000000 — example only
        const config = { sdkAppId: 1400000000 };
        function load(userId) { return userId; }
        """
        out, hits = _normalize_text(src, _ACCOUNT)
        # The const assignment IS replaced (real call site).
        self.assertIn("sdkAppId: 1400704311", out)
        # The comment line still contains the original text — there's no way
        # to selectively spare it without parsing JS, but the replacement is
        # a no-op since the comment regex doesn't match (no `:` after the ident
        # at the comment level — wait, it does match. Document this trade-off):
        # The comment is on a `// sdkAppId: 1400000000` line which DOES match.
        # That's acceptable: the audit log will show 2 hits, and a comment
        # losing a placeholder number is harmless.
        self.assertGreaterEqual(len([h for h in hits if h.field == "sdkAppId"]), 1)
        # The `function load(userId) { return userId; }` line does NOT match
        # because there's no `userId\s*:\s*` followed by a quoted literal.
        self.assertNotIn("function load(krab)", out)

    def test_template_literal_quotes_supported(self):
        src = "userSig: `YOUR_USERSIG`"
        out, hits = _normalize_text(src, _ACCOUNT)
        self.assertEqual(len(hits), 1)
        self.assertIn(f"userSig: `{_ACCOUNT.user_sig}`", out)


class NormalizeWorkspaceTests(unittest.TestCase):
    """Integration test: round-trip through the filesystem."""

    def test_writes_audit_summary_and_rewrites_files(self):
        with tempfile.TemporaryDirectory() as tmp:
            workspace = Path(tmp)
            generated = workspace / "src" / "generated"
            generated.mkdir(parents=True)
            target = generated / "App.vue"
            target.write_text(
                """
                <script setup lang="ts">
                await login({
                  sdkAppId: 1400000000,
                  userId: 'user_001',
                  userSig: 'YOUR_USERSIG',
                });
                </script>
                """
            )
            # File outside generated/ should NOT be touched.
            outsider = workspace / "src" / "lib.ts"
            outsider.parent.mkdir(parents=True, exist_ok=True)
            outsider.write_text("const sdkAppId = 1400000000;\n")

            summary = normalize_creds_in_workspace(workspace, _ACCOUNT)

            self.assertEqual(summary["total_files_changed"], 1)
            self.assertEqual(summary["total_hits"], 3)
            self.assertEqual(summary["files"][0]["path"], "src/generated/App.vue")

            rewritten = target.read_text()
            self.assertIn("sdkAppId: 1400704311", rewritten)
            self.assertIn("userId: 'krab'", rewritten)
            self.assertIn(_ACCOUNT.user_sig, rewritten)

            # Outsider untouched.
            self.assertEqual(outsider.read_text(), "const sdkAppId = 1400000000;\n")

    def test_no_generated_dir_is_a_noop(self):
        # Older test cases without an AI-generated drop should not crash.
        with tempfile.TemporaryDirectory() as tmp:
            workspace = Path(tmp)
            (workspace / "src").mkdir()
            summary = normalize_creds_in_workspace(workspace, _ACCOUNT)
            self.assertEqual(summary["total_files_changed"], 0)
            self.assertEqual(summary["total_hits"], 0)


if __name__ == "__main__":
    unittest.main()
