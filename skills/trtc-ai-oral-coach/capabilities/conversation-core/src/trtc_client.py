# -*- coding: utf-8 -*-
"""TRTC OpenAPI 客户端封装：Start / Stop / Control AI Conversation。

只做协议编排，不含任何业务 prompt（业务在 scenario-roleplay 能力里组装好后传入）。
"""
from __future__ import annotations

import json
from typing import Any, Dict, Optional

from tencentcloud.common import credential
from tencentcloud.common.profile.client_profile import ClientProfile
from tencentcloud.common.profile.http_profile import HttpProfile
from tencentcloud.trtc.v20190722 import trtc_client, models

from .config import CoreConfig


class TRTCClient:
    def __init__(self, cfg: CoreConfig) -> None:
        self._cfg = cfg
        cred = credential.Credential(cfg.tencent.secret_id, cfg.tencent.secret_key)
        http = HttpProfile()
        http.endpoint = cfg.trtc.endpoint
        cp = ClientProfile()
        cp.httpProfile = http
        self._api = trtc_client.TrtcClient(cred, cfg.trtc.api_region, cp)

    def start(self, params: Dict[str, Any]) -> Dict[str, Any]:
        req = models.StartAIConversationRequest()
        req.from_json_string(json.dumps(params, ensure_ascii=False))
        resp = self._api.StartAIConversation(req)
        return json.loads(resp.to_json_string())

    def stop(self, task_id: str) -> Dict[str, Any]:
        req = models.StopAIConversationRequest()
        req.from_json_string(json.dumps({"TaskId": task_id}))
        try:
            resp = self._api.StopAIConversation(req)
            return json.loads(resp.to_json_string())
        except Exception as e:  # noqa: BLE001
            if "TaskNotExist" in str(e):
                return {"RequestId": "N/A", "message": "Task already stopped"}
            raise

    def control(self, task_id: str, command: str, text: str,
                interrupt: bool = True, stop_after_play: bool = False,
                add_history: bool = True, priority: int = 0) -> Dict[str, Any]:
        """
        !!! 关键修复 !!!
        ControlAIConversation 的 Command 与子对象是按 Command 值互斥的：
          Command="ServerPushText" → 必须配 "ServerPushText": {Text, Interrupt, AddHistory, Priority, StopAfterPlay}
          Command="InvokeLLM"      → 必须配 "InvokeLLM":      {Content, Interrupt, ExperimentalParams}
        之前这里不管 command 是什么，payload 永远塞进 "ServerPushText"（且用 "Text" 而不是
        "Content"）——Command=InvokeLLM 时 TRTC 服务端根本不会去读 ServerPushText 这个键，
        等于 push-to-talk 场景下用户的原话从来没有真正传给大模型，AI 只能在没拿到这轮新发
        言的情况下瞎凑一句延续对话（"答非所问/编造内容"的根本原因）。
        """
        if command == "InvokeLLM":
            params = {
                "TaskId":  task_id,
                "Command": "InvokeLLM",
                "InvokeLLM": {
                    "Content":   text,
                    "Interrupt": interrupt,
                },
            }
        else:
            push = {
                "Text":        text,
                "Interrupt":   interrupt,
                "AddHistory":  add_history,
                "Priority":    priority,
            }
            if stop_after_play:
                push["StopAfterPlay"] = True
            params = {"TaskId": task_id, "Command": command, "ServerPushText": push}
        req = models.ControlAIConversationRequest()
        req.from_json_string(json.dumps(params, ensure_ascii=False))
        try:
            resp = self._api.ControlAIConversation(req)
            return json.loads(resp.to_json_string())
        except Exception as e:  # noqa: BLE001
            if "TaskNotExist" in str(e):
                return {"RequestId": "N/A", "message": "Task already ended"}
            raise
