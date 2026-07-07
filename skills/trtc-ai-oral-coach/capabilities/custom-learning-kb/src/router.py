# -*- coding: utf-8 -*-
"""router.py —— custom-learning-kb REST（Path B）。挂载于 /api/v1/kb。"""
from __future__ import annotations

from typing import Any, Dict

from fastapi import APIRouter, HTTPException

from .adapters.clients import get_client

router = APIRouter()


@router.post("/retrieve")
def kb_retrieve(payload: Dict[str, Any]):
    """检索教研片段。body = {query, top_k?}"""
    query = (payload.get("query") or "").strip()
    if not query:
        raise HTTPException(status_code=400, detail="query is required")
    top_k = int(payload.get("top_k", 3) or 3)
    try:
        records = get_client().retrieve(query, top_k)
        return {"records": records}
    except ValueError as e:   # SSRF / 配置错误
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"KB upstream error: {e}")
