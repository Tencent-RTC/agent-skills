# -*- coding: utf-8 -*-
"""实时翻译服务：把「翻译」这件事翻成 conversation-core 认得的启动参数。

对外提供两类接口：
  1. `build_lifecycle_config(params)` —— **约定接口**，meeting-ops 的扇出编排器会通过
     _capability_loader 动态加载本模块并调用这个函数，拿到 AgentLifecycleConfig 后自己去调
     conversation-core 起会话。这样 meeting-ops 完全不需要认识"翻译"这个概念，只认识
     "给我一个启动配置"这个约定。
  2. `start_translation(agent, ...)` —— 单目标场景的直接调用封装（配合 router.py 的
     HTTP 接口），给主播/客服配一个翻译时用，不涉及 meeting-ops。

welcome_message 的多路去重规则由调用方（router 或 meeting-ops）决定，本模块只提供
"第一路播报欢迎语，其余路静音"的可选参数，不擅自假设场景。
"""
from __future__ import annotations

import sys
from pathlib import Path
from typing import Any, Dict, Optional

_CORE_SRC = Path(__file__).resolve().parents[2] / "conversation-core" / "src"
if str(_CORE_SRC) not in sys.path:
    sys.path.insert(0, str(_CORE_SRC))

from agent import ConversationAgent, SessionInfo  # noqa: E402
from trtc_client import AgentLifecycleConfig  # noqa: E402

from modes import get_mode, list_modes  # noqa: E402

__all__ = ["build_lifecycle_config", "start_translation", "list_modes"]


def build_lifecycle_config(params: Dict[str, Any]) -> AgentLifecycleConfig:
    """约定接口：把 {mode, suppress_welcome?} 换成 AgentLifecycleConfig。

    被 meeting-ops 的扇出编排器动态调用（见 meeting-ops/src/fanout.py 里的
    `starter_capability` 约定），也被本模块自己的 start_translation() 复用。
    """
    mode_id = params.get("mode")
    if not mode_id:
        raise ValueError("params.mode is required")
    mode = get_mode(mode_id)
    suppress_welcome = bool(params.get("suppress_welcome", False))
    tts_enabled = bool(params.get("tts_enabled", True))
    return AgentLifecycleConfig(
        instructions=mode["system_prompt"],
        greeting=mode["welcome"],
        welcome_message="" if suppress_welcome else mode["welcome"],
        language=mode["stt_language"],
        voice_id=mode["tts_voice"],
        max_idle_time=int(params.get("max_idle_time", 60)),
        tts_enabled=tts_enabled,
    )


def start_translation(
    agent: ConversationAgent,
    room_id: str,
    target_user_id: str,
    mode: str,
    room_id_type: int = 0,
    agent_user_id: Optional[str] = None,
    suppress_welcome: bool = False,
) -> SessionInfo:
    """单目标翻译场景：给一个人（主播/客服/任意 target_user_id）配一路翻译。

    不涉及"参会人列表""房主"等会议概念——这些是 meeting-ops 的职责，本函数
    只管"起一路翻译会话"这一件事。
    """
    cfg = build_lifecycle_config({"mode": mode, "suppress_welcome": suppress_welcome})
    return agent.start(
        room_id=room_id,
        target_user_id=target_user_id,
        config=cfg,
        room_id_type=room_id_type,
        agent_user_id=agent_user_id,
    )
