# -*- coding: utf-8 -*-
"""scenario_source.py —— Setup 屏"具体场景候选"的数据源路由。

  * 没装 / 没配 custom-learning-kb            → 直接读内置 data/practice-scenarios.json 题库
  * 装了且配了 custom-learning-kb             → 查 KB；片段若对齐契约格式直接解析（快路径，
                                                不调 LLM），否则批量丢给 LLM 提炼（自由文本兜底）
  * 任何环节失败 / 结果为空                    → 静默降级回内置题库，绝不让 Setup 屏卡住

候选统一 schema：{id, topic, hint, opening, aiRole, myRole}
  - opening 是硬性必需字段（用作 AI 开场白）；其余字段允许为空字符串（如 free 场景无固定角色）。

契约格式（可选，客户如果按此格式整理 KB 内容，可以省掉一次 LLM 调用）：
    Topic: <一句话主题>
    Hint: <检索/调试用的简短提示>
    Opening: <AI 的开场白，一句英文>
    AiRole: <AI 扮演的角色>
    MyRole: <学员扮演的角色>
"""
from __future__ import annotations

import json
import logging
import os
import re
from pathlib import Path
from typing import Any, Dict, List, Optional

logger = logging.getLogger("scenario-roleplay.scenario_source")

_CONTRACT_FIELD_PATTERNS = {
    "topic":   re.compile(r"^\s*Topic\s*[:：]\s*(.+)$", re.IGNORECASE | re.MULTILINE),
    "hint":    re.compile(r"^\s*Hint\s*[:：]\s*(.+)$", re.IGNORECASE | re.MULTILINE),
    "opening": re.compile(r"^\s*Opening\s*[:：]\s*(.+)$", re.IGNORECASE | re.MULTILINE),
    "aiRole":  re.compile(r"^\s*AiRole\s*[:：]\s*(.+)$", re.IGNORECASE | re.MULTILINE),
    "myRole":  re.compile(r"^\s*MyRole\s*[:：]\s*(.+)$", re.IGNORECASE | re.MULTILINE),
}

_BANK_PATH = Path(__file__).resolve().parent.parent / "data" / "practice-scenarios.json"
_bank_cache: Optional[dict] = None


def _load_bank() -> dict:
    global _bank_cache
    if _bank_cache is not None:
        return _bank_cache
    try:
        with open(_BANK_PATH, "r", encoding="utf-8") as f:
            _bank_cache = json.load(f)
    except Exception as exc:  # noqa: BLE001
        logger.error("failed to load practice-scenarios.json bank: %s", exc)
        _bank_cache = {}
    return _bank_cache


def get_mock_candidates(scenario: str, level: str) -> List[Dict[str, Any]]:
    """内置题库候选（practice-scenarios.json，已内含 aiRole/myRole，自洽的一组场景）。"""
    bank = _load_bank()
    slot = (bank.get(scenario) or {}).get(level)
    if not isinstance(slot, list):
        return []
    out = []
    for item in slot:
        if not isinstance(item, dict):
            continue
        opening = item.get("opening", "")
        if not opening:
            continue
        out.append({
            "id":      item.get("id", ""),
            "topic":   item.get("topic", ""),
            "hint":    item.get("hint", ""),
            "opening": opening,
            "aiRole":  item.get("aiRole", ""),
            "myRole":  item.get("myRole", ""),
        })
    return out


def _try_parse_contract_format(text: str) -> Optional[Dict[str, str]]:
    """尝试用约定的 key-value 契约格式解析；全部 5 个字段都命中才算成功，否则交给 LLM 兜底。"""
    if not isinstance(text, str) or not text.strip():
        return None
    fields: Dict[str, str] = {}
    for key, pattern in _CONTRACT_FIELD_PATTERNS.items():
        m = pattern.search(text)
        if not m:
            return None
        v = m.group(1).strip()
        if not v:
            return None
        fields[key] = v
    return fields


def _kb_client():
    """通过 cap_loader（conversation-core/_capability_loader.py 注册的全局别名）动态加载
    custom-learning-kb（未装/未配置则返回 None）。"""
    import cap_loader
    mod = cap_loader.try_load_capability("custom-learning-kb", "src/adapters/clients.py")
    if mod is None or not hasattr(mod, "get_client"):
        return None
    try:
        client = mod.get_client()
    except Exception as exc:  # noqa: BLE001
        logger.info("custom-learning-kb client init failed (skip KB path): %s", exc)
        return None
    return client


def get_kb_candidates(scenario: str, level: str, top_k: int = 3) -> Optional[List[Dict[str, Any]]]:
    """查 KB 并转换成候选场景列表；任何异常/空结果返回 None（由调用方降级回 mock）。"""
    client = _kb_client()
    if client is None:
        return None

    query = f"{scenario} scenario, {level} level English speaking practice topic"
    try:
        records = client.retrieve(query, top_k=top_k)
    except Exception as exc:  # noqa: BLE001
        logger.warning("ScenarioSource: KB retrieve failed: %s", exc)
        return None
    if not records:
        logger.info("ScenarioSource: KB returned 0 records")
        return None

    structured: List[Dict[str, Any]] = []
    freeform_texts: List[str] = []
    for rec in records:
        text = (rec.get("text") or "").strip()
        if not text:
            continue
        parsed = _try_parse_contract_format(text)
        if parsed:
            structured.append({"id": "", **parsed})
        else:
            freeform_texts.append(text)

    if freeform_texts:
        try:
            from .adapters.default import extract_scene_candidates
            structured.extend(extract_scene_candidates(freeform_texts, scenario, level))
        except Exception as exc:  # noqa: BLE001
            # LLM 提炼失败：不影响契约格式那部分已解析出的候选，整体不阻塞
            logger.warning("ScenarioSource: LLM extraction failed: %s", exc)

    if not structured:
        return None
    logger.info("ScenarioSource: KB produced %d candidates (contract=%d, freeform=%d)",
                len(structured), len(structured) - len(freeform_texts), len(freeform_texts))
    return structured


def get_scenario_candidates(scenario: str, level: str, top_k: Optional[int] = None) -> List[Dict[str, Any]]:
    """统一入口：没配 KB 走 mock；配了 KB 优先查 KB，任何环节失败都静默降级回 mock。"""
    if top_k is None:
        top_k = int(os.getenv("KB_TOP_K", "3") or 3)
    if _env_kb_enabled():
        candidates = get_kb_candidates(scenario, level, top_k=top_k)
        if candidates:
            return candidates
        logger.info("ScenarioSource: KB path unavailable, falling back to mock bank")
    return get_mock_candidates(scenario, level)


def _env_kb_enabled() -> bool:
    """粗略判断 custom-learning-kb 是否"看起来配置了"，避免每次都白跑一次 retrieve。

    真正是否能用最终仍由 get_kb_candidates 的异常处理兜底，这里只是一个快速短路判断。
    """
    adapter = (os.getenv("KB_ADAPTER") or "").strip().lower()
    if not adapter:
        return False
    if adapter == "dify":
        return bool(os.getenv("KB_DIFY_API_URL")) and bool(os.getenv("KB_DIFY_API_KEY"))
    if adapter == "coze":
        return bool(os.getenv("KB_COZE_API_KEY"))
    if adapter == "user_custom":
        return bool(os.getenv("KB_REST_BASE_URL"))
    return False
