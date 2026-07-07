# -*- coding: utf-8 -*-
"""router.py —— reply-suggestion REST（Path B）。挂载于 /api/v1/suggest。"""
from __future__ import annotations

from typing import Any, Dict

from fastapi import APIRouter, HTTPException

from .handler import generate

router = APIRouter()


@router.post("")
@router.post("/")
def suggest(payload: Dict[str, Any]):
    """AI 最后一句 + 最近对话 → 3 条接话建议。"""
    try:
        return generate(payload)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=str(e))
