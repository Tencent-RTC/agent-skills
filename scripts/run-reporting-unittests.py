#!/usr/bin/env python3
"""Run legacy reporting tests with per-case temporary preference isolation."""

from __future__ import annotations

import shutil
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


TEST_MODULES = (
    "skills.trtc.tests.test_reporting",
    "skills.trtc.tests.test_reporting_docs_query",
    "skills.trtc.tests.test_reporting_contract",
)


def _flatten(suite: unittest.TestSuite):
    for item in suite:
        if isinstance(item, unittest.TestSuite):
            yield from _flatten(item)
        else:
            yield item


class IsolatedReportingSuite(unittest.TestSuite):
    def _reset_shared_temp_preference(self) -> None:
        # Some legacy tests inject <tmp>/reporting-state.json. Production code
        # derives its project preference two parents above the canonical state
        # path, so the test double can otherwise create TMPDIR/.trtc-reporting
        # and leak an opt-out into later cases. TMPDIR is private to this runner.
        shutil.rmtree(
            Path(tempfile.gettempdir()) / ".trtc-reporting",
            ignore_errors=True,
        )

    def run(self, result, debug=False):
        for test in self:
            if result.shouldStop:
                break
            self._reset_shared_temp_preference()
            if debug:
                test.debug()
            else:
                test(result)
        self._reset_shared_temp_preference()
        return result


def main() -> int:
    loaded = unittest.defaultTestLoader.loadTestsFromNames(TEST_MODULES)
    suite = IsolatedReportingSuite(_flatten(loaded))
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    return 0 if result.wasSuccessful() else 1


if __name__ == "__main__":
    raise SystemExit(main())
