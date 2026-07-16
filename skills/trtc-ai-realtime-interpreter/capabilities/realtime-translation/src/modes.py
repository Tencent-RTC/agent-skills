# -*- coding: utf-8 -*-
"""实时翻译的语言对配置：STT 识别语种 + 翻译 system_prompt + TTS 音色。

这是「翻译」这件事本身的业务知识，跟会议/客服/直播场景无关——单目标场景
（比如给一个主播/客服配一个翻译）或多目标扇出场景（会议室）都复用同一套配置。

音色全部来自 TRTC 对话式 AI 内置 TTS 音色库（flow_01_turbo，trtc.io/document/79682），
全程闭环在 TRTC 生态内，不引入外部 TTS 服务。
"""
from __future__ import annotations

from typing import Any, Dict

_WELCOME_DEFAULT = (
    "Hello, I'm your AI interpreter. I'll translate everything you say in real-time. "
    "Please go ahead and speak."
)

MODE_CONFIG: Dict[str, Dict[str, Any]] = {
    "zh-en": {
        "source_label": "Chinese", "target_label": "English",
        "stt_language": "zh",
        "tts_voice": "v-female-p9Xy7Q1L",
        "welcome": _WELCOME_DEFAULT,
        "system_prompt": (
            "You are a professional real-time interpreter. "
            "The user may speak either Mandarin Chinese or English. "
            "Detect the language of each sentence and translate it into the OTHER language "
            "(Chinese -> English, English -> Chinese). "
            "Reply with ONLY the translation — no greetings, no explanations, "
            "no extra commentary, no quotation marks."
        ),
    },
    "zh-yue": {
        "source_label": "Chinese", "target_label": "Cantonese",
        "stt_language": "zh",
        "tts_voice": "v-female-k3P8sL0Q",
        "welcome": _WELCOME_DEFAULT,
        "system_prompt": (
            "You are a professional real-time interpreter. "
            "The user may speak either Mandarin Chinese or Cantonese. "
            "Detect the language of each sentence and translate it into the OTHER language "
            "(Mandarin -> Cantonese written form, Cantonese -> Mandarin). "
            "Reply with ONLY the translation — no greetings, no explanations, "
            "no extra commentary, no quotation marks."
        ),
    },
    "en-yue": {
        "source_label": "English", "target_label": "Cantonese",
        "stt_language": "en",
        "tts_voice": "v-female-k3P8sL0Q",
        "welcome": _WELCOME_DEFAULT,
        "system_prompt": (
            "You are a professional real-time interpreter. "
            "The user may speak either English or Cantonese. "
            "Detect the language of each sentence and translate it into the OTHER language "
            "(English -> Cantonese written form, Cantonese -> English). "
            "Reply with ONLY the translation — no greetings, no explanations, "
            "no extra commentary, no quotation marks."
        ),
    },
}


def list_modes() -> Dict[str, Dict[str, str]]:
    return {k: {"source_label": v["source_label"], "target_label": v["target_label"]} for k, v in MODE_CONFIG.items()}


def get_mode(mode_id: str) -> Dict[str, Any]:
    mode = MODE_CONFIG.get(mode_id)
    if not mode:
        raise ValueError(f"unknown mode_id: {mode_id!r}, available: {list(MODE_CONFIG.keys())}")
    return mode
