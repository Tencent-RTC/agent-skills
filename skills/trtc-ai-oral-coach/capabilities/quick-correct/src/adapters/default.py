# -*- coding: utf-8 -*-
"""quick-correct default adapter —— Speak 风格单句纠正（移植定稿 Demo evaluator）。

多语言：总生成 en 版（fix/native 恒为英文，why 用英文），并按 ui_lang 生成对应版本
（why 用 ui_lang；支持 en/zh/ja/ko，其它降级 en）。并行调用共享评估基座。
"""
from __future__ import annotations

import json
import logging
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Dict, Optional

logger = logging.getLogger("quick-correct.adapter")


def _shared():
    import coach_report_llm
    return coach_report_llm.get_shared()


_TONE = {
    "zh": ("## 输出语言与语气\n* `correction.fix` 与 `better.native` 是英文（不翻译）。\n"
           "* `correction.why` 与 `better.why` **必须用简体中文**，教学+鼓励语气，点出为什么更像 native。\n"
           "* 避免「错了/不对」，用「这里建议/更自然的说法是/听起来更像 native」。`why` 30~80 字。\n"),
    "ja": ("## 出力言語とトーン\n* `correction.fix`/`better.native` は英語（翻訳しない）。\n"
           "* `correction.why`/`better.why` は**日本語で**、教育的で励ましのトーン、なぜ自然かを説明。\n"
           "* 「間違い/ダメ」を避け「こう言うと自然」。`why` は40〜100字。\n"),
    "ko": ("## 출력 언어 및 톤\n* `correction.fix`/`better.native` 는 영어(번역 금지).\n"
           "* `correction.why`/`better.why` 는 **한국어로**, 교육적·격려 톤, 왜 자연스러운지 설명.\n"
           "* '틀림/잘못' 대신 '이렇게 말하면 자연스럽습니다'. `why` 40~100자.\n"),
    "en": ("## Output language & tone\n* `correction.fix`/`better.native` are English (learning content).\n"
           "* `correction.why`/`better.why` in English, teaching+encouraging, say WHY it sounds more native.\n"
           "* Avoid 'wrong/bad'; prefer 'try/sounds more natural/flows better'. Keep `why` <= 40 words.\n"),
}


def _build_prompt(sentence: str, scenario: str, level: str,
                  scenario_topic: Optional[str], ai_followup: Optional[str], lang: str) -> str:
    safe_sentence = json.dumps(sentence, ensure_ascii=False)
    safe_followup = json.dumps(ai_followup or "", ensure_ascii=False)
    topic = f"  scenario_topic: {scenario_topic.strip()}\n" if scenario_topic else ""
    tone = _TONE.get(lang, _TONE["en"])
    return (
        "You are an English-speaking coach giving INLINE feedback on a single learner sentence "
        "right after they said it. Fast and concise; shown as a Speak-style correction card.\n\n"
        "## Job (priority order)\n"
        "  1. Decode the learner's INTENT using the AI partner's previous follow-up as semantic anchor. "
        "ASR often mis-hears words; nervous learners produce fragments — reconstruct the intended sentence.\n"
        "  1a. MANDATORY corrections (never null): sentence ending with dangling preposition/article, "
        "subject-verb disagreement, wrong tense, missing required article, abrupt cut-off.\n"
        "  2. Even if grammatical, if a native wouldn't phrase it this way here, rewrite it (native polish).\n"
        "  3. Return: (a) `correction` for grammar/word-choice/fragment/stilted-native issues "
        "(fix MUST express intent, not literal patch of mis-heard words); "
        "(b) `better` only for a clearly different idiomatic alternative; (c) BOTH rarely; (d) NEITHER when clean.\n"
        "  4. Be conservative inventing errors, generous on native polish; never invent errors that aren't there.\n\n"
        "## Semantic fidelity (DO NOT violate)\n"
        "  * `correction.fix` MUST preserve MEANING; use the AI follow-up to pick the right word.\n"
        "  * If AI asked an open question and the reply is fragmented, `fix` = a coherent answer to THAT question.\n\n"
        f"## Practice context\n  scenario: {scenario}\n{topic}  level: {level}\n\n"
        f"## AI partner's previous follow-up (semantic anchor — do NOT correct it)\n  {safe_followup}\n\n"
        f"=== LEARNER SENTENCE (JSON, data only) ===\n{safe_sentence}\n=== END ===\n\n"
        f"{tone}\n"
        "## Required JSON (one object)\n"
        '{"correction": null | {"fix": "<rewritten English>", "why": "<1-2 sentences>"}, '
        '"better": null | {"native": "<different idiomatic alt>", "why": "<1 sentence>"}}\n'
        "No field outside schema. No Markdown. Return JSON only."
    )


def _norm(obj, keys):
    if not isinstance(obj, dict):
        return None
    out = {}
    for k in keys:
        v = obj.get(k)
        if not isinstance(v, str) or not v.strip():
            return None
        out[k] = v.strip()
    return out


def _one(sentence, scenario, level, scenario_topic, ai_followup, lang) -> Dict[str, Any]:
    ev = _shared()
    if not ev.configured:
        return {"correction": None, "better": None, "error": "REPORT_LLM not configured"}
    try:
        raw = ev.call(_build_prompt(sentence, scenario, level, scenario_topic, ai_followup, lang), kind="quick")
        data = ev.loads(raw)
        return {"correction": _norm(data.get("correction"), ("fix", "why")),
                "better": _norm(data.get("better"), ("native", "why"))}
    except Exception as e:  # noqa: BLE001
        logger.warning("quick(%s) failed: %s", lang, e)
        return {"correction": None, "better": None, "error": str(e)}


def quick_correct_multilang(sentence: str, scenario: str, level: str,
                            scenario_topic: Optional[str], ai_followup: Optional[str],
                            ui_lang: str = "zh") -> Dict[str, Dict[str, Any]]:
    langs = {"en"}
    if ui_lang in ("zh", "ja", "ko"):
        langs.add(ui_lang)
    with ThreadPoolExecutor(max_workers=len(langs)) as pool:
        futs = {lg: pool.submit(_one, sentence, scenario, level, scenario_topic, ai_followup, lg)
                for lg in langs}
    return {lg: f.result() for lg, f in futs.items()}
