# -*- coding: utf-8 -*-
"""FastAPI 反代示例：把已有系统的请求转发到 trtc-ai-realtime-interpreter 骨架服务。

用法：把本文件拷进你的 FastAPI 项目（去掉 .tpl 后缀），修改 SKELETON_BASE_URL，
把 `include_router(router)` 挂到你的 app 上。

关键点：转发前先做权限校验（见 require_room_owner 的占位实现），再转发到骨架。
骨架服务本身跑在 ${SKELETON_BASE_URL}（默认 https://localhost:8020）。
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

SKELETON_BASE_URL = "${SKELETON_BASE_URL}"  # 例如 https://localhost:8020

router = APIRouter(prefix="${ROUTE_PREFIX}", tags=["ai-realtime-interpreter"])


# ---------------------------------------------------------------------------
# TODO：替换为你自己系统里真实的权限校验（见 room-owner-authz-note.md）
# ---------------------------------------------------------------------------
async def require_room_owner(room_id: str, caller_user_id: str) -> None:
    """占位实现：请替换成你系统里"调用者是不是这个房间的管理员/主持人"的真实判断。"""
    # 示例：
    # room = await my_room_service.get_room(room_id)
    # if room.owner_id != caller_user_id:
    #     raise HTTPException(status_code=403, detail="only room owner can operate")
    raise NotImplementedError("请实现 require_room_owner：接入你自己系统的权限判断")


class FanoutStartRequest(BaseModel):
    room_id: str
    room_id_type: int = 1
    caller_user_id: str            # 你自己系统里发起这次操作的用户
    participants: List[str]
    mode: str = "zh-en"


@router.post("/session/start")
async def session_start(req: FanoutStartRequest) -> Dict[str, Any]:
    await require_room_owner(req.room_id, req.caller_user_id)
    async with httpx.AsyncClient(verify=False, timeout=10.0) as client:
        resp = await client.post(
            f"{SKELETON_BASE_URL}/api/v1/meeting/session/start",
            json={
                "room_id": req.room_id,
                "room_id_type": req.room_id_type,
                "participants": req.participants,
                "capability": "realtime-translation",
                "params": {"mode": req.mode},
            },
        )
    if resp.status_code != 200:
        raise HTTPException(status_code=resp.status_code, detail=resp.text)
    return resp.json()


class FanoutStopRequest(BaseModel):
    room_id: str
    caller_user_id: str


@router.post("/session/stop")
async def session_stop(req: FanoutStopRequest) -> Dict[str, Any]:
    await require_room_owner(req.room_id, req.caller_user_id)
    async with httpx.AsyncClient(verify=False, timeout=10.0) as client:
        resp = await client.post(f"{SKELETON_BASE_URL}/api/v1/meeting/session/stop", json={"room_id": req.room_id})
    if resp.status_code != 200:
        raise HTTPException(status_code=resp.status_code, detail=resp.text)
    return resp.json()


@router.get("/session/state")
async def session_state(room_id: str) -> Dict[str, Any]:
    # 只读查询，无需权限校验
    async with httpx.AsyncClient(verify=False, timeout=10.0) as client:
        resp = await client.get(f"{SKELETON_BASE_URL}/api/v1/meeting/session/state", params={"room_id": room_id})
    if resp.status_code != 200:
        raise HTTPException(status_code=resp.status_code, detail=resp.text)
    return resp.json()
