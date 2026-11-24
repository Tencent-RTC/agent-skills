"""Unit tests for the new web-platform pieces of dynamic eval:
  - puppeteer_parser.native_event_to_web_tokens / expected_event_hit
  - runtime_monitor._compute_health_penalty + score formula

Run from skill root:
    python -m pytest tests/unit/test_dynamic_web.py -q
"""
from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path

_SKILL_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(_SKILL_ROOT))

from scripts.lib.log_parsers.puppeteer_parser import (  # noqa: E402
    expected_event_hit,
    native_event_to_web_tokens,
)
from scripts.runtime_monitor import _compute_health_penalty  # noqa: E402


class TokenExtractionTests(unittest.TestCase):
    """native_event_to_web_tokens: cpp-log strings → identifier token sets."""

    def test_pipe_separated(self):
        tokens = native_event_to_web_tokens(
            "[account_manager.cc:46] |Login|login"
        )
        self.assertEqual(tokens, {"Login", "login"})

    def test_pipe_with_key_value(self):
        tokens = native_event_to_web_tokens(
            "[room_operation_handler.cc:685] |LeaveTRTCRoom|reason:LeaveRoom"
        )
        self.assertEqual(tokens, {"LeaveTRTCRoom", "LeaveRoom"})

    def test_camelcase_event_name(self):
        tokens = native_event_to_web_tokens(
            "[account_manager.cc:77] onLoginSuccess"
        )
        self.assertEqual(tokens, {"onLoginSuccess"})

    def test_simple_call_name(self):
        tokens = native_event_to_web_tokens(
            "[room_pipeline.cc:330] openLocalCamera"
        )
        self.assertEqual(tokens, {"openLocalCamera"})

    def test_short_token_filtered(self):
        # Tokens < 3 chars (like single letters) shouldn't pollute the set.
        tokens = native_event_to_web_tokens("[x.cc:1] |a|bb|abc")
        self.assertEqual(tokens, {"abc"})

    def test_empty_input(self):
        self.assertEqual(native_event_to_web_tokens(""), set())
        self.assertEqual(native_event_to_web_tokens("[x.cc:1]"), set())


class ExpectedEventHitTests(unittest.TestCase):
    """expected_event_hit: AND-match tokens against captured log lines."""

    def test_match_when_all_tokens_present(self):
        lines = [
            '{"ts":"...","level":"log","text":"[autorun:login] |Login|login start"}\n',
        ]
        self.assertTrue(
            expected_event_hit("[account_manager.cc:46] |Login|login", lines)
        )

    def test_partial_token_does_not_match(self):
        lines = [
            '{"ts":"...","level":"log","text":"only Login no lowercase"}\n',
        ]
        self.assertFalse(
            expected_event_hit("[account_manager.cc:46] |Login|login", lines)
        )

    def test_error_lines_excluded(self):
        # An error-level line should NOT count as a hit even if it contains
        # all the tokens — error lines are runtime-health signal, not success.
        lines = [
            '{"ts":"...","level":"error","text":"[Login][login] failed"}\n',
        ]
        self.assertFalse(
            expected_event_hit("[account_manager.cc:46] |Login|login", lines)
        )

    def test_probe_lines_excluded(self):
        # __probe lines (page errors, vue warnings) are health signals and
        # MUST NOT contribute to events_hit_ratio even if their text mentions
        # SDK identifiers.
        lines = [
            '{"ts":"...","level":"warn","__probe":"vue_warn","text":"[Login] [login] warning"}\n',
        ]
        self.assertFalse(
            expected_event_hit("[account_manager.cc:46] |Login|login", lines)
        )

    def test_no_tokens_no_hit(self):
        # Garbage expected_event with no extractable tokens should never hit.
        self.assertFalse(expected_event_hit("[x.cc:1]", ["anything"]))


class HealthPenaltyTests(unittest.TestCase):
    """_compute_health_penalty: counts → penalty value, capped at 0.5."""

    def test_no_probes_no_penalty(self):
        self.assertEqual(
            _compute_health_penalty({
                "page_error": 0, "unhandled_rejection": 0,
                "vue_warn": 0, "request_failed": 0,
            }),
            0.0,
        )

    def test_one_page_error_costs_15(self):
        p = _compute_health_penalty({
            "page_error": 1, "unhandled_rejection": 0,
            "vue_warn": 0, "request_failed": 0,
        })
        self.assertAlmostEqual(p, 0.15, places=4)

    def test_mixed_probes_sum(self):
        # 1 page_error (0.15) + 1 unhandled_rejection (0.15) + 2 vue_warn (0.0)
        # = 0.30 (vue_warn and request_failed have zero weight).
        p = _compute_health_penalty({
            "page_error": 1, "unhandled_rejection": 1,
            "vue_warn": 2, "request_failed": 0,
        })
        self.assertAlmostEqual(p, 0.30, places=4)

    def test_cap_at_05(self):
        # 4 page_errors (4*0.15=0.60) should cap at 0.5.
        p = _compute_health_penalty({
            "page_error": 4, "unhandled_rejection": 0,
            "vue_warn": 0, "request_failed": 0,
        })
        self.assertAlmostEqual(p, 0.5, places=4)

    def test_real_tc_conf_web_017_signal(self):
        # vue_warn and request_failed have zero weight, so penalty is 0.0.
        p = _compute_health_penalty({
            "page_error": 0, "unhandled_rejection": 0,
            "vue_warn": 14, "request_failed": 1,
        })
        self.assertAlmostEqual(p, 0.0, places=4)


if __name__ == "__main__":
    unittest.main()
