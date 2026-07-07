# -*- coding: utf-8 -*-
"""handler.py —— /action facade 的 GenerateReport（复刻定稿 Demo：单语言，返回 {Report, Language}）。"""
from __future__ import annotations

from typing import Any, Dict

from .adapters.default import evaluate

_LEVELS = {"beginner", "intermediate", "advanced"}
_SCENARIOS = {"travel", "work", "study", "free"}
_STYLES = {"friend", "listener", "local"}
MAX_TRANSCRIPT_TURNS = 40


def generate(body: Dict[str, Any]) -> Dict[str, Any]:
    transcript = body.get("Transcript")
    if not isinstance(transcript, list) or not transcript:
        raise ValueError("Transcript is required and must be a non-empty list")
    if len(transcript) > MAX_TRANSCRIPT_TURNS:
        transcript = transcript[-MAX_TRANSCRIPT_TURNS:]
    scenario = body.get("Scenario") if body.get("Scenario") in _SCENARIOS else "free"
    level = body.get("Level") if body.get("Level") in _LEVELS else "intermediate"
    style = body.get("Style") if body.get("Style") in _STYLES else "friend"
    scenario_topic = (body.get("ScenarioTopic") or "").strip() or None
    raw_lang = (body.get("Language") or "en").strip().lower()
    output_language = "zh" if raw_lang.startswith("zh") else "en"
    duration_sec = int(body.get("DurationSec", 0) or 0)
    report = evaluate(transcript, scenario, level, style, duration_sec, output_language, scenario_topic)
    return {"Report": report, "Language": output_language}
