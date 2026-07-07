# -*- coding: utf-8 -*-
"""handler.py —— /action facade 的 QuickCorrect（复刻定稿 Demo 响应形状）。"""
from __future__ import annotations

from typing import Any, Dict

from .adapters.default import quick_correct_multilang

_LEVELS = {"beginner", "intermediate", "advanced"}
_SCENARIOS = {"travel", "work", "study", "free"}


def _ui_lang_key(raw: str) -> str:
    r = (raw or "zh-CN").strip().lower()
    if r.startswith("zh"): return "zh"
    if r.startswith("ja"): return "ja"
    if r.startswith("ko"): return "ko"
    return "en"


def generate(body: Dict[str, Any]) -> Dict[str, Any]:
    sentence = (body.get("UserSentence") or "").strip()
    if not sentence:
        raise ValueError("UserSentence is required")
    sentence = sentence[:800]
    scenario = body.get("Scenario") if body.get("Scenario") in _SCENARIOS else "free"
    level = body.get("Level") if body.get("Level") in _LEVELS else "intermediate"
    scenario_topic = (body.get("ScenarioTopic") or "").strip() or None
    ai_followup = (body.get("AiFollowup") or "").strip() or None
    turn_id = body.get("TurnId") or ""
    ui_lang = _ui_lang_key(body.get("UILanguage") or "zh-CN")
    corrections = quick_correct_multilang(sentence, scenario, level, scenario_topic, ai_followup, ui_lang)
    return {"Corrections": corrections, "TurnId": turn_id}
