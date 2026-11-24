"""Unit tests for scripts.lib.flow_codegen.

The eval harness has no on-disk fixtures for codegen output (intentionally —
keeping fixtures in sync with hand-rolled TS would just shift the drift
problem one level over). Instead we assert on properties of the rendered
strings:

  - depends_on entries appear as ``await import("./<id>").run()`` in order
  - hooks render as ``const <alias> = (<from> as any).<call>()``
  - vars render as ``const <name> = (<expr>);``
  - call/sleep/log/wait_for/subscribe each render to a recognisable shape
  - the coordinator registers the case_id and every depends_on builtin
  - copying a builtin rewrites ``../_runtime`` → ``./_runtime`` (otherwise
    the import would dangle in the deployed workspace layout)

Tests deliberately do NOT shell out to ``tsc`` — that's exercised by the
end-to-end verification step in the plan, and would make the unit tests
require a workspace's full ``node_modules``.
"""
import shutil
import sys
import tempfile
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

from scripts.lib import flow_codegen
from scripts.lib.schemas import Case


def _builtin_pool() -> Path:
    """Return a temp directory with a minimal _builtin/ + _runtime.ts pair.

    Layout mirrors templates/web-demo/src/autorun/ so flow_codegen's
    ``_copy_runtime`` (which reads ``builtin_root.parent / "_runtime.ts"``)
    finds the file.
    """
    root = Path(tempfile.mkdtemp(prefix="trtc-codegen-"))
    (root / "_runtime.ts").write_text("// stub\n")
    btdir = root / "_builtin"
    btdir.mkdir()
    (btdir / "login.ts").write_text(
        'import { getEnv } from "../_runtime";\n'
        "export async function run(): Promise<void> { void getEnv(); }\n"
    )
    return btdir


def _make_case(test_id: str, flow) -> Case:
    return Case.model_validate({
        "test_id": test_id,
        "ability": "x/y",
        "product": "live",
        "platform": "web",
        "user_prompt": "p",
        "expected_slice_ids": [],
        "constraints": {},
        "expected_events": [],
        "acceptance": {},
        "auto_run_flow": flow,
        "tags": [],
        "status": "active",
    })


# ---------------------------------------------------------------------------
# Test 1: log + sleep + log only — the simplest DSL shape (no hooks, no vars)
# ---------------------------------------------------------------------------

def test_log_and_sleep_only():
    btroot = _builtin_pool()
    ws = btroot.parent / "ws-1"
    ws.mkdir()
    case = _make_case("TC-LOG-ONLY", {
        "depends_on": [],
        "imports": {},
        "hooks": {},
        "vars": {},
        "steps": [
            {"log": "hello"},
            {"sleep": 250},
            {"log": "bye"},
        ],
    })

    flow_codegen.generate(case, ws, btroot)
    out = (ws / "src" / "autorun" / "TC-LOG-ONLY.ts").read_text()

    # logs render with the autorun:<test_id> prefix so log-bridge.mjs can
    # group them and runtime_monitor's expected_event_hit can token-match.
    assert "console.log(`[autorun:TC-LOG-ONLY] hello`)" in out
    assert "console.log(`[autorun:TC-LOG-ONLY] bye`)" in out
    # sleep renders as a Promise+setTimeout — the DSL ms value flows through.
    assert "setTimeout(r, 250)" in out
    # No depends_on, no imports, no hooks → no `await import(`, no extras.
    assert "await import(" not in out
    assert "as any).use" not in out

    coord = (ws / "src" / "autorun" / "autoRunCoordinator.ts").read_text()
    # Even with empty depends_on, the case itself must be registered.
    assert '"TC-LOG-ONLY": () => import("./TC-LOG-ONLY")' in coord
    shutil.rmtree(btroot.parent)


# ---------------------------------------------------------------------------
# Test 2: hooks + vars + arg interpolation — the typical room flow shape
# ---------------------------------------------------------------------------

def test_hooks_vars_and_arg_interpolation():
    btroot = _builtin_pool()
    ws = btroot.parent / "ws-2"
    ws.mkdir()
    case = _make_case("TC-ROOM-001", {
        "depends_on": ["login"],
        "imports": {"room": "tuikit-atomicx-vue3/room"},
        "hooks": {
            "rs": {"from": "room", "call": "useRoomState"},
            "dev": {"from": "room", "call": "useDeviceState"},
        },
        "vars": {"roomId": {"expr": "`eval_${env.userId}_${Date.now()}`"}},
        "steps": [
            {"call": "rs.createAndJoinRoom",
             "args": [{"roomId": "{{roomId}}", "options": {"roomName": "x"}}],
             "on_error": "abort"},
            {"call": "dev.openLocalCamera"},
        ],
    })

    flow_codegen.generate(case, ws, btroot)
    out = (ws / "src" / "autorun" / "TC-ROOM-001.ts").read_text()

    # depends_on ⇒ a leading await import("./login").run().
    assert 'await (await import("./login")).run();' in out
    # imports ⇒ aliased dynamic import.
    assert 'const room = await import("tuikit-atomicx-vue3/room");' in out
    # hooks ⇒ const <alias> = (<from> as any).<call>().
    assert "const rs = (room as any).useRoomState();" in out
    assert "const dev = (room as any).useDeviceState();" in out
    # vars ⇒ const <name> = (<expr>);
    assert "const roomId = (`eval_${env.userId}_${Date.now()}`);" in out
    # arg interpolation ⇒ "{{roomId}}" becomes the bareword `roomId`.
    assert '{"roomId": roomId, "options": {"roomName": "x"}}' in out
    # on_error: "abort" wraps the call in try/catch and returns on rejection.
    assert "} catch (e) {" in out
    assert "return;" in out
    # default on_error continues: trailing call uses .catch + warn pattern.
    assert "openLocalCamera rejected" in out

    coord = (ws / "src" / "autorun" / "autoRunCoordinator.ts").read_text()
    assert '"TC-ROOM-001": () => import("./TC-ROOM-001")' in coord
    assert '"login": () => import("./login")' in coord

    # The login builtin was copied into the workspace and its source-relative
    # ../_runtime import was rewritten to ./_runtime so it resolves in the
    # deployed layout.
    login_copy = (ws / "src" / "autorun" / "login.ts").read_text()
    assert 'from "./_runtime"' in login_copy
    assert 'from "../_runtime"' not in login_copy

    shutil.rmtree(btroot.parent)


# ---------------------------------------------------------------------------
# Test 3: wait_for + subscribe — the polling/event-driven DSL shapes used by
# more elaborate flows (login itself stays as a hand-written builtin, but
# nothing prevents a case from using these step types directly).
# ---------------------------------------------------------------------------

def test_wait_for_and_subscribe():
    btroot = _builtin_pool()
    ws = btroot.parent / "ws-3"
    ws.mkdir()
    case = _make_case("TC-EVENTS-001", {
        "depends_on": [],
        "imports": {"room": "tuikit-atomicx-vue3/room"},
        "hooks": {"login_": {"from": "room", "call": "useLoginState"}},
        "vars": {},
        "steps": [
            {"wait_for": "login_.loginUserInfo.value.userId", "timeout_ms": 5000},
            {"subscribe": "login_.subscribeEvent",
             "event": "LoginEvent.onLoginExpired",
             "log": "onLoginExpired"},
        ],
    })

    flow_codegen.generate(case, ws, btroot)
    out = (ws / "src" / "autorun" / "TC-EVENTS-001.ts").read_text()

    # wait_for renders a 200ms-tick polling loop bounded by timeout_ms.
    assert "while (Date.now() - _t0 < 5000)" in out
    assert "if (login_.loginUserInfo.value.userId)" in out
    assert "wait_for timeout: login_.loginUserInfo.value.userId" in out

    # subscribe renders: <hook>(<event>, () => console.log(<log>))
    assert (
        "(login_.subscribeEvent)(LoginEvent.onLoginExpired, () => "
        "console.log(`[autorun:TC-EVENTS-001] onLoginExpired`));"
    ) in out

    shutil.rmtree(btroot.parent)


# ---------------------------------------------------------------------------
# Test 4: legacy list[str] form — no <test_id>.ts is generated; the
# coordinator dispatches straight to the named builtins.
# ---------------------------------------------------------------------------

def test_legacy_list_form():
    btroot = _builtin_pool()
    ws = btroot.parent / "ws-4"
    ws.mkdir()
    case = _make_case("TC-LEGACY-001", ["login"])

    flow_codegen.generate(case, ws, btroot)
    autorun = ws / "src" / "autorun"
    files = sorted(p.name for p in autorun.iterdir())
    # Only the runtime, the builtin we depended on, and the coordinator —
    # NOT a TC-LEGACY-001.ts (that would be wrong in legacy mode).
    assert files == ["_runtime.ts", "autoRunCoordinator.ts", "login.ts"]

    coord = (autorun / "autoRunCoordinator.ts").read_text()
    assert '"login": () => import("./login")' in coord
    assert '"TC-LEGACY-001"' not in coord  # no per-case key in legacy mode

    shutil.rmtree(btroot.parent)


# ---------------------------------------------------------------------------
# Test 5: missing builtin raises a clear error rather than silently emitting
# an import that fails at runtime ("Unknown EVAL_AUTO_RUN_FLOW: …").
# ---------------------------------------------------------------------------

def test_missing_builtin_raises():
    btroot = _builtin_pool()
    ws = btroot.parent / "ws-5"
    ws.mkdir()
    case = _make_case("TC-MISSING-001", {
        "depends_on": ["does_not_exist"],
        "imports": {},
        "hooks": {},
        "vars": {},
        "steps": [],
    })

    with pytest.raises(FileNotFoundError, match="does_not_exist"):
        flow_codegen.generate(case, ws, btroot)

    shutil.rmtree(btroot.parent)


# ---------------------------------------------------------------------------
# Test 6: the schema's own validator catches an undefined hook alias before
# the codegen ever runs (DSL rejected at Case.model_validate).
# ---------------------------------------------------------------------------

def test_validator_rejects_undefined_alias():
    with pytest.raises(Exception, match="undefined hook alias"):
        _make_case("TC-BAD-001", {
            "depends_on": [],
            "imports": {"room": "tuikit-atomicx-vue3/room"},
            "hooks": {"rs": {"from": "room", "call": "useRoomState"}},
            "vars": {},
            "steps": [{"call": "WRONG.foo"}],
        })
