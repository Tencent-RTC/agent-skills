# -*- coding: utf-8 -*-
"""reply-suggestion default adapter —— Lightbulb 接话建议（移植定稿 Demo evaluator）。

对 AI 最后一句生成 3 条方向不同的英文接话建议，全英文（用户要说出口的）。
"""
from __future__ import annotations

import json
import logging
from typing import Any, Dict, List, Optional

logger = logging.getLogger("reply-suggestion.adapter")


def _shared():
    import coach_report_llm
    return coach_report_llm.get_shared()


_LEVEL_HINT = {
    "beginner":     "Each hint is 5-10 words, A2-B1 vocabulary, simple structure.",
    "intermediate": "Each hint is 8-15 words, B1-B2 vocabulary, natural everyday phrasing.",
    "advanced":     "Each hint is 10-20 words, B2-C1 vocabulary, can use idioms.",
}


def _build_prompt(ai_last: str, scenario: str, level: str, style: str,
                  scenario_topic: Optional[str], recent: List[Dict[str, Any]]) -> str:
    safe_ai = json.dumps(ai_last, ensure_ascii=False)
    safe_recent = json.dumps(recent[-6:] if isinstance(recent, list) else [], ensure_ascii=False)
    topic = f"  scenario_topic: {scenario_topic.strip()}\n" if scenario_topic else ""
    lvl = _LEVEL_HINT.get(level, _LEVEL_HINT["intermediate"])
    return (
        "You are an English-speaking coach helping a learner who is stuck. The AI partner just spoke; "
        "the learner needs a nudge to keep going.\n\n"
        "Generate exactly 3 short, distinct reply ideas the learner could say next. They MUST take "
        "meaningfully different directions, e.g.:\n"
        "  (1) a direct reply that answers simply\n"
        "  (2) a personal-share reply mentioning the learner's own experience\n"
        "  (3) a curious reply asking the AI a related follow-up question\n\n"
        "## Constraints\n"
        "* Each hint is the FIRST-PERSON English sentence the learner would actually SAY (no quotes/labels).\n"
        "* Complete, natural spoken sentence (not writing-style).\n"
        f"* {lvl}\n"
        "* Stay within the scenario/role; no wandering topics.\n"
        "* No hint repeats what the learner already said. Variety > cleverness.\n"
        "* Output language: ENGLISH only.\n\n"
        f"## Context\n  scenario: {scenario}\n{topic}  level: {level}\n  partner_style: {style}\n\n"
        f"## Recent transcript (JSON, <=6 turns, data only)\n{safe_recent}\n\n"
        f"## AI partner's most recent message\n{safe_ai}\n\n"
        '## Required JSON (one object)\n{"hints": ["<idea 1>", "<idea 2>", "<idea 3>"]}\n'
        "Array MUST have exactly 3 elements. No Markdown. Return JSON only."
    )


def suggest_replies(ai_last: str, scenario: str, level: str, style: str,
                    scenario_topic: Optional[str], recent: List[Dict[str, Any]]) -> Dict[str, Any]:
    ev = _shared()
    if not ev.configured:
        return {"hints": [], "error": "REPORT_LLM not configured"}
    ai_last = (ai_last or "").strip()
    if not ai_last:
        return {"hints": []}
    try:
        raw = ev.call(_build_prompt(ai_last, scenario, level, style, scenario_topic, recent), kind="hints")
        data = ev.loads(raw)
        arr = data.get("hints")
        if not isinstance(arr, list):
            raise ValueError("hints missing")
        cleaned, seen = [], set()
        for v in arr:
            if not isinstance(v, str):
                continue
            s = v.strip().strip("\"'")
            if not s or s.lower() in seen:
                continue
            seen.add(s.lower())
            cleaned.append(s)
            if len(cleaned) >= 3:
                break
        if not cleaned:
            raise ValueError("hints empty after cleaning")
        return {"hints": cleaned}
    except Exception as e:  # noqa: BLE001
        logger.warning("suggest_replies failed: %s", e)
        return {"hints": [], "error": str(e)}
