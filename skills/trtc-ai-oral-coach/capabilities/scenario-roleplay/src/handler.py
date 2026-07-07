# -*- coding: utf-8 -*-
"""handler.py —— /action facade 的 GetSceneCandidates 处理。

历史说明：这里原来是 generate_scene()（对应 Setup 屏 🎲 随机按钮），参考 UI 从未提供
对应的按钮/输入框，是纯死代码，已随 manifest.yaml 的 /api/v1/scene/generate 端点一起移除。
"""
from __future__ import annotations

from typing import Any, Dict

from .compose import resolve_style, _enum, LEVELS
from .scenario_source import get_scenario_candidates
from .defaults import SCENARIO_PROMPTS

CANDIDATE_SCENARIOS = set(SCENARIO_PROMPTS.keys()) | {"daily"}


def get_scene_candidates(body: Dict[str, Any]) -> Dict[str, Any]:
    """
    body = { Scenario, Level }

    返回:
        { "Candidates": [{ id, topic, hint, opening, aiRole, myRole }, ...] }
        Candidates 可能为空数组（题库/KB 均无候选时），前端应自行兜底文案。
    """
    scenario = _enum(body.get("Scenario"), CANDIDATE_SCENARIOS, "free")
    level    = _enum(body.get("Level"), LEVELS, "intermediate")
    candidates = get_scenario_candidates(scenario, level)
    return {"Candidates": candidates}
