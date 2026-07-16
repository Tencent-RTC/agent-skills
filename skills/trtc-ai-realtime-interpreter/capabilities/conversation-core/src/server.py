# -*- coding: utf-8 -*-
"""FastAPI 入口：骨架 REST API + 能力包路由挂载 + 静态 Web Demo 托管。

骨架路由：
  GET  /api/v1/health          —— 三把钥匙连通性自检
  POST /api/v1/usersig         —— 给任意 user_id 签发 UserSig（通用工具，供旁听/多身份场景使用）
  POST /api/v1/agent/start     —— 起一路 Conversational AI 会话（单目标）
  POST /api/v1/agent/stop      —— 停一路会话
  POST /api/v1/agent/control   —— 文本注入 / 打断
  GET  /api/v1/sessions        —— 内存态会话列表（调试用）
  GET  /                       —— Web Demo 静态页

设计原则：
  - 骨架只做协议编排，不内置任何行业 prompt / 语言对 / 权限逻辑。
  - 通过 app.state.conversation_agent 把 Agent 单例暴露给能力包路由（比模块级单例更适合
    FastAPI 的依赖注入习惯，能力包路由用 `request.app.state.conversation_agent` 取用）。
  - 能力包路由通过 _capability_loader 动态加载，未安装时静默跳过，不影响骨架启动。
"""
from __future__ import annotations

import logging
import os
import sys
from pathlib import Path
from typing import Any, Dict, Optional

from dotenv import load_dotenv

_BASE_DIR = Path(__file__).resolve().parent.parent  # capabilities/conversation-core/
_SRC_DIR = Path(__file__).resolve().parent
if str(_SRC_DIR) not in sys.path:
    sys.path.insert(0, str(_SRC_DIR))

load_dotenv(_BASE_DIR / ".env.local")
load_dotenv(_BASE_DIR / ".env")

from fastapi import APIRouter, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from agent import ConversationAgent
from credentials import load_from_env
from health import check_all
from log_filter import install_redacting_filter
from trtc_client import AgentLifecycleConfig

logger = logging.getLogger("conversation_core")
logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"), format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
install_redacting_filter(logging.getLogger())

_credentials = load_from_env()
_agent: Optional[ConversationAgent] = None
_init_error: Optional[str] = None
try:
    _agent = ConversationAgent(_credentials)
    logger.info("ConversationAgent initialized")
except Exception as exc:  # noqa: BLE001
    _init_error = str(exc)
    logger.warning("ConversationAgent not initialized: %s", _init_error)


# ---------------------------------------------------------------------------
# Pydantic Models
# ---------------------------------------------------------------------------
class UserSigRequest(BaseModel):
    user_id: str


class AgentStartRequest(BaseModel):
    room_id: str
    room_id_type: int = 0
    target_user_id: str
    agent_user_id: Optional[str] = None
    instructions: Optional[str] = None
    greeting: Optional[str] = None
    language: Optional[str] = "zh"
    voice_id: Optional[str] = None
    max_idle_time: Optional[int] = 60


class AgentStopRequest(BaseModel):
    session_id: str


class ControlRequest(BaseModel):
    session_id: str
    text: str
    interrupt: bool = True


# ---------------------------------------------------------------------------
# FastAPI App
# ---------------------------------------------------------------------------
app = FastAPI(
    title="conversation-core",
    version="1.0.0",
    description="TRTC Conversational AI 通用骨架（拉起单路会话并连通，无行业假设）",
)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])

# 把 Agent 单例挂到 app.state，供能力包路由通过 request.app.state.conversation_agent 取用
app.state.conversation_agent = _agent
app.state.credentials = _credentials

api = APIRouter(prefix="/api/v1")


def _to_http_error(exc: Exception) -> HTTPException:
    if isinstance(exc, ValueError):
        return HTTPException(status_code=400, detail=str(exc))
    if isinstance(exc, RuntimeError):
        return HTTPException(status_code=500, detail=str(exc))
    return HTTPException(status_code=500, detail=f"internal: {exc}")


def require_agent(request: Request) -> ConversationAgent:
    """能力包路由可直接复用这个依赖函数：request.app.state.conversation_agent。"""
    agent = getattr(request.app.state, "conversation_agent", None)
    if agent is None:
        raise HTTPException(
            status_code=503,
            detail={
                "code": "credentials_missing",
                "message": _init_error or "credentials not configured",
                "hint": "在 .env 里配好三把钥匙（TRTC / 腾讯云 / LLM）后重启",
            },
        )
    return agent


# ---------------------------------------------------------------------------
# Health
# ---------------------------------------------------------------------------
@api.get("/health")
def health() -> Dict[str, Any]:
    cred = load_from_env()
    tc, trtc, llm = check_all(cred.tencent_cloud, cred.trtc, cred.llm)
    overall = "ok" if tc.ok and trtc.ok and llm.ok else "partial_failure"
    return {
        "status": overall,
        "checks": {"tencent_cloud": tc.to_dict(), "trtc": trtc.to_dict(), "llm": llm.to_dict()},
        "configured": cred.fully_configured,
        "missing": cred.missing(),
    }


# ---------------------------------------------------------------------------
# UserSig（通用签发，供旁听客户端 / 多身份场景使用）
# ---------------------------------------------------------------------------
@api.post("/usersig")
def issue_usersig(req: UserSigRequest, request: Request) -> Dict[str, Any]:
    agent = require_agent(request)
    if not req.user_id or not req.user_id.strip():
        raise HTTPException(status_code=400, detail="user_id is required")
    user_id = req.user_id.strip()[:32]
    sig = agent.issue_user_sig(user_id)
    return {"sdk_app_id": agent.sdk_app_id, "user_id": user_id, "user_sig": sig}


# ---------------------------------------------------------------------------
# 单路会话生命周期
# ---------------------------------------------------------------------------
@api.post("/agent/start")
def agent_start(req: AgentStartRequest, request: Request) -> Dict[str, Any]:
    agent = require_agent(request)
    try:
        defaults = AgentLifecycleConfig()
        cfg = AgentLifecycleConfig(
            instructions=req.instructions or defaults.instructions,
            greeting=req.greeting or defaults.greeting,
            language=req.language or "zh",
            voice_id=req.voice_id or "",
            max_idle_time=req.max_idle_time or 60,
        )
        info = agent.start(
            room_id=req.room_id,
            target_user_id=req.target_user_id,
            config=cfg,
            room_id_type=req.room_id_type,
            agent_user_id=req.agent_user_id,
        )
        return {
            "code": 0, "msg": "success",
            "data": {
                "session_id": info.session_id, "task_id": info.task_id, "request_id": info.request_id,
                "agent_user_id": info.agent_user_id, "status": "started",
            },
        }
    except Exception as exc:  # noqa: BLE001
        raise _to_http_error(exc)


@api.post("/agent/stop")
def agent_stop(req: AgentStopRequest, request: Request) -> Dict[str, Any]:
    agent = require_agent(request)
    try:
        agent.stop(req.session_id)
        return {"code": 0, "msg": "success", "data": {"session_id": req.session_id, "status": "stopped"}}
    except Exception as exc:  # noqa: BLE001
        raise _to_http_error(exc)


@api.post("/agent/control")
def agent_control(req: ControlRequest, request: Request) -> Dict[str, Any]:
    agent = require_agent(request)
    try:
        return {"code": 0, "msg": "success", "data": agent.control(req.session_id, req.text, req.interrupt)}
    except Exception as exc:  # noqa: BLE001
        raise _to_http_error(exc)


@api.get("/sessions")
def sessions_list(request: Request) -> Dict[str, Any]:
    agent = require_agent(request)
    return {"code": 0, "data": agent.list_sessions()}


app.include_router(api)

# ---------------------------------------------------------------------------
# 能力包路由挂载（可选；动态加载，未安装时静默跳过）
# ---------------------------------------------------------------------------
from _capability_loader import try_load_capability as _try_load_capability  # noqa: E402

# [realtime-translation] 挂子路由
_rt_router_mod = _try_load_capability("realtime-translation", "src/router.py")
if _rt_router_mod is not None and hasattr(_rt_router_mod, "router"):
    app.include_router(_rt_router_mod.router, prefix="/api/v1/translation", tags=["realtime-translation"])

# [meeting-ops] 挂子路由
_mo_router_mod = _try_load_capability("meeting-ops", "src/router.py")
if _mo_router_mod is not None and hasattr(_mo_router_mod, "router"):
    app.include_router(_mo_router_mod.router, prefix="/api/v1/meeting", tags=["meeting-ops"])


# ---------------------------------------------------------------------------
# 静态前端：可用 WEB_DEMO_DIR 覆盖（Path A 场景层会把它指向自己的 UI 构建产物）
# ---------------------------------------------------------------------------
_DEMO_DIR = Path(os.getenv("WEB_DEMO_DIR", str(_BASE_DIR / "web-demo")))
if _DEMO_DIR.exists():
    app.mount("/static", StaticFiles(directory=str(_DEMO_DIR), html=True), name="static")

    @app.get("/")
    def index() -> FileResponse:
        return FileResponse(str(_DEMO_DIR / "index.html"))


def main() -> None:
    import uvicorn

    port = int(os.getenv("PORT", "8020"))
    host = os.getenv("HOST", "0.0.0.0")
    cert_file = _BASE_DIR.parent.parent / "cert.pem"
    key_file = _BASE_DIR.parent.parent / "key.pem"
    if cert_file.exists() and key_file.exists():
        logger.info("Starting HTTPS server (cert=%s)", cert_file)
        uvicorn.run(app, host=host, port=port, ssl_certfile=str(cert_file), ssl_keyfile=str(key_file))
    else:
        logger.info("Starting HTTP server (no cert.pem/key.pem found)")
        uvicorn.run(app, host=host, port=port)


if __name__ == "__main__":
    main()
