"""Unit tests for error fingerprint extraction and tiered penalty."""
from __future__ import annotations
import json
import sys
import tempfile
import unittest
from pathlib import Path

_SKILL_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(_SKILL_ROOT))


class FingerprintExtractionTests(unittest.TestCase):

    def test_page_error_with_stack(self):
        from scripts.runtime_monitor import _extract_error_fingerprint
        line = json.dumps({
            "__probe": "page_error",
            "text": "[pageerror] $setup.speakingUsers.includes is not a function",
            "stack": "TypeError: $setup.speakingUsers.includes is not a function\n    at <anonymous> (http://127.0.0.1:5173/src/views/ConferenceRoom.vue:405:81)\n",
        })
        fp = _extract_error_fingerprint(line)
        self.assertEqual(fp, "$setup.speakingUsers.includes is not a function|ConferenceRoom.vue:405")

    def test_unhandled_rejection_embedded_json(self):
        from scripts.runtime_monitor import _extract_error_fingerprint
        inner = json.dumps({
            "__probe": "unhandled_rejection",
            "message": "$setup.speakingUsers.includes is not a function",
            "stack": "TypeError: $setup.speakingUsers.includes is not a function\n    at http://127.0.0.1:5173/src/views/ConferenceRoom.vue:405:81\n",
        })
        line = json.dumps({"text": inner, "__probe": "unhandled_rejection"})
        fp = _extract_error_fingerprint(line)
        self.assertEqual(fp, "$setup.speakingUsers.includes is not a function|ConferenceRoom.vue:405")

    def test_cross_type_same_fingerprint(self):
        from scripts.runtime_monitor import _extract_error_fingerprint
        pe = json.dumps({
            "__probe": "page_error",
            "text": "[pageerror] foo is not defined",
            "stack": "ReferenceError: foo is not defined\n    at bar (http://127.0.0.1:5173/src/App.vue:42:10)\n",
        })
        ur = json.dumps({
            "text": json.dumps({"__probe": "unhandled_rejection", "message": "foo is not defined", "stack": "ReferenceError: foo is not defined\n    at bar (http://127.0.0.1:5173/src/App.vue:42:10)\n"}),
            "__probe": "unhandled_rejection",
        })
        self.assertEqual(_extract_error_fingerprint(pe), _extract_error_fingerprint(ur))

    def test_no_stack_fallback(self):
        from scripts.runtime_monitor import _extract_error_fingerprint
        line = json.dumps({"__probe": "page_error", "text": "[pageerror] Cannot read properties of null"})
        fp = _extract_error_fingerprint(line)
        self.assertEqual(fp, "Cannot read properties of null|<no-source>")

    def test_non_probe_returns_none(self):
        from scripts.runtime_monitor import _extract_error_fingerprint
        self.assertIsNone(_extract_error_fingerprint(json.dumps({"text": "hello"})))

    def test_noise_returns_none(self):
        from scripts.runtime_monitor import _extract_error_fingerprint
        line = json.dumps({"__probe": "page_error", "text": "[pageerror] favicon.ico net::ERR_FAILED"})
        self.assertIsNone(_extract_error_fingerprint(line))


class TieredPenaltyTests(unittest.TestCase):

    def test_values(self):
        from scripts.runtime_monitor import _compute_health_penalty_v2
        self.assertAlmostEqual(_compute_health_penalty_v2(0), 0.0)
        self.assertAlmostEqual(_compute_health_penalty_v2(1), 0.10)
        self.assertAlmostEqual(_compute_health_penalty_v2(2), 0.20)
        self.assertAlmostEqual(_compute_health_penalty_v2(3), 0.30)
        self.assertAlmostEqual(_compute_health_penalty_v2(4), 0.50)
        self.assertAlmostEqual(_compute_health_penalty_v2(100), 0.50)


class ScanHealthProbesV2Tests(unittest.TestCase):

    def test_dedup_8_probes_to_1(self):
        from scripts.runtime_monitor import _scan_health_probes, _compute_health_penalty_v2
        msg = "$setup.speakingUsers.includes is not a function"
        stack_pe = f"TypeError: {msg}\n    at <anonymous> (http://127.0.0.1:5173/src/views/ConferenceRoom.vue:405:81)\n"
        stack_ur = f"TypeError: {msg}\n    at http://127.0.0.1:5173/src/views/ConferenceRoom.vue:405:81\n"
        lines = []
        for _ in range(4):
            lines.append(json.dumps({"__probe": "page_error", "text": f"[pageerror] {msg}", "stack": stack_pe}, separators=(",", ":")))
            inner = json.dumps({"__probe": "unhandled_rejection", "message": msg, "stack": stack_ur}, separators=(",", ":"))
            lines.append(json.dumps({"text": inner, "__probe": "unhandled_rejection"}, separators=(",", ":")))

        lines.append(json.dumps({
            "__probe": "dom_snapshot", "hasContent": True,
            "textLength": 10, "interactiveElements": 0,
        }, separators=(",", ":")))

        with tempfile.NamedTemporaryFile(mode="w", suffix=".log", delete=False) as f:
            f.write("\n".join(lines) + "\n")
            tmp = Path(f.name)
        try:
            counts, _, dom_ok, fps, txt_len, interact = _scan_health_probes(tmp)
            self.assertEqual(counts["page_error"], 4)
            self.assertEqual(counts["unhandled_rejection"], 4)
            self.assertEqual(len(fps), 1)
            self.assertAlmostEqual(_compute_health_penalty_v2(len(fps)), 0.10)
            self.assertFalse(dom_ok)  # textLength=10 < 50
            self.assertEqual(txt_len, 10)
        finally:
            tmp.unlink()

    def test_dom_above_threshold(self):
        from scripts.runtime_monitor import _scan_health_probes
        line = json.dumps({
            "__probe": "dom_snapshot", "hasContent": True,
            "textLength": 120, "interactiveElements": 5,
        })
        with tempfile.NamedTemporaryFile(mode="w", suffix=".log", delete=False) as f:
            f.write(line + "\n")
            tmp = Path(f.name)
        try:
            _, _, dom_ok, _, txt_len, interact = _scan_health_probes(tmp)
            self.assertTrue(dom_ok)
            self.assertEqual(txt_len, 120)
            self.assertEqual(interact, 5)
        finally:
            tmp.unlink()

    def test_backward_compat_no_textLength(self):
        from scripts.runtime_monitor import _scan_health_probes
        line = json.dumps({"__probe": "dom_snapshot", "hasContent": True})
        with tempfile.NamedTemporaryFile(mode="w", suffix=".log", delete=False) as f:
            f.write(line + "\n")
            tmp = Path(f.name)
        try:
            _, _, dom_ok, _, _, _ = _scan_health_probes(tmp)
            self.assertTrue(dom_ok)  # fallback to hasContent
        finally:
            tmp.unlink()


class DynamicResultSchemaTests(unittest.TestCase):

    def test_new_fields_have_defaults(self):
        from scripts.lib.schemas import DynamicResult
        r = DynamicResult(
            test_id="TC-TEST-001", compile_ok=True, compile_exit_code=0,
            events_captured=[], events_missing=[], events_hit_ratio=1.0, score=0.8,
        )
        self.assertEqual(r.unique_error_count, 0)
        self.assertEqual(r.error_fingerprints, [])
        self.assertEqual(r.dom_text_length, 0)
        self.assertEqual(r.dom_interactive_elements, 0)
        self.assertEqual(r.ui_interaction_count, 0)
        self.assertEqual(r.ui_interaction_success, 0)
        self.assertAlmostEqual(r.ui_driven_ratio, 0.0)


if __name__ == "__main__":
    unittest.main()
