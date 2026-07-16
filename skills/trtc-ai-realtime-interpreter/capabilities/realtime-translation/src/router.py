# -*- coding: utf-8 -*-
"""realtime-translation 的 FastAPI 子路由：单目标翻译场景的 HTTP 接口。

挂载于 conversation-core 的 /api/v1/translation 前缀下（见 conversation-core/src/server.py）。
面向"给一个人配一路翻译"的场景（主播/客服/任意单一目标），不涉及会议扇出——
多目标扇出场景请用 meeting-ops，它会直接调用 service.py 里的 build_lifecycle_config()
约定接口，不走这里的 HTTP 层。
"""
from __future__ import annotations

import sys
from pathlib import Path
from typing import Any, Dict, Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

_SRC_DIR = Path(__file__).resolve().parent
if str(_SRC_DIR) not in sys.path:
    sys.path.insert(0, str(_SRC_DIR))

from service import list_modes, start_translation  # noqa: E402

router = APIRouter()


def _require_agent(request: Request):
    agent = getattr(request.app.state, "conversation_agent", None)
    if agent is None:
        raise HTTPException(status_code=503, detail={"code": "credentials_missing", "message": "conversation-core not initialized"})
    return agent


class TranslationStartRequest(BaseModel):
    room_id: str
    room_id_type: int = 0
    target_user_id: str
    mode: str
    agent_user_id: Optional[str] = None


class TranslationStopRequest(BaseModel):
    session_id: str


@router.get("/modes")
def get_modes() -> Dict[str, Any]:
    return {"code": 0, "data": list_modes()}


@router.post("/start")
def translation_start(req: TranslationStartRequest, request: Request) -> Dict[str, Any]:
    agent = _require_agent(request)
    try:
        info = start_translation(
            agent=agent,
            room_id=req.room_id,
            target_user_id=req.target_user_id,
            mode=req.mode,
            room_id_type=req.room_id_type,
            agent_user_id=req.agent_user_id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=str(exc))
    return {
        "code": 0, "msg": "success",
        "data": {
            "session_id": info.session_id, "task_id": info.task_id,
            "agent_user_id": info.agent_user_id, "mode": req.mode, "status": "started",
        },
    }


@router.post("/stop")
def translation_stop(req: TranslationStopRequest, request: Request) -> Dict[str, Any]:
    agent = _require_agent(request)
    try:
        agent.stop(req.session_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return {"code": 0, "msg": "success", "data": {"session_id": req.session_id, "status": "stopped"}}
