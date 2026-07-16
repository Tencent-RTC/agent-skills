# -*- coding: utf-8 -*-
"""meeting-ops 的 FastAPI 子路由：扇出编排的 HTTP 接口。

挂载于 conversation-core 的 /api/v1/meeting 前缀下（见 conversation-core/src/server.py）。

安全提示（务必阅读 README/manifest 的安全声明）：
  这些接口是**特权操作端点**，本能力包不做任何调用者身份/权限校验。
  集成方必须在自己的后端完成"调用者是否有权触发"的校验后，才转发请求到这里
  （例如：先校验 JWT/Session 里的角色是房主/管理员，再调用 /api/v1/meeting/session/start）。
  Path A 的会议室 demo 场景里，这层校验由 scenarios/meeting-interpreter 的 demo 专属
  glue 代码实现（内存字典房主登记），不属于本能力包。
"""
from __future__ import annotations

import sys
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel

_SRC_DIR = Path(__file__).resolve().parent
if str(_SRC_DIR) not in sys.path:
    sys.path.insert(0, str(_SRC_DIR))

from fanout import get_orchestrator  # noqa: E402

router = APIRouter()


def _require_agent(request: Request):
    agent = getattr(request.app.state, "conversation_agent", None)
    if agent is None:
        raise HTTPException(status_code=503, detail={"code": "credentials_missing", "message": "conversation-core not initialized"})
    return agent


class SessionStartRequest(BaseModel):
    room_id: str
    room_id_type: int = 1
    participants: List[str]
    capability: str = "realtime-translation"
    params: Dict[str, Any] = {}


class SessionStopRequest(BaseModel):
    room_id: str


@router.post("/session/start")
def session_start(req: SessionStartRequest, request: Request) -> Dict[str, Any]:
    agent = _require_agent(request)
    orchestrator = get_orchestrator()
    if not req.participants:
        raise HTTPException(status_code=400, detail="participants must not be empty")
    try:
        result = orchestrator.start(
            agent=agent,
            room_id=req.room_id,
            participants=req.participants,
            capability=req.capability,
            params=req.params,
            room_id_type=req.room_id_type,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=str(exc))
    return {"code": 0, "msg": "success", "data": result}


@router.post("/session/stop")
def session_stop(req: SessionStopRequest, request: Request) -> Dict[str, Any]:
    agent = _require_agent(request)
    orchestrator = get_orchestrator()
    stopped = orchestrator.stop(agent, req.room_id)
    return {"code": 0, "msg": "success", "data": {"stopped": stopped}}


@router.get("/session/state")
def session_state(room_id: str = Query(...)) -> Dict[str, Any]:
    orchestrator = get_orchestrator()
    return {"code": 0, "data": orchestrator.state(room_id)}
