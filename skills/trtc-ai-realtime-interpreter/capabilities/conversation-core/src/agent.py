# -*- coding: utf-8 -*-
"""会话编排（骨架层）：拉起一路 Conversational AI 并管理其生命周期。

设计原则：
  - 骨架只知道「给一个 room_id + target_user_id + 启动参数，起停一路会话」这件事，
    不知道「会议」「参会人」「房主」「翻译语言对」这些概念——这些留给上层业务能力包
    （realtime-translation / meeting-ops）通过参数传入或组合调用。
  - room_id 由调用方传入（可能来自我们自己签发，也可能来自调用方已有的会议/直播系统），
    骨架不强制自己生成房间。
  - 每次 start() 都会生成一个独立的 agent 身份（bot UserId + UserSig），互不冲突，
    支持同一房间起多路会话（meeting-ops 扇出场景）。
"""
from __future__ import annotations

import logging
import secrets
import time
from dataclasses import dataclass, field
from threading import RLock
from typing import Any, Dict, Optional

from credentials import Credentials
from trtc_client import AgentLifecycleConfig, TrtcConversationClient
from usersig import gen_user_sig

logger = logging.getLogger(__name__)


@dataclass
class SessionInfo:
    session_id: str
    room_id: str
    room_id_type: int
    target_user_id: str
    agent_user_id: str
    agent_user_sig: str
    task_id: Optional[str] = None
    request_id: Optional[str] = None
    started_at: float = field(default_factory=time.time)


class ConversationAgent:
    """单路会话管理器（骨架层，无业务逻辑）。"""

    def __init__(self, credentials: Credentials) -> None:
        if not credentials.fully_configured:
            raise ValueError(
                f"credentials missing: {credentials.missing()}; "
                "请先在 .env 里配好三把钥匙（TRTC / 腾讯云 / LLM）"
            )
        self._cred = credentials
        self._client = TrtcConversationClient(
            tencent=credentials.tencent_cloud, trtc=credentials.trtc, llm=credentials.llm,
        )
        self._sessions: Dict[str, SessionInfo] = {}
        self._lock = RLock()

    # ------------------------------------------------------------------
    # 身份签发：任意 user_id 换一个 UserSig（供旁听客户端等通用场景使用）
    # ------------------------------------------------------------------
    def issue_user_sig(self, user_id: str) -> str:
        return gen_user_sig(
            sdk_app_id=self._cred.trtc.sdk_app_id,
            sdk_secret_key=self._cred.trtc.sdk_secret_key,
            user_id=user_id,
        )

    @property
    def sdk_app_id(self) -> int:
        return self._cred.trtc.sdk_app_id

    # ------------------------------------------------------------------
    # 起一路会话：room_id 由调用方给定（可能是我们签发，也可能是调用方已有房间）
    # ------------------------------------------------------------------
    def start(
        self,
        room_id: str,
        target_user_id: str,
        config: Optional[AgentLifecycleConfig] = None,
        room_id_type: int = 0,
        agent_user_id: Optional[str] = None,
    ) -> SessionInfo:
        agent_uid = (agent_user_id or f"ai_{secrets.token_hex(6)}")[:32]
        agent_sig = self.issue_user_sig(agent_uid)
        sid = secrets.token_urlsafe(12)

        result = self._client.start(
            room_id=room_id,
            agent_user_id=agent_uid,
            agent_user_sig=agent_sig,
            target_user_id=target_user_id,
            config=config,
            room_id_type=room_id_type,
        )
        info = SessionInfo(
            session_id=sid,
            room_id=str(room_id),
            room_id_type=room_id_type,
            target_user_id=target_user_id,
            agent_user_id=agent_uid,
            agent_user_sig=agent_sig,
            task_id=result.get("task_id"),
            request_id=result.get("request_id"),
        )
        with self._lock:
            self._sessions[sid] = info
        logger.info("session started: session=%s room=%s target=%s task=%s", sid, room_id, target_user_id, info.task_id)
        return info

    def stop(self, session_id: str) -> None:
        info = self._require_session(session_id)
        if info.task_id:
            self._client.stop(info.task_id)
        with self._lock:
            self._sessions.pop(session_id, None)
        logger.info("session stopped: session=%s task=%s", session_id, info.task_id)

    def control(self, session_id: str, text: str, interrupt: bool = True) -> Dict[str, Any]:
        info = self._require_session(session_id)
        if not info.task_id:
            raise RuntimeError("session has no active task")
        if not text or not text.strip():
            raise ValueError("text cannot be empty")
        return self._client.control(task_id=info.task_id, command="ServerPushText", text=text, interrupt=interrupt)

    def get_session(self, session_id: str) -> Optional[SessionInfo]:
        with self._lock:
            return self._sessions.get(session_id)

    def list_sessions(self) -> Dict[str, Any]:
        with self._lock:
            return {
                "sessions": [
                    {
                        "session_id": s.session_id,
                        "room_id": s.room_id,
                        "target_user_id": s.target_user_id,
                        "agent_user_id": s.agent_user_id,
                        "task_id": s.task_id,
                        "started_at": s.started_at,
                    }
                    for s in self._sessions.values()
                ]
            }

    def _require_session(self, session_id: str) -> SessionInfo:
        if not session_id:
            raise ValueError("session_id is required")
        with self._lock:
            info = self._sessions.get(session_id)
        if not info:
            raise ValueError(f"session not found: {session_id}")
        return info
