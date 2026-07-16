# -*- coding: utf-8 -*-
"""扇出编排器：给定一组 targetUserId，批量起停 conversation-core 会话 + 维护房间级状态。

职责边界（务必保持纯粹）：
  - 只知道"批量起停会话 + 记住这个房间当前跑的是什么"，不知道"翻译""客服""会议纪要"
    这些具体业务是什么 —— 具体业务能力包通过 `capability` 参数指定，本模块用
    conversation-core 的 _capability_loader 动态加载该能力包的 `build_lifecycle_config`
    约定函数（每个业务能力包都应该在自己的 service.py 里实现这个函数签名，参见
    realtime-translation/src/service.py 的 build_lifecycle_config）。
  - **完全不做权限校验**。"谁能调用扇出接口"是集成方自己业务系统的职责——本能力包
    只是一个特权编排原语，调用方（比如 Path A 场景层的会议室 demo，或 Path B 集成方
    自己的后端）必须在转发到这里之前，自行完成"调用者是否有权限触发"的校验。
    参见 manifest.yaml 的安全声明与 README。

状态存储：内存字典，demo/中小规模场景够用；生产场景如需持久化，由集成方自己接管
（比如换成 Redis），本能力包不内置持久化适配。
"""
from __future__ import annotations

import logging
import sys
from pathlib import Path
from threading import RLock
from typing import Any, Dict, List, Optional

_CORE_SRC = Path(__file__).resolve().parents[2] / "conversation-core" / "src"
if str(_CORE_SRC) not in sys.path:
    sys.path.insert(0, str(_CORE_SRC))

from agent import ConversationAgent  # noqa: E402
from _capability_loader import load_capability  # noqa: E402

logger = logging.getLogger(__name__)


class FanoutOrchestrator:
    """房间级扇出编排器（内存态，单进程内单例即可）。"""

    def __init__(self) -> None:
        self._rooms: Dict[str, Dict[str, Any]] = {}
        self._lock = RLock()

    # ------------------------------------------------------------------
    def start(
        self,
        agent: ConversationAgent,
        room_id: str,
        participants: List[str],
        capability: str,
        params: Dict[str, Any],
        room_id_type: int = 1,
        agent_user_id_prefix: str = "ai",
    ) -> Dict[str, Any]:
        """按参会人列表批量起会话。已有活跃扇出则先全部停掉再重开（幂等重启）。

        capability: 业务能力包目录名（如 "realtime-translation"），必须实现
                    `src/service.py` 里的 `build_lifecycle_config(params) -> AgentLifecycleConfig`。
        params:     原样传给该能力包的 build_lifecycle_config，本模块不关心内容。
        """
        existing = self._rooms.get(room_id)
        if existing:
            self._stop_tasks(agent, existing.get("tasks", []))

        service_mod = load_capability(capability, "src/service.py")
        if not hasattr(service_mod, "build_lifecycle_config"):
            raise ValueError(f"capability '{capability}' does not implement build_lifecycle_config(params)")

        tasks: List[Dict[str, str]] = []
        errors: List[Dict[str, str]] = []
        for idx, target_user_id in enumerate(participants):
            # 仅第一路播报欢迎语，避免多路 TTS 欢迎语在同一房间叠放
            local_params = dict(params)
            local_params.setdefault("suppress_welcome", idx != 0)
            cfg = service_mod.build_lifecycle_config(local_params)
            agent_uid = f"{agent_user_id_prefix}_{target_user_id[:16]}"[:32]
            try:
                info = agent.start(
                    room_id=room_id,
                    target_user_id=target_user_id,
                    config=cfg,
                    room_id_type=room_id_type,
                    agent_user_id=agent_uid,
                )
                tasks.append({
                    "session_id": info.session_id,
                    "task_id": info.task_id or "",
                    "agent_user_id": info.agent_user_id,
                    "target_user_id": target_user_id,
                })
            except Exception as exc:  # noqa: BLE001
                logger.error("fan-out start failed for target=%s: %s", target_user_id, exc)
                errors.append({"target_user_id": target_user_id, "error": str(exc)})

        # 全部失败时抛异常，让调用方（scenario backend）返回错误响应给前端
        if not tasks and errors:
            error_details = "; ".join(f"{e['target_user_id']}: {e['error']}" for e in errors)
            raise RuntimeError(f"所有翻译会话启动均失败（{len(errors)}路全败）: {error_details}")

        with self._lock:
            self._rooms[room_id] = {"capability": capability, "params": params, "tasks": tasks}
        logger.info("fanout started room=%s capability=%s tasks=%d", room_id, capability, len(tasks))
        return {
            "active": True,
            "capability": capability,
            "params": params,
            "bots": [{"agentUserId": t["agent_user_id"], "targetUserId": t["target_user_id"]} for t in tasks],
        }

    # ------------------------------------------------------------------
    def stop(self, agent: ConversationAgent, room_id: str) -> int:
        with self._lock:
            room = self._rooms.pop(room_id, None)
        if not room:
            return 0
        return self._stop_tasks(agent, room.get("tasks", []))

    def _stop_tasks(self, agent: ConversationAgent, tasks: List[Dict[str, str]]) -> int:
        stopped = 0
        for t in tasks:
            try:
                agent.stop(t["session_id"])
                stopped += 1
            except Exception as exc:  # noqa: BLE001
                logger.warning("stop session %s failed: %s", t.get("session_id"), exc)
        return stopped

    # ------------------------------------------------------------------
    def state(self, room_id: str) -> Dict[str, Any]:
        with self._lock:
            room = self._rooms.get(room_id)
        if not room:
            return {"active": False, "capability": None, "params": {}, "bots": []}
        return {
            "active": True,
            "capability": room["capability"],
            "params": room["params"],
            "bots": [{"agentUserId": t["agent_user_id"], "targetUserId": t["target_user_id"]} for t in room.get("tasks", [])],
        }


# 单进程内共享单例（跟 conversation-core 的 Agent 单例模式一致）
_orchestrator: Optional[FanoutOrchestrator] = None


def get_orchestrator() -> FanoutOrchestrator:
    global _orchestrator
    if _orchestrator is None:
        _orchestrator = FanoutOrchestrator()
    return _orchestrator
