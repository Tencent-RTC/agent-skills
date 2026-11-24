"""Unit tests for case_runner_orchestrator.py."""
import json
import sys
from pathlib import Path
from unittest.mock import patch, MagicMock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))


def _make_fake_case():
    return {
        "test_id": "TC-LIVE-IOS-001",
        "ability": "live/login-auth",
        "product": "live",
        "platform": "ios",
        "scenario": None,
        "user_prompt": "Test prompt for login auth.",
        "expected_slice_ids": ["live/login-auth"],
        "constraints": {
            "must_include": ["LoginStore.shared"],
            "must_not_include": ["TRTCCloud.sharedInstance()"],
            "file_count_min": 1,
        },
        "expected_events": ["onLoginSuccess"],
        "acceptance": {"static_score_min": 0.7, "dynamic_score_min": 0.5, "must_compile": True},
        "weights": {},
        "demo_injection_map": {},
        "auto_run_flow": [],
        "tags": ["live", "ios", "smoke"],
        "status": "active",
    }


def test_trace_line_count(tmp_path, monkeypatch):
    """trace.jsonl must have 1 (_meta) + 7 steps = 8 lines."""
    cases_path = tmp_path / "tests" / "benchmark"
    cases_path.mkdir(parents=True)
    (cases_path / "cases.json").write_text(json.dumps([_make_fake_case()]))

    run_dir = tmp_path / "run"
    run_dir.mkdir()
    (run_dir / "run.manifest.json").write_text("{}")

    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("TRTC_TEST_SDKAPPID", "123")
    monkeypatch.setenv("TRTC_TEST_USERID", "user")
    monkeypatch.setenv("TRTC_TEST_USERSIG", "sig")

    # Mock subprocess.run to return success
    fake_proc = MagicMock()
    fake_proc.returncode = 0
    fake_proc.stdout = b'{"ok": true}'
    fake_proc.stderr = b''

    # Mock device_picker to return a fake device
    from scripts.lib.platforms.base import Device
    fake_device = Device(kind="simulator", id="fake-udid", extra={})

    # cases.json is now read from the absolute _SKILL_ROOT, so re-anchor it
    # at tmp_path. Must be done BEFORE main() runs.
    import scripts.case_runner_orchestrator as orch
    monkeypatch.setattr(orch, "_SKILL_ROOT", tmp_path)

    with patch("subprocess.run", return_value=fake_proc), \
         patch("scripts.case_runner_orchestrator._pick_device", return_value=fake_device):
        from scripts.case_runner_orchestrator import main
        monkeypatch.setattr("sys.argv", [
            "orchestrator", "--case-id=TC-LIVE-IOS-001",
            f"--run-dir={run_dir}",
        ])
        exit_code = main()

    trace_path = run_dir / "cases" / "TC-LIVE-IOS-001" / "trace.jsonl"
    assert trace_path.exists()
    lines = trace_path.read_text().strip().splitlines()
    assert len(lines) == 8  # 1 _meta + 7 steps

    # First line is _meta with nonce
    meta = json.loads(lines[0])
    assert meta["step"] == "_meta"
    assert len(meta["nonce"]) == 32


def test_build_failure_skips_remaining(tmp_path, monkeypatch):
    """When demo_build fails, log_stream_start/demo_run/log_stream_stop/runtime_monitor are skipped."""
    cases_path = tmp_path / "tests" / "benchmark"
    cases_path.mkdir(parents=True)
    (cases_path / "cases.json").write_text(json.dumps([_make_fake_case()]))

    run_dir = tmp_path / "run"
    run_dir.mkdir()

    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("TRTC_TEST_SDKAPPID", "123")
    monkeypatch.setenv("TRTC_TEST_USERID", "user")
    monkeypatch.setenv("TRTC_TEST_USERSIG", "sig")

    call_count = [0]

    def fake_subprocess_run(cmd, **kwargs):
        call_count[0] += 1
        mock = MagicMock()
        mock.stdout = b'{}'
        mock.stderr = b''
        # Make demo_build (3rd step) fail
        if "demo_runner.py" in str(cmd) and "--phase=build" in str(cmd):
            mock.returncode = 1
        else:
            mock.returncode = 0
        return mock

    from scripts.lib.platforms.base import Device
    fake_device = Device(kind="simulator", id="fake-udid", extra={})

    import scripts.case_runner_orchestrator as orch
    monkeypatch.setattr(orch, "_SKILL_ROOT", tmp_path)

    with patch("subprocess.run", side_effect=fake_subprocess_run), \
         patch("scripts.case_runner_orchestrator._pick_device", return_value=fake_device):
        from scripts.case_runner_orchestrator import main
        monkeypatch.setattr("sys.argv", [
            "orchestrator", "--case-id=TC-LIVE-IOS-001",
            f"--run-dir={run_dir}",
        ])
        exit_code = main()

    assert exit_code == 2  # build failure code

    trace_path = run_dir / "cases" / "TC-LIVE-IOS-001" / "trace.jsonl"
    lines = trace_path.read_text().strip().splitlines()
    assert len(lines) == 8  # still 8 lines (1 meta + 7 steps, 4 skipped)

    # Check skipped steps
    for line in lines:
        step = json.loads(line)
        if step["step"] in ("log_stream_start", "demo_run", "log_stream_stop", "runtime_monitor"):
            assert step.get("status") == "skipped"
            assert step.get("reason") == "compile_fail"


def test_no_device_exits_4(tmp_path, monkeypatch):
    """When device_picker returns None, exit code is 4 and remaining steps are skipped."""
    cases_path = tmp_path / "tests" / "benchmark"
    cases_path.mkdir(parents=True)
    (cases_path / "cases.json").write_text(json.dumps([_make_fake_case()]))

    run_dir = tmp_path / "run"
    run_dir.mkdir()

    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("TRTC_TEST_SDKAPPID", "123")
    monkeypatch.setenv("TRTC_TEST_USERID", "user")
    monkeypatch.setenv("TRTC_TEST_USERSIG", "sig")

    fake_proc = MagicMock()
    fake_proc.returncode = 0
    fake_proc.stdout = b'{}'
    fake_proc.stderr = b''

    import scripts.case_runner_orchestrator as orch
    monkeypatch.setattr(orch, "_SKILL_ROOT", tmp_path)

    with patch("subprocess.run", return_value=fake_proc), \
         patch("scripts.case_runner_orchestrator._pick_device", return_value=None):
        from scripts.case_runner_orchestrator import main
        monkeypatch.setattr("sys.argv", [
            "orchestrator", "--case-id=TC-LIVE-IOS-001",
            f"--run-dir={run_dir}",
        ])
        exit_code = main()

    assert exit_code == 4


if __name__ == "__main__":
    import tempfile
    print("Run with pytest for proper monkeypatch support")
