# -*- coding: utf-8 -*-
"""router.py —— scenario-roleplay 的 REST 路由（Path B）。挂载于 /api/v1/scene。"""
from __future__ import annotations

from typing import Any, Dict

from fastapi import APIRouter, HTTPException

from .handler import get_scene_candidates

router = APIRouter()


@router.post("/candidates")
def scene_candidates(payload: Dict[str, Any]):
    """Setup 屏具体场景候选：内置题库 or 外接知识库（自动降级）。"""
    try:
        return get_scene_candidates(payload)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=str(e))
