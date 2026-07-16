# -*- coding: utf-8 -*-
"""TRTC Conversational AI 控制面客户端（使用 tencentcloud-sdk-python 官方 SDK）。

封装 StartAIConversation / StopAIConversation / ControlAIConversation 三个接口。
骨架层只做「协议封装 + 密钥签名」，不内置任何 system_prompt / 语言对 / 行业知识——
这些由上层业务能力包（如 realtime-translation）通过 AgentLifecycleConfig 参数传入。

使用官方 SDK 而非手写 REST，确保请求格式与腾讯云服务端完全兼容
（手写 REST 在某些参数组合下可能触发 UserSig 校验异常）。
"""
from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from typing import Any, Dict, Optional

from tencentcloud.common import credential
from tencentcloud.common.profile.client_profile import ClientProfile
from tencentcloud.common.profile.http_profile import HttpProfile
from tencentcloud.trtc.v20190722 import trtc_client, models

from credentials import LlmCredential, TencentCloudCredential, TrtcCredential

logger = logging.getLogger(__name__)


@dataclass
class AgentLifecycleConfig:
    """单路会话的启动参数（业务无关；具体 system_prompt/语言对由上层能力包填入）。"""

    instructions: str = "You are a helpful voice assistant. Reply briefly."
    greeting: str = "Hello, how can I help you?"
    max_idle_time: int = 60
    welcome_message: str = ""
    language: str = "zh"           # STT 识别语种
    voice_id: str = ""             # 空 -> DEFAULT_VOICE_IDS 按 language 选取
    tts_model: str = "flow_01_turbo"
    tts_enabled: bool = True       # False 时跳过 TTSConfig（只有字幕，不播报语音）
    llm_extra: Dict[str, Any] = field(default_factory=dict)   # 额外透传给 LLMConfig 的字段（如 Temperature）


# TRTC FlowTTS 内置音色（trtc.io/document/79682）
DEFAULT_VOICE_IDS = {
    ("en", "female"): "v-female-p9Xy7Q1L",
    ("en", "male"): "v-male-A4b9KqP2",
    ("zh", "female"): "female-kefu-xiaoyue",
    ("zh", "male"): "male-kefu-xiaoxu",
}


class TrtcConversationClient:
    """TRTC Conversational AI 控制面的轻量封装（使用官方 SDK）。"""

    def __init__(self, tencent: TencentCloudCredential, trtc: TrtcCredential, llm: LlmCredential) -> None:
        if not tencent.configured:
            raise ValueError("tencent cloud credential not configured")
        if not trtc.configured:
            raise ValueError("trtc credential not configured")
        if not llm.configured:
            raise ValueError("llm credential not configured")
        self.tencent = tencent
        self.trtc = trtc
        self.llm = llm
        # 用官方 SDK 创建 client（跟原 demo translator_agent.py 完全一致的方式）
        cred = credential.Credential(tencent.secret_id, tencent.secret_key)
        http = HttpProfile()
        http.endpoint = trtc.trtc_endpoint
        cp = ClientProfile()
        cp.httpProfile = http
        self._api = trtc_client.TrtcClient(cred, trtc.trtc_region, cp)

    # ------------------------------------------------------------------
    # StartAIConversation
    # ------------------------------------------------------------------
    def start(
        self,
        room_id: str,
        agent_user_id: str,
        agent_user_sig: str,
        target_user_id: str,
        config: Optional[AgentLifecycleConfig] = None,
        room_id_type: int = 0,
    ) -> Dict[str, Any]:
        cfg = config or AgentLifecycleConfig()
        voice_id = cfg.voice_id or DEFAULT_VOICE_IDS.get((cfg.language, "female"), DEFAULT_VOICE_IDS[("en", "female")])

        llm_cfg: Dict[str, Any] = {
            "LLMType": self.llm.llm_type,
            "Model": self.llm.model,
            "APIKey": self.llm.api_key,
            "APIUrl": self.llm.api_url,
            "Streaming": True,
            "SystemPrompt": cfg.instructions,
            "History": 6,
            "Temperature": 0.2,
        }
        llm_cfg.update(cfg.llm_extra or {})

        # AgentConfig 参数对齐原 demo translator_agent.py（已验证跑通的参数组合）
        agent_cfg = {
            "UserId": agent_user_id,
            "UserSig": agent_user_sig,
            "TargetUserId": target_user_id,
            "MaxIdleTime": cfg.max_idle_time,
            "WelcomeMessage": cfg.welcome_message or cfg.greeting,
            "WelcomeMessagePriority": 1,      # 高优先级，欢迎语不会被打断
            "TurnDetectionMode": 0,           # 服务端检测一句话说完 -> 自动触发新一轮
            "InterruptMode": 0,
            "InterruptSpeechDuration": 500,
            "SubtitleMode": 0,                # 全量累积字幕
        }
        stt_cfg = {"Language": cfg.language}
        tts_cfg = {
            "TTSType": "flow",
            "VoiceId": voice_id,
            "Model": cfg.tts_model,
            "Speed": 2.0 if not cfg.tts_enabled else 1.0,
            "Volume": 0.001 if not cfg.tts_enabled else 1.0,
        }
        params = {
            "SdkAppId": self.trtc.sdk_app_id,
            "RoomId": str(room_id),
            "RoomIdType": room_id_type,
            "AgentConfig": agent_cfg,
            "STTConfig": stt_cfg,
            "LLMConfig": json.dumps(llm_cfg, ensure_ascii=False),
            "TTSConfig": json.dumps(tts_cfg, ensure_ascii=False),
        }

        logger.info(
            "StartAIConversation: endpoint=%s region=%s SdkAppId=%s RoomId=%s "
            "agent=%s target=%s userSig=%s...%s(len=%d) lang=%s voice=%s",
            self.trtc.trtc_endpoint, self.trtc.trtc_region, self.trtc.sdk_app_id,
            room_id, agent_user_id, target_user_id,
            agent_user_sig[:6], agent_user_sig[-4:], len(agent_user_sig),
            cfg.language, voice_id,
        )

        req = models.StartAIConversationRequest()
        req.from_json_string(json.dumps(params, ensure_ascii=False))
        try:
            resp = self._api.StartAIConversation(req)
        except Exception as exc:  # noqa: BLE001
            err_str = str(exc)
            if "UserSig" in err_str:
                raise RuntimeError(
                    f"TRTC UserSig 校验失败（{err_str}）。"
                    f"常见原因：TRTC_REGION 与应用所在站点不匹配"
                    f"（当前 region={self.trtc.region}, endpoint={self.trtc.trtc_endpoint}）。"
                    f"请检查 .env 中 TRTC_REGION：国际站应用用 intl。"
                ) from exc
            raise
        result = json.loads(resp.to_json_string())
        return {
            "task_id": result.get("TaskId"),
            "request_id": result.get("RequestId"),
        }

    # ------------------------------------------------------------------
    # StopAIConversation
    # ------------------------------------------------------------------
    def stop(self, task_id: str) -> None:
        if not task_id:
            raise ValueError("task_id is required")
        req = models.StopAIConversationRequest()
        req.from_json_string(json.dumps({"TaskId": task_id}))
        try:
            self._api.StopAIConversation(req)
        except Exception as exc:  # noqa: BLE001
            if "TaskNotExist" in str(exc):
                logger.info("StopAIConversation: task already stopped (%s)", task_id)
                return
            raise

    # ------------------------------------------------------------------
    # ControlAIConversation：文本注入 / 打断
    # ------------------------------------------------------------------
    def control(self, task_id: str, command: str, text: Optional[str] = None, interrupt: bool = True) -> Dict[str, Any]:
        if not task_id or not command:
            raise ValueError("task_id and command are required")
        payload: Dict[str, Any] = {"TaskId": task_id, "Command": command}
        if text is not None:
            payload["ServerPushText"] = {"Text": text, "Interrupt": interrupt}
        req = models.ControlAIConversationRequest()
        req.from_json_string(json.dumps(payload, ensure_ascii=False))
        resp = self._api.ControlAIConversation(req)
        return json.loads(resp.to_json_string())
