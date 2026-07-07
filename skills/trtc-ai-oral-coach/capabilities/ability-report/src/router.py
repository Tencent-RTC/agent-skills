# -*- coding: utf-8 -*-
"""router.py —— ability-report REST（Path B）。挂载于 /api/v1/report。"""
from __future__ import annotations

from typing import Any, Dict

from fastapi import APIRouter, HTTPException

from .handler import generate

router = APIRouter()


@router.post("")
@router.post("/")
def report(payload: Dict[str, Any]):
    """提交 transcript → 4 维能力报告（{Report, Language}）。"""
    try:
        return generate(payload)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=str(e))
