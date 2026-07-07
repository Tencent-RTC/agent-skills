# -*- coding: utf-8 -*-
"""compose.py —— core 在 agent.start 时调用的组装入口。

对外契约（被 conversation-core/src/agent.py 通过 _capability_loader 调用）：
  * compose_prepare(body) -> {system_prompt, welcome, speed, voice_gender, welcome_source}
  * styles_metadata()     -> [{id, tone, strictness, voice_default}, ...]
"""
from __future__ import annotations

import logging
from typing import Any, Dict

from .defaults import (
    COACH_STYLES, LEVEL_PARAMS, SCENARIO_PROMPTS, SYSTEM_PROMPT_TEMPLATE,
    LEGACY_GOAL_TO_SCENARIO, LEGACY_PERSONA_TO_STYLE,
)

logger = logging.getLogger("scenario-roleplay")

SCENARIOS = set(SCENARIO_PROMPTS.keys())
LEVELS    = set(LEVEL_PARAMS.keys())
STYLES    = set(COACH_STYLES.keys())
GENDERS   = {"female", "male"}
DEFAULT_WELCOME = "Hi! I'm your AI English speaking partner. Ready to start? Let's warm up..."


def _enum(v, allowed, default):
    return v if isinstance(v, str) and v in allowed else default


def resolve_scenario(body: Dict[str, Any]) -> str:
    raw = body.get("Scenario")
    if isinstance(raw, str) and raw in SCENARIOS:
        return raw
    goal = body.get("Goal")
    if isinstance(goal, str):
        if goal == "ielts":
            raise ValueError("IELTS scenario retired")
        return LEGACY_GOAL_TO_SCENARIO.get(goal, "free")
    return "free"


def resolve_style(body: Dict[str, Any]) -> str:
    raw = body.get("Style")
    if isinstance(raw, str) and raw in STYLES:
        return raw
    persona = body.get("Persona")
    if isinstance(persona, str):
        return LEGACY_PERSONA_TO_STYLE.get(persona, "friend")
    return "friend"


def compose_system_prompt(scenario, level, style, scenario_topic=None,
                          ai_role=None, my_role=None, scene_description=None) -> str:
    sd = COACH_STYLES.get(style, COACH_STYLES["friend"])
    ld = LEVEL_PARAMS.get(level, LEVEL_PARAMS["intermediate"])
    st = SCENARIO_PROMPTS.get(scenario, SCENARIO_PROMPTS["free"])

    topic_line = ""
    if scenario_topic and scenario_topic.strip():
        topic_line = ("\nToday's specific scene: " + scenario_topic.strip() + ".\n"
                      "Stay anchored to this scene; only drift if the learner clearly takes the lead.")

    parts = []
    if ai_role and ai_role.strip():           parts.append(f"- You play: {ai_role.strip()}")
    if my_role and my_role.strip():           parts.append(f"- The learner plays: {my_role.strip()}")
    if scene_description and scene_description.strip():
        parts.append(f"- The scene: {scene_description.strip()}")
    if parts:
        topic_line = (topic_line or "") + (
            "\n\n# Role assignment (TAKES PRIORITY over the generic scenario above)\n"
            + "\n".join(parts)
            + "\n- STAY IN your assigned character throughout the conversation.\n"
              "- The FIRST message of this conversation (already sent, before the learner's\n"
              "  first reply) already opened the scene in character. From now on, this is an\n"
              "  ONGOING conversation — READ the conversation history so far and react to what\n"
              "  the learner ACTUALLY just said. Do NOT re-introduce yourself or re-open the\n"
              "  scene again; that would sound like you forgot the conversation already started.\n"
              "- IMPORTANT — what \"The learner plays\" means: it ONLY tells you the learner's\n"
              "  POSITION/IDENTITY in the scene (e.g. who they are). It is NOT something the\n"
              "  learner has already said, and it is NOT their opinion, feeling, or decision.\n"
              "  Do NOT assume the learner already holds any stance implied by that label — the\n"
              "  learner is a real person typing their own live responses. If their actual words\n"
              "  contradict or ignore what the label suggests, ALWAYS follow their actual words,\n"
              "  never the label. Do not steer the conversation back to a 'script' the label\n"
              "  might hint at — just answer what they literally asked or said, in character.\n"
              "- Do NOT break character to comment on grammar; the report handles that."
        )

    return SYSTEM_PROMPT_TEMPLATE.format(
        style_tone=sd.get("tone", ""),
        style_directives=(sd.get("style_directives") or "- (default)").strip(),
        scenario_prompt=st.strip(),
        scenario_topic_line=topic_line,
        level=level, speed=ld["speed"], vocab=ld["vocab"], followup_depth=ld["followup_depth"],
    )


def _tts_speed(level: str, style: str) -> float:
    base = float(LEVEL_PARAMS.get(level, LEVEL_PARAMS["intermediate"])["speed"])
    mod = float(COACH_STYLES.get(style, COACH_STYLES["friend"]).get("speed_modifier", 1.0))
    return max(0.5, min(2.0, base * mod))


def compose_prepare(body: Dict[str, Any]) -> Dict[str, Any]:
    """core 调用：组装 system_prompt / welcome / 语速 / 音色性别。

    AiRole/MyRole/SceneDescription/OpeningQuestion 均来自 Setup 屏的场景候选
    （GetSceneCandidates：没配 KB → 内置题库；配了 KB → 查询/提炼），candidate 本身
    已经保证 opening 与 aiRole/myRole 自洽，因此这里直接原样使用，不需要再实时调 LLM
    生成开场白（历史上这里有一条"用户手动定制场景 → 调 LLM 生成开场白"的分支，但参考
    UI 从未提供手动编辑入口，是死代码，已移除）。
    """
    scenario = resolve_scenario(body)
    level    = _enum(body.get("Level"), LEVELS, "intermediate")
    style    = resolve_style(body)
    gender   = _enum(body.get("Voice"), GENDERS,
                     COACH_STYLES[style].get("voice_default", "female"))
    scenario_topic = (body.get("ScenarioTopic") or "").strip() or None
    ai_role   = (body.get("AiRole") or "").strip()[:200] or None
    my_role   = (body.get("MyRole") or "").strip()[:200] or None
    scene     = (body.get("SceneDescription") or "").strip()[:240] or None
    opening   = (body.get("OpeningQuestion") or "").strip()

    system_prompt = compose_system_prompt(scenario, level, style, scenario_topic,
                                          ai_role, my_role, scene)
    welcome = opening or DEFAULT_WELCOME

    return {
        "system_prompt": system_prompt,
        "welcome": welcome,
        "speed": _tts_speed(level, style),
        "voice_gender": gender,
        "welcome_source": "candidate" if opening else "default",
    }


def styles_metadata():
    return [
        {"id": sid, "tone": s.get("tone", ""), "strictness": s.get("strictness", 0.5),
         "voice_default": s.get("voice_default", "female")}
        for sid, s in COACH_STYLES.items()
    ]
