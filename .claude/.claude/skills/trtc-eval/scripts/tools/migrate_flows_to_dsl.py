"""migrate_flows_to_dsl.py — One-shot migration from list[str] flow ids
to inline ``AutoRunFlow`` DSL in cases.json.

Usage:
    python -m scripts.tools.migrate_flows_to_dsl

Effect:
    Rewrites tests/benchmark/cases.json so every web case's
    ``auto_run_flow`` becomes a DSL object. iOS / Android cases are left
    untouched (they don't go through flow_codegen). Cases whose flow is
    just ``["login"]`` are also left as-is — that's a builtin reference
    and the codegen handles it without DSL.

This script is idempotent: running it twice is a no-op (any case whose
auto_run_flow is already an object is skipped).
"""
from __future__ import annotations

import copy
import json
import sys
from pathlib import Path


# Map: case_id (or flow id from legacy list) -> DSL builder.
# Each builder returns a dict matching scripts.lib.schemas.AutoRunFlow.
# Keys are case_ids when the DSL is case-specific; we don't need a
# flow-id-based registry because every web case has at most one
# materialised DSL anyway (multi-flow cases were inlined manually).


def _login_only() -> dict:
    """For TC-CONF-WEB-001: just exercise the login chain. Reuses the
    builtin ``login`` flow (which already polls and subscribes events)."""
    return ["login"]


def _prejoin_check() -> dict:
    """TC-CONF-WEB-002 — legacy prejoinCheck.ts."""
    return {
        "depends_on": ["login"],
        "imports": {"room": "tuikit-atomicx-vue3/room"},
        "hooks": {"dev": {"from": "room", "call": "useDeviceState"}},
        "vars": {},
        "steps": [
            {"call": "dev.startCameraTest"},
            {"call": "dev.startMicrophoneTest"},
            {"call": "dev.startSpeakerTest"},
            {"sleep": 2000},
            {"call": "dev.stopCameraTest"},
            {"call": "dev.stopMicrophoneTest"},
            {"call": "dev.stopSpeakerTest"},
        ],
    }


def _room_create_join_leave() -> dict:
    """TC-CONF-WEB-003 — legacy roomCreateJoinLeave.ts. The full lifecycle
    chain that drives every cpp token in TC-CONF-WEB-017's expected_events."""
    return {
        "depends_on": ["login"],
        "imports": {"room": "tuikit-atomicx-vue3/room"},
        "hooks": {
            "rs": {"from": "room", "call": "useRoomState"},
            "rps": {"from": "room", "call": "useRoomParticipantState"},
            "dev": {"from": "room", "call": "useDeviceState"},
        },
        "vars": {"roomId": {"expr": "`eval_${env.userId}_${Date.now()}`"}},
        "steps": [
            {"log": "createRoom enterRoom roomId={{roomId}}"},
            {
                "call": "rs.createAndJoinRoom",
                "args": [{"roomId": "{{roomId}}", "options": {"roomName": "eval-room"}}],
                "on_error": "abort",
            },
            {"log": "in room"},
            {"call": "dev.openLocalMicrophone"},
            {"call": "dev.openLocalCamera"},
            {"log": "GetUserList"},
            {"call": "rps.getParticipantList", "args": [{"cursor": ""}]},
            {"sleep": 2000},
            {"call": "dev.closeLocalCamera"},
            {"call": "dev.closeLocalMicrophone"},
            {"log": "LeaveTRTCRoom reason:LeaveRoom"},
            {"call": "rs.leaveRoom"},
        ],
    }


def _room_config_create() -> dict:
    """TC-CONF-WEB-004 — createRoom + enterRoom with config options."""
    return {
        "depends_on": ["login"],
        "imports": {"room": "tuikit-atomicx-vue3/room"},
        "hooks": {"rs": {"from": "room", "call": "useRoomState"}},
        "vars": {"roomId": {"expr": "`eval_${env.userId}_${Date.now()}`"}},
        "steps": [
            {"log": "createRoom enterRoom with config roomId={{roomId}}"},
            {
                "call": "rs.createAndJoinRoom",
                "args": [{
                    "roomId": "{{roomId}}",
                    "options": {
                        "roomName": "eval-config-room",
                        "password": "test123",
                        "isAllMicrophoneDisabled": True,
                        "isAllCameraDisabled": True,
                    },
                }],
                "on_error": "abort",
            },
            {"sleep": 2000},
            {"call": "rs.leaveRoom"},
        ],
    }


def _video_layout_render() -> dict:
    """TC-CONF-WEB-005 — no SDK events expected; the case is purely UI
    composition (RoomView + LayoutTemplate). The flow just enters a room
    so the components have something to render against."""
    return {
        "depends_on": ["login"],
        "imports": {"room": "tuikit-atomicx-vue3/room"},
        "hooks": {"rs": {"from": "room", "call": "useRoomState"}},
        "vars": {"roomId": {"expr": "`eval_${env.userId}_${Date.now()}`"}},
        "steps": [
            {"call": "rs.createAndJoinRoom",
             "args": [{"roomId": "{{roomId}}", "options": {"roomName": "eval-layout"}}],
             "on_error": "abort"},
            {"sleep": 3000},
            {"call": "rs.leaveRoom"},
        ],
    }


def _schedule_room() -> dict:
    """TC-CONF-WEB-006 — schedule a future room, list, cancel."""
    return {
        "depends_on": ["login"],
        "imports": {"room": "tuikit-atomicx-vue3/room"},
        "hooks": {"rs": {"from": "room", "call": "useRoomState"}},
        "vars": {
            "scheduleStart": {"expr": "Math.floor(Date.now()/1000)+3600"},
            "scheduleEnd": {"expr": "Math.floor(Date.now()/1000)+5400"},
            "roomId": {"expr": "`eval_sched_${env.userId}_${Date.now()}`"},
        },
        "steps": [
            {"log": "ScheduleConference roomId={{roomId}}"},
            {
                "call": "rs.scheduleRoom",
                "args": [{
                    "roomId": "{{roomId}}",
                    "roomName": "eval-scheduled",
                    "scheduleStartTime": "{{scheduleStart}}",
                    "scheduleEndTime": "{{scheduleEnd}}",
                    "scheduleAttendees": [],
                }],
                "on_error": "continue",
            },
            {"call": "rs.getScheduledRoomList",
             "args": [{"cursor": "", "count": 20}]},
            {"sleep": 1500},
            {"call": "rs.cancelScheduledRoom", "args": ["{{roomId}}"]},
        ],
    }


def _room_invite() -> dict:
    """TC-CONF-WEB-007 — host calls users into the room. expected_events
    is empty; the flow just exercises callUserToRoom for completeness."""
    return {
        "depends_on": ["login"],
        "imports": {"room": "tuikit-atomicx-vue3/room"},
        "hooks": {"rs": {"from": "room", "call": "useRoomState"}},
        "vars": {"roomId": {"expr": "`eval_${env.userId}_${Date.now()}`"}},
        "steps": [
            {"call": "rs.createAndJoinRoom",
             "args": [{"roomId": "{{roomId}}", "options": {"roomName": "eval-invite"}}],
             "on_error": "abort"},
            {"call": "rs.callUserToRoom", "args": [{"userIdList": ["eval_invitee_placeholder"]}]},
            {"sleep": 2000},
            {"call": "rs.leaveRoom"},
        ],
    }


def _participant_list() -> dict:
    """TC-CONF-WEB-008 — fetch participant list."""
    return {
        "depends_on": ["login"],
        "imports": {"room": "tuikit-atomicx-vue3/room"},
        "hooks": {
            "rs": {"from": "room", "call": "useRoomState"},
            "rps": {"from": "room", "call": "useRoomParticipantState"},
        },
        "vars": {"roomId": {"expr": "`eval_${env.userId}_${Date.now()}`"}},
        "steps": [
            {"call": "rs.createAndJoinRoom",
             "args": [{"roomId": "{{roomId}}", "options": {"roomName": "eval-participants"}}],
             "on_error": "abort"},
            {"log": "GetUserList"},
            {"call": "rps.getParticipantList", "args": [{"cursor": ""}]},
            {"sleep": 2000},
            {"call": "rs.leaveRoom"},
        ],
    }


def _participant_manage() -> dict:
    """TC-CONF-WEB-009 — change role + kick. Targets a placeholder user
    that doesn't exist; both calls error and on_error=continue keeps
    the flow moving so we still emit the cpp tokens."""
    return {
        "depends_on": ["login"],
        "imports": {"room": "tuikit-atomicx-vue3/room"},
        "hooks": {
            "rs": {"from": "room", "call": "useRoomState"},
            "rps": {"from": "room", "call": "useRoomParticipantState"},
        },
        "vars": {"roomId": {"expr": "`eval_${env.userId}_${Date.now()}`"}},
        "steps": [
            {"call": "rs.createAndJoinRoom",
             "args": [{"roomId": "{{roomId}}", "options": {"roomName": "eval-manage"}}],
             "on_error": "abort"},
            {"log": "changeUserRole: placeholder_user"},
            {"call": "rps.setAdmin", "args": ["placeholder_user"]},
            {"log": "kickRemoteUserOutOfRoom placeholder_user"},
            {"call": "rps.kickParticipant", "args": ["placeholder_user"]},
            {"sleep": 2000},
            {"call": "rs.leaveRoom"},
        ],
    }


def _room_moderation() -> dict:
    """TC-CONF-WEB-010 — disableAllDevices + disableAllMessages."""
    return {
        "depends_on": ["login"],
        "imports": {"room": "tuikit-atomicx-vue3/room"},
        "hooks": {
            "rs": {"from": "room", "call": "useRoomState"},
            "rps": {"from": "room", "call": "useRoomParticipantState"},
        },
        "vars": {"roomId": {"expr": "`eval_${env.userId}_${Date.now()}`"}},
        "steps": [
            {"call": "rs.createAndJoinRoom",
             "args": [{"roomId": "{{roomId}}", "options": {"roomName": "eval-moderation"}}],
             "on_error": "abort"},
            {"log": "disableDeviceForAllUserByAdmin microphone"},
            {"call": "rps.disableAllDevices",
             "args": [{"deviceType": "microphone", "isDisabled": True}]},
            {"call": "rps.disableAllMessages", "args": [{"isDisabled": True}]},
            {"sleep": 2000},
            {"call": "rs.leaveRoom"},
        ],
    }


def _room_chat() -> dict:
    """TC-CONF-WEB-011 — chat: join room, set active conversation, send.
    Pulls from BOTH ``room`` and the package root (``tuikit-atomicx-vue3``)
    so two import aliases are needed."""
    return {
        "depends_on": ["login"],
        "imports": {
            "room": "tuikit-atomicx-vue3/room",
            "top": "tuikit-atomicx-vue3",
        },
        "hooks": {
            "rs": {"from": "room", "call": "useRoomState"},
            "conv": {"from": "top", "call": "useConversationListState"},
            "msg": {"from": "top", "call": "useMessageInputState"},
        },
        "vars": {
            "roomId": {"expr": "`eval_${env.userId}_${Date.now()}`"},
            "convId": {"expr": "`GROUP${roomId}`"},
        },
        "steps": [
            {"call": "rs.createAndJoinRoom",
             "args": [{"roomId": "{{roomId}}", "options": {"roomName": "eval-chat"}}],
             "on_error": "abort"},
            {"call": "conv.setActiveConversation", "args": [{"conversationId": "{{convId}}"}]},
            {"call": "msg.updateRawValue", "args": ["Hello from eval autorun"]},
            {"call": "msg.sendMessage"},
            {"sleep": 2000},
            {"call": "rs.leaveRoom"},
        ],
    }


def _device_toggle() -> dict:
    """TC-CONF-WEB-012 — open/close camera + mic in a room."""
    return {
        "depends_on": ["login"],
        "imports": {"room": "tuikit-atomicx-vue3/room"},
        "hooks": {
            "rs": {"from": "room", "call": "useRoomState"},
            "dev": {"from": "room", "call": "useDeviceState"},
        },
        "vars": {"roomId": {"expr": "`eval_${env.userId}_${Date.now()}`"}},
        "steps": [
            {"call": "rs.createAndJoinRoom",
             "args": [{"roomId": "{{roomId}}", "options": {"roomName": "eval-device"}}],
             "on_error": "abort"},
            {"call": "dev.openLocalMicrophone"},
            {"call": "dev.muteMicrophone"},
            {"call": "dev.unmuteMicrophone"},
            {"call": "dev.openLocalCamera"},
            {"sleep": 2000},
            {"call": "dev.closeLocalCamera"},
            {"call": "rs.leaveRoom"},
        ],
    }


def _network_quality() -> dict:
    """TC-CONF-WEB-013 — UI-only readback of useDeviceState().networkInfo.
    No SDK calls beyond joining a room so the network-info subscription
    has data to surface."""
    return {
        "depends_on": ["login"],
        "imports": {"room": "tuikit-atomicx-vue3/room"},
        "hooks": {"rs": {"from": "room", "call": "useRoomState"}},
        "vars": {"roomId": {"expr": "`eval_${env.userId}_${Date.now()}`"}},
        "steps": [
            {"call": "rs.createAndJoinRoom",
             "args": [{"roomId": "{{roomId}}", "options": {"roomName": "eval-net"}}],
             "on_error": "abort"},
            {"sleep": 3000},
            {"call": "rs.leaveRoom"},
        ],
    }


def _screen_share() -> dict:
    """TC-CONF-WEB-014 — startScreenShare + stopScreenShare."""
    return {
        "depends_on": ["login"],
        "imports": {"room": "tuikit-atomicx-vue3/room"},
        "hooks": {
            "rs": {"from": "room", "call": "useRoomState"},
            "dev": {"from": "room", "call": "useDeviceState"},
        },
        "vars": {"roomId": {"expr": "`eval_${env.userId}_${Date.now()}`"}},
        "steps": [
            {"call": "rs.createAndJoinRoom",
             "args": [{"roomId": "{{roomId}}", "options": {"roomName": "eval-screen"}}],
             "on_error": "abort"},
            {"log": "startScreenSharing"},
            {"call": "dev.startScreenShare"},
            {"sleep": 1500},
            {"log": "stopScreenSharing"},
            {"call": "dev.stopScreenShare"},
            {"call": "rs.leaveRoom"},
        ],
    }


def _beauty_apply() -> dict:
    """TC-CONF-WEB-015 — set beauty levels and save."""
    return {
        "depends_on": ["login"],
        "imports": {"room": "tuikit-atomicx-vue3/room"},
        "hooks": {"beauty": {"from": "room", "call": "useFreeBeautyState"}},
        "vars": {},
        "steps": [
            {"log": "enableTestBeautyStyle"},
            {"call": "beauty.setFreeBeauty",
             "args": [{"beautyLevel": 5, "whitenessLevel": 5, "ruddinessLevel": 3}]},
            {"call": "beauty.saveBeautySetting"},
            {"sleep": 1000},
        ],
    }


def _virtual_background() -> dict:
    """TC-CONF-WEB-016 — init + set + save virtual background."""
    return {
        "depends_on": ["login"],
        "imports": {"room": "tuikit-atomicx-vue3/room"},
        "hooks": {"vb": {"from": "room", "call": "useVirtualBackgroundState"}},
        "vars": {},
        "steps": [
            {"log": "enableTestVirtualBackground"},
            {"call": "vb.initVirtualBackground"},
            {"call": "vb.setVirtualBackground", "args": [{"type": "blur"}]},
            {"call": "vb.saveVirtualBackground"},
            {"sleep": 1000},
        ],
    }


def _standard_conference_017() -> dict:
    """TC-CONF-WEB-017 — login + full room lifecycle. Same shape as
    _room_create_join_leave but with explicit log lines that match the
    extra cpp tokens in this case's expected_events."""
    return _room_create_join_leave()


def _standard_conference_018() -> dict:
    """TC-CONF-WEB-018 — login + room with config + screen share + moderation.
    Inlines four legacy flows (login depends, room_config_create, screen_share,
    room_moderation) into one DSL."""
    return {
        "depends_on": ["login"],
        "imports": {"room": "tuikit-atomicx-vue3/room"},
        "hooks": {
            "rs": {"from": "room", "call": "useRoomState"},
            "rps": {"from": "room", "call": "useRoomParticipantState"},
            "dev": {"from": "room", "call": "useDeviceState"},
        },
        "vars": {"roomId": {"expr": "`eval_${env.userId}_${Date.now()}`"}},
        "steps": [
            {"log": "createRoom enterRoom roomId={{roomId}}"},
            {
                "call": "rs.createAndJoinRoom",
                "args": [{
                    "roomId": "{{roomId}}",
                    "options": {
                        "roomName": "eval-host",
                        "password": "test123",
                        "isAllMicrophoneDisabled": True,
                        "isAllCameraDisabled": True,
                    },
                }],
                "on_error": "abort",
            },
            {"call": "dev.openLocalMicrophone"},
            {"call": "dev.openLocalCamera"},
            {"log": "GetUserList"},
            {"call": "rps.getParticipantList", "args": [{"cursor": ""}]},
            {"log": "changeUserRole: placeholder_user"},
            {"call": "rps.setAdmin", "args": ["placeholder_user"]},
            {"log": "kickRemoteUserOutOfRoom placeholder_user"},
            {"call": "rps.kickParticipant", "args": ["placeholder_user"]},
            {"log": "disableDeviceForAllUserByAdmin"},
            {"call": "rps.disableAllMessages", "args": [{"isDisabled": True}]},
            {"log": "startScreenSharing"},
            {"call": "dev.startScreenShare"},
            {"sleep": 1500},
            {"log": "stopScreenSharing"},
            {"call": "dev.stopScreenShare"},
            {"call": "dev.closeLocalCamera"},
            {"call": "dev.closeLocalMicrophone"},
            {"log": "LeaveTRTCRoom reason:LeaveRoom"},
            {"call": "rs.leaveRoom"},
        ],
    }


def _standard_conference_019() -> dict:
    """TC-CONF-WEB-019 — login + schedule + create+join+leave."""
    return {
        "depends_on": ["login"],
        "imports": {"room": "tuikit-atomicx-vue3/room"},
        "hooks": {"rs": {"from": "room", "call": "useRoomState"}},
        "vars": {
            "scheduleStart": {"expr": "Math.floor(Date.now()/1000)+3600"},
            "scheduleEnd": {"expr": "Math.floor(Date.now()/1000)+5400"},
            "schedRoomId": {"expr": "`eval_sched_${env.userId}_${Date.now()}`"},
            "roomId": {"expr": "`eval_${env.userId}_${Date.now()}`"},
        },
        "steps": [
            {"log": "ScheduleConference roomId={{schedRoomId}}"},
            {
                "call": "rs.scheduleRoom",
                "args": [{
                    "roomId": "{{schedRoomId}}",
                    "roomName": "eval-scheduled",
                    "password": "test123",
                    "scheduleStartTime": "{{scheduleStart}}",
                    "scheduleEndTime": "{{scheduleEnd}}",
                    "scheduleAttendees": [],
                }],
            },
            {"call": "rs.getScheduledRoomList",
             "args": [{"cursor": "", "count": 20}]},
            {"call": "rs.cancelScheduledRoom", "args": ["{{schedRoomId}}"]},
            {"log": "createRoom enterRoom roomId={{roomId}}"},
            {
                "call": "rs.createAndJoinRoom",
                "args": [{"roomId": "{{roomId}}", "options": {"roomName": "eval-room"}}],
                "on_error": "abort",
            },
            {"sleep": 2000},
            {"log": "LeaveTRTCRoom reason:LeaveRoom"},
            {"call": "rs.leaveRoom"},
        ],
    }


def _standard_conference_020() -> dict:
    """TC-CONF-WEB-020 — login + room + invite + participant manage."""
    return {
        "depends_on": ["login"],
        "imports": {"room": "tuikit-atomicx-vue3/room"},
        "hooks": {
            "rs": {"from": "room", "call": "useRoomState"},
            "rps": {"from": "room", "call": "useRoomParticipantState"},
            "dev": {"from": "room", "call": "useDeviceState"},
        },
        "vars": {"roomId": {"expr": "`eval_${env.userId}_${Date.now()}`"}},
        "steps": [
            {"log": "createRoom enterRoom roomId={{roomId}}"},
            {
                "call": "rs.createAndJoinRoom",
                "args": [{"roomId": "{{roomId}}", "options": {"roomName": "eval-collab"}}],
                "on_error": "abort",
            },
            {"call": "dev.openLocalMicrophone"},
            {"call": "dev.openLocalCamera"},
            {"log": "GetUserList"},
            {"call": "rps.getParticipantList", "args": [{"cursor": ""}]},
            {"call": "rs.callUserToRoom", "args": [{"userIdList": ["eval_invitee_placeholder"]}]},
            {"log": "changeUserRole: placeholder_user"},
            {"call": "rps.setAdmin", "args": ["placeholder_user"]},
            {"sleep": 2000},
            {"call": "dev.closeLocalCamera"},
            {"call": "dev.closeLocalMicrophone"},
            {"log": "LeaveTRTCRoom reason:LeaveRoom"},
            {"call": "rs.leaveRoom"},
        ],
    }


# Per-case-id mapping. Tests that legitimately want to keep the legacy
# list[str] form (just ``["login"]``) map to ``_login_only``.
DSL_BY_CASE_ID: dict[str, callable] = {
    "TC-CONF-WEB-001": _login_only,
    "TC-CONF-WEB-002": _prejoin_check,
    "TC-CONF-WEB-003": _room_create_join_leave,
    "TC-CONF-WEB-004": _room_config_create,
    "TC-CONF-WEB-005": _video_layout_render,
    "TC-CONF-WEB-006": _schedule_room,
    "TC-CONF-WEB-007": _room_invite,
    "TC-CONF-WEB-008": _participant_list,
    "TC-CONF-WEB-009": _participant_manage,
    "TC-CONF-WEB-010": _room_moderation,
    "TC-CONF-WEB-011": _room_chat,
    "TC-CONF-WEB-012": _device_toggle,
    "TC-CONF-WEB-013": _network_quality,
    "TC-CONF-WEB-014": _screen_share,
    "TC-CONF-WEB-015": _beauty_apply,
    "TC-CONF-WEB-016": _virtual_background,
    "TC-CONF-WEB-017": _standard_conference_017,
    "TC-CONF-WEB-018": _standard_conference_018,
    "TC-CONF-WEB-019": _standard_conference_019,
    "TC-CONF-WEB-020": _standard_conference_020,
}


def main() -> int:
    skill_root = Path(__file__).resolve().parents[2]  # .../trtc-eval
    cases_path = skill_root / "tests" / "benchmark" / "cases.json"
    if not cases_path.exists():
        print(f"cases.json not found at {cases_path}", file=sys.stderr)
        return 1

    data = json.loads(cases_path.read_text())
    changed = 0
    for case in data:
        if case["platform"] != "web":
            continue
        builder = DSL_BY_CASE_ID.get(case["test_id"])
        if builder is None:
            print(f"  skip {case['test_id']}: no DSL builder mapped")
            continue
        new_flow = builder()
        if isinstance(new_flow, list) and case.get("auto_run_flow") == new_flow:
            continue  # already in the desired list[str] form
        if (
            isinstance(case.get("auto_run_flow"), dict)
            and case["auto_run_flow"] == new_flow
        ):
            continue  # already migrated
        case["auto_run_flow"] = new_flow
        changed += 1

    if changed == 0:
        print("No cases needed migration.")
        return 0

    backup = cases_path.with_suffix(".json.bak")
    backup.write_text(cases_path.read_text())
    cases_path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n")
    print(f"Migrated {changed} cases. Backup at {backup}.")

    # Validate via schema before exiting.
    sys.path.insert(0, str(skill_root))
    from scripts.lib.schemas import Case  # noqa: E402

    bad = 0
    for case in data:
        try:
            Case.model_validate(case)
        except Exception as e:
            bad += 1
            print(f"VALIDATION FAIL {case['test_id']}: {e}")
    if bad:
        print(f"\n{bad} cases failed schema validation. Restoring backup.")
        cases_path.write_text(backup.read_text())
        return 2
    print("Schema validation: OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
