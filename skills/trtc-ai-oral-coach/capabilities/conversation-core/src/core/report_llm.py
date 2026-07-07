# -*- coding: utf-8 -*-
"""共享评估基座（F1）—— 4 个评估能力（scenario-roleplay / quick-correct /
reply-suggestion / ability-report）复用的 LLM 客户端。

设计要点（沿用定稿 Demo coach_evaluator 的成熟策略）：
  - OpenAI 兼容 /chat/completions，response_format=json_object 强约束
  - 不同任务用不同 temperature / timeout（见 KIND_PROFILES）
  - 防 Prompt Injection：调用方拼 prompt 时用 json.dumps() 序列化用户内容
  - core 对**实时对话零 LLM**（那是 TRTC 云端）；本模块仅是给能力用的共享 utility

用法（能力侧 default adapter）：
    from ..._shared import get_evaluator          # 见各能力的加载封装
    ev = get_evaluator()
    raw = ev.call(prompt, kind="quick")           # 返回 LLM 文本（JSON 串）
"""
from __future__ import annotations

import json
import logging
from typing import Dict, Tuple

import requests

logger = logging.getLogger("report_llm")

# kind → (temperature 调整策略, read_timeout 上限, system_msg)
_CONNECT_TIMEOUT = 10.0
KIND_PROFILES = {
    "report":  ("base",  None, "You are a strict JSON-only English conversation coach producing learning reports."),
    "quick":   ("low",   15.0, "You are a strict JSON-only English-conversation coach producing Speak-style inline corrections."),
    "hints":   ("high",  15.0, "You are a strict JSON-only English-conversation coach producing short natural reply suggestions."),
    "scene":   ("higher",12.0, "You are a strict JSON-only assistant generating short vivid English-practice scene snippets."),
    "opening": ("mid",   12.0, "You are a strict JSON-only assistant writing one in-character English opening line."),
    # KB 场景素材批量提炼：要忠实原素材，创造力要求不高，timeout 稍长（一次处理多条）
    "kb_scene": ("low",  20.0, "You are a strict JSON-only assistant extracting structured English-practice "
                                "scene setups from a customer's own knowledge-base snippets."),
}


class ReportLLM:
    """共享 LLM 客户端。由 core 依据 .env REPORT_LLM_* 实例化后交给各能力。"""

    def __init__(self, api_key: str, api_url: str, model: str,
                 temperature: float = 0.2, timeout: float = 120.0) -> None:
        self.api_key = (api_key or "").strip()
        self.api_url = (api_url or "https://api.openai.com/v1/chat/completions").strip()
        self.model = (model or "gpt-4o-mini").strip()
        self.temperature = float(temperature)
        self.timeout = float(timeout)

    @property
    def configured(self) -> bool:
        return bool(self.api_key)

    def _temp_for(self, strategy: str) -> float:
        t = self.temperature
        return {
            "low":    min(0.2, t),
            "base":   t,
            "mid":    max(0.5, min(0.8, t + 0.3)),
            "high":   max(0.5, min(0.8, t + 0.4)),
            "higher": max(0.6, min(0.9, t + 0.5)),
        }.get(strategy, t)

    def call(self, prompt: str, kind: str = "report") -> str:
        """调用 LLM，返回 message.content（应为 JSON 串）。失败抛异常，由能力侧兜底。"""
        if not self.configured:
            raise RuntimeError("REPORT_LLM api_key is not configured")
        strategy, read_timeout, system_msg = KIND_PROFILES.get(kind, KIND_PROFILES["report"])
        timeout: Tuple[float, float] = (
            _CONNECT_TIMEOUT,
            min(read_timeout, self.timeout) if read_timeout else self.timeout,
        )
        payload = {
            "model": self.model,
            "messages": [
                {"role": "system", "content": system_msg},
                {"role": "user",   "content": prompt},
            ],
            "temperature":     self._temp_for(strategy),
            "response_format": {"type": "json_object"},
        }
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type":  "application/json",
        }
        resp = requests.post(self.api_url, headers=headers, json=payload, timeout=timeout)
        resp.raise_for_status()
        data = resp.json()
        try:
            return data["choices"][0]["message"]["content"]
        except (KeyError, IndexError, TypeError) as e:
            raise ValueError(f"unexpected LLM response shape: {e}; body={data}")

    @staticmethod
    def loads(raw: str) -> Dict:
        """JSON 解析辅助（能力侧统一用）。"""
        data = json.loads(raw)
        if not isinstance(data, dict):
            raise ValueError("top-level is not an object")
        return data


# ---- 单例：core 在 server 启动时用 .env 配置初始化后，能力通过 get_shared() 取用 ----
_shared: ReportLLM | None = None


def init_shared(api_key: str, api_url: str, model: str,
                temperature: float = 0.2, timeout: float = 120.0) -> ReportLLM:
    global _shared
    _shared = ReportLLM(api_key, api_url, model, temperature, timeout)
    return _shared


def get_shared() -> ReportLLM:
    """能力侧调用；若 core 尚未初始化则返回一个未配置实例（configured=False，能力自动降级）。"""
    global _shared
    if _shared is None:
        _shared = ReportLLM("", "", "gpt-4o-mini")
    return _shared


# ---------------------------------------------------------------------------
# 全局模块别名：让通过 _capability_loader 加载的各能力可直接 `import coach_report_llm`
# 取到 server.py 初始化后的**同一**单例（避免跨包 dual-import 导致的配置丢失）。
# ---------------------------------------------------------------------------
import sys as _sys
_sys.modules.setdefault("coach_report_llm", _sys.modules[__name__])

