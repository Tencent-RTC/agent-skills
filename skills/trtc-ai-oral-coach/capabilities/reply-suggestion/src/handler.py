# -*- coding: utf-8 -*-
"""handler.py —— /action facade 的 SuggestReplies（复刻定稿 Demo 响应形状）。"""
from __future__ import annotations

from typing import Any, Dict, List

from .adapters.default import suggest_replies

_LEVELS = {"beginner", "intermediate", "advanced"}
_SCENARIOS = {"travel", "work", "study", "free"}
_STYLES = {"friend", "listener", "local"}


def generate(body: Dict[str, Any]) -> Dict[str, Any]:
    ai_last = (body.get("AiLastMessage") or "").strip()
    if not ai_last:
        raise ValueError("AiLastMessage is required")
    ai_last = ai_last[:1200]
    scenario = body.get("Scenario") if body.get("Scenario") in _SCENARIOS else "free"
    level = body.get("Level") if body.get("Level") in _LEVELS else "intermediate"
    style = body.get("Style") if body.get("Style") in _STYLES else "friend"
    scenario_topic = (body.get("ScenarioTopic") or "").strip() or None
    recent: List[Dict[str, Any]] = []
    for item in (body.get("RecentTranscript") or [])[-6:]:
        if isinstance(item, dict) and item.get("role") in ("user", "coach") \
                and isinstance(item.get("text"), str) and item["text"].strip():
            recent.append({"role": item["role"], "text": item["text"][:400]})
    result = suggest_replies(ai_last, scenario, level, style, scenario_topic, recent)
    return {"Hints": result.get("hints") or [], "HintId": body.get("HintId") or ""}
