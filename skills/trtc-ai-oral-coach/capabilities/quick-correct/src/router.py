# -*- coding: utf-8 -*-
"""router.py —— quick-correct REST（Path B）。挂载于 /api/v1/correct。"""
from __future__ import annotations

from typing import Any, Dict

from fastapi import APIRouter, HTTPException

from .handler import generate

router = APIRouter()


@router.post("")
@router.post("/")
def correct(payload: Dict[str, Any]):
    """提交一句话 → 返回纠正 + 更地道说法（无可纠正项则字段为 null）。"""
    try:
        return generate(payload)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=str(e))
