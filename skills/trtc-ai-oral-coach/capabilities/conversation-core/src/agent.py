# -*- coding: utf-8 -*-
"""会话编排 —— 忠实移植定稿 Demo 的 join / start / stop / farewell / invoke 逻辑。

设计：
  * core 只做协议编排 + TRTC 调用；**实时对话零 LLM**。
  * system_prompt / welcome / 语速由 scenario-roleplay 能力组装（通过 _capability_loader
    动态加载 src/compose.py；未安装则用极简默认，保证光核心也能进房对话）。
  * push-to-talk（InvokeLLM）：用户点"结束说话"后手动触发 AI 回复。
"""
from __future__ import annotations

import logging
from typing import Any, Dict, Optional

from ._capability_loader import try_load_capability
from .config import CoreConfig
from .trtc_client import TRTCClient
from .usersig import sign_trio, gen_user_sig

logger = logging.getLogger("agent")

# ---- TRTC 协议级常量（与定稿 Demo 一致）----
TTS_VOICE_MAP = {
    ("en", "female"): "v-female-p9Xy7Q1L",
    ("en", "male"):   "v-male-A4b9KqP2",
    ("zh", "female"): "female-kefu-xiaoyue",
    ("zh", "male"):   "male-kefu-xiaoxu",
}
_EN_HOTWORDS = ",".join([
    "zero|11","one|11","two|11","three|11","four|11","five|11","six|11","seven|11",
    "eight|11","nine|11","ten|11","eleven|11","twelve|11",
    "first|10","second|10","third|10","fourth|10","fifth|10","once|10","twice|10",
    "um|11","uh|11","oh|11","hmm|11","ah|11","er|11","yeah|11","yep|11","nope|11",
    "okay|11","ok|11","like|10","well|10","so|10","right|10",
])
SCENARIOS = {"travel", "work", "study", "free"}
LEVELS    = {"beginner", "intermediate", "advanced"}
STYLES    = {"friend", "listener", "local"}
GENDERS   = {"female", "male"}

DEFAULT_WELCOME  = "Hi! I'm your AI English speaking partner. Ready to start? Let's warm up..."
DEFAULT_FAREWELL = {
    "en": "Great chat today! Let me put together your report...",
    "zh": "今天聊得不错！我来为你生成报告...",
}
DEFAULT_END_KEYWORDS = {
    "en": ["end practice", "stop practice", "i'm done", "that's enough", "finish session"],
    "zh": ["结束练习", "我练完了", "停止练习", "不练了"],
}


def _voice_id(lang: str, gender: str) -> str:
    key = (lang if lang in ("en", "zh") else "en",
           gender if gender in GENDERS else "female")
    return TTS_VOICE_MAP[key]


class Agent:
    def __init__(self, cfg: CoreConfig) -> None:
        self._cfg = cfg
        self._trtc = TRTCClient(cfg)

    # ------------------------------------------------------------------
    # join / config —— 签发三套 UserSig + 下发前端配置
    # ------------------------------------------------------------------
    def issue_config(self, user_id: str) -> Dict[str, Any]:
        if not user_id:
            raise ValueError("userid is required")
        sigs = sign_trio(self._cfg.trtc.sdk_app_id, self._cfg.trtc.sdk_secret_key, user_id)
        avatar_on = self._cfg.avatar_enabled()

        # 风格元数据由 scenario-roleplay 提供（未装 → 空列表）
        styles = []
        _sr = try_load_capability("scenario-roleplay", "src/compose.py")
        if _sr is not None and hasattr(_sr, "styles_metadata"):
            try:
                styles = _sr.styles_metadata()
            except Exception as exc:  # noqa: BLE001
                logger.warning("styles_metadata failed: %s", exc)

        return {
            "sdkappid":         sigs["sdkappid"],
            "userid":           sigs["user_id"],
            "usersig":          sigs["user_sig"],
            "robot_userid":     sigs["robot_user_id"],
            "robot_usersig":    sigs["robot_user_sig"],
            "avatar_userid":    sigs["avatar_user_id"] if avatar_on else "",
            "avatar_usersig":   sigs["avatar_user_sig"] if avatar_on else "",
            "avatar_available": avatar_on,
            "styles":           styles,
            "personas":         styles,   # 兼容别名
            "end_keywords":     DEFAULT_END_KEYWORDS,
            "farewell_message": DEFAULT_FAREWELL,
        }

    # ------------------------------------------------------------------
    # start —— 组装 prompt（scenario-roleplay）+ 调 TRTC StartAIConversation
    # ------------------------------------------------------------------
    def start(self, body: Dict[str, Any]) -> Dict[str, Any]:
        use_avatar = bool(body.get("UseAvatar", False)) and self._cfg.avatar_enabled()

        # === agent.compose_conversation 插座：scenario-roleplay 组装 ===
        prep = self._compose(body)
        system_prompt = prep["system_prompt"]
        welcome       = prep["welcome"]
        speed         = float(prep.get("speed", 1.0))
        gender        = prep.get("voice_gender", "female")

        user_cfg = body.get("UserConfig", {}) or {}
        interrupt_mode = int(user_cfg.get("InterruptMode", 1))
        interrupt_dur  = int(user_cfg.get("InterruptSpeechDuration", 600))
        vad_level      = int(user_cfg.get("VadLevel", 2))
        vad_silence    = int(user_cfg.get("VadSilenceTime", 1200))
        turn_mode      = int(user_cfg.get("TurnDetectionMode", 3))

        agent_cfg = {
            "UserId":                  body["AgentConfig"]["UserId"],
            "UserSig":                 body["AgentConfig"]["UserSig"],
            "TargetUserId":            body["AgentConfig"]["TargetUserId"],
            "MaxIdleTime":             60,
            "WelcomeMessage":          welcome,
            "WelcomeMessagePriority":  0,
            "TurnDetectionMode":       turn_mode,
            "TurnDetection":           {"SemanticEagerness": "auto"},
            "FilterOneWord":           False,
            "FilterBracketsContent":   4,   # 过滤 [FEEDBACK]/[FOLLOWUP] 标签不进 TTS/字幕
            "SubtitleMode":            0,   # 全量累积字幕（与前端 isAccumulative 匹配）
            "InterruptMode":           interrupt_mode,
            "InterruptSpeechDuration": interrupt_dur,
        }
        stt_cfg = {"Language": "en", "VadLevel": vad_level, "VadSilenceTime": vad_silence,
                   "HotWordList": _EN_HOTWORDS}

        import json as _json
        params = {
            "SdkAppId":   self._cfg.trtc.sdk_app_id,
            "RoomId":     str(body["RoomId"]),
            "RoomIdType": 0,
            "AgentConfig": agent_cfg,
            "STTConfig":   stt_cfg,
            "LLMConfig":   _json.dumps(self._cfg.llm_config_with_prompt(system_prompt), ensure_ascii=False),
        }
        if use_avatar:
            params["TTSConfig"] = _json.dumps({"TTSType": "dummy"}, ensure_ascii=False)
            avatar = self._cfg.avatar_config()
            params["AvatarConfig"] = _json.dumps({
                **avatar,
                "AvatarUserID":  body["AvatarConfig"]["AvatarUserID"],
                "DriverType":    1,
                "AvatarUserSig": body["AvatarConfig"]["AvatarUserSig"],
            }, ensure_ascii=False)
        else:
            params["TTSConfig"] = _json.dumps({
                "TTSType": "flow", "Model": "flow_01_turbo",
                "VoiceId": _voice_id("en", gender), "Language": "en",
                "Speed": max(0.5, min(2.0, speed)), "Volume": 1.0, "Pitch": 0,
            }, ensure_ascii=False)

        result = self._trtc.start(params)
        logger.info("StartAIConversation ok: TaskId=%s welcome_source=%s",
                    result.get("TaskId"), prep.get("welcome_source"))
        return result

    def _compose(self, body: Dict[str, Any]) -> Dict[str, Any]:
        """调 scenario-roleplay 组装；未安装则极简默认（保证光核心可对话）。"""
        _sr = try_load_capability("scenario-roleplay", "src/compose.py")
        if _sr is not None and hasattr(_sr, "compose_prepare"):
            try:
                return _sr.compose_prepare(body)
            except Exception as exc:  # noqa: BLE001
                logger.warning("scenario-roleplay compose failed, using default: %s", exc)
        opening = (body.get("OpeningQuestion") or "").strip() or DEFAULT_WELCOME
        return {
            "system_prompt": "You are a friendly AI English speaking partner. "
                             "Chat naturally in English and keep the conversation going.",
            "welcome": opening, "speed": 1.0, "voice_gender": "female",
            "welcome_source": "core-default",
        }

    # ------------------------------------------------------------------
    # stop / farewell / invoke
    # ------------------------------------------------------------------
    def stop(self, body: Dict[str, Any]) -> Dict[str, Any]:
        return self._trtc.stop(body["TaskId"])

    def farewell(self, body: Dict[str, Any]) -> Dict[str, Any]:
        lang = body.get("Lang", "en")
        text = body.get("FarewellText") or DEFAULT_FAREWELL.get(lang, DEFAULT_FAREWELL["en"])
        result = self._trtc.control(body["TaskId"], "ServerPushText", text,
                                    interrupt=True, stop_after_play=True)
        result["FarewellText"] = text
        return result

    def invoke(self, body: Dict[str, Any]) -> Dict[str, Any]:
        """push-to-talk：把缓存用户文本发给 AI 触发回复（空文本亦可，基于已有上下文）。"""
        text = (body.get("Text") or "").strip()
        return self._trtc.control(body["TaskId"], "InvokeLLM", text, interrupt=True)
