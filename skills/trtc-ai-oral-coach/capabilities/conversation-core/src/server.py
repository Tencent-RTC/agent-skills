# -*- coding: utf-8 -*-
"""FastAPI 入口：REST 路由（Path B）+ /action 兼容 facade（Path A 定稿 UI）+ 能力子路由挂载。

双轨（F2）：
  - REST：/api/v1/config|agent/start|stop|farewell|invoke|health（给 Path B 集成者）
  - facade：POST /action + Action 头（定稿 Demo 的 app.js 原样调用，零改动）
两者都走同一套 Agent 方法。

能力路由：用 try_load_capability 预接线（未安装的能力优雅跳过）。
"""
from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import Any, Dict, Optional

from fastapi import FastAPI, Request, APIRouter, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from .config import load_config
from .health import check_all
from .agent import Agent
from .core.report_llm import init_shared
from ._capability_loader import try_load_capability

logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"),
                    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
logger = logging.getLogger("server")

_cfg = load_config()
# 初始化共享评估基座（F1）—— 供 4 个评估能力复用
init_shared(_cfg.report_llm.api_key, _cfg.report_llm.api_url, _cfg.report_llm.model,
            _cfg.report_llm_temperature, _cfg.report_llm_timeout)

_agent: Optional[Agent] = None
_init_error: Optional[str] = None
try:
    if _cfg.trtc.configured and _cfg.tencent.configured:
        _agent = Agent(_cfg)
        logger.info("Agent initialized")
    else:
        _init_error = f"credentials missing: {_cfg.missing()}"
        logger.warning(_init_error)
except Exception as exc:  # noqa: BLE001
    _init_error = str(exc)
    logger.warning("Agent not initialized: %s", _init_error)


app = FastAPI(title="ai-oral-coach / conversation-core", version="1.0.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True,
                   allow_methods=["*"], allow_headers=["*"])

api = APIRouter(prefix="/api/v1")


def _require_agent() -> Agent:
    if _agent is None:
        raise HTTPException(status_code=503, detail={
            "code": "credentials_missing",
            "message": _init_error or "credentials not configured",
            "hint": "配置三把钥匙后重启（见 SKILL.md §5）",
        })
    return _agent


# ---------------------------------------------------------------------------
# REST（Path B）
# ---------------------------------------------------------------------------
@api.get("/health")
def health() -> Dict[str, Any]:
    checks = check_all(_cfg)
    overall = "ok" if all(c["ok"] for c in checks.values()) else "partial_failure"
    return {"status": overall, "checks": checks,
            "configured": _cfg.fully_configured, "missing": _cfg.missing()}


@api.post("/config")
def rest_config(payload: Dict[str, Any]) -> Dict[str, Any]:
    return _require_agent().issue_config(payload.get("userid") or payload.get("user_id"))


@api.post("/agent/start")
def rest_start(payload: Dict[str, Any]) -> Dict[str, Any]:
    return _require_agent().start(payload)


@api.post("/agent/stop")
def rest_stop(payload: Dict[str, Any]) -> Dict[str, Any]:
    return _require_agent().stop(payload)


@api.post("/agent/farewell")
def rest_farewell(payload: Dict[str, Any]) -> Dict[str, Any]:
    return _require_agent().farewell(payload)


@api.post("/agent/invoke")
def rest_invoke(payload: Dict[str, Any]) -> Dict[str, Any]:
    return _require_agent().invoke(payload)


app.include_router(api)


# ---------------------------------------------------------------------------
# 能力子路由挂载（预接线；未安装能力 try_load 返回 None 自动跳过）
# ---------------------------------------------------------------------------
_CAP_ROUTES = [
    ("scenario-roleplay",  "/api/v1/scene"),
    ("quick-correct",      "/api/v1/correct"),
    ("reply-suggestion",   "/api/v1/suggest"),
    ("ability-report",     "/api/v1/report"),
    ("custom-learning-kb", "/api/v1/kb"),
]
for _cap, _prefix in _CAP_ROUTES:
    _mod = try_load_capability(_cap, "src/router.py")
    if _mod is not None and hasattr(_mod, "router"):
        app.include_router(_mod.router, prefix=_prefix, tags=[_cap])
        logger.info("mounted capability router: %s -> %s", _cap, _prefix)


# ---------------------------------------------------------------------------
# /action 兼容 facade（Path A 定稿 UI）—— Action 头 → Agent 方法 / 能力
# 复刻定稿 Demo 的 POST /action 契约，让 app.js 零改动即可跑。
# ---------------------------------------------------------------------------
_FACADE_ACTIONS = {
    "join", "StartAIConversation", "StopAIConversation", "FarewellAndStop",
    "InvokeLLM", "GenerateReport", "QuickCorrect", "SuggestReplies", "GetSceneCandidates",
}


def _err(msg: str) -> JSONResponse:
    return JSONResponse({"Response": {"Error": {"Code": "InvalidParameter", "Message": msg}}})


@app.post("/action")
async def action(request: Request):
    act = request.headers.get("Action", "")
    if act not in _FACADE_ACTIONS:
        return _err(f"action {act!r} invalid")
    body = await request.json() if request.headers.get("content-type", "").startswith("application/json") else {}
    body = body or {}
    try:
        # 核心 action 需要 Agent（依赖 TRTC/腾讯云）；评估类只需 LLM，不经 Agent。
        if act == "join":
            return _require_agent().issue_config(body.get("userid"))
        if act == "StartAIConversation":
            return _require_agent().start(body)
        if act == "StopAIConversation":
            return _require_agent().stop(body)
        if act == "FarewellAndStop":
            return _require_agent().farewell(body)
        if act == "InvokeLLM":
            return _require_agent().invoke(body)
        # 评估类 → 转发到对应能力的 handler（不依赖 Agent/TRTC）
        if act == "GenerateReport":
            return _dispatch_capability("ability-report", "generate", body)
        if act == "QuickCorrect":
            return _dispatch_capability("quick-correct", "generate", body)
        if act == "SuggestReplies":
            return _dispatch_capability("reply-suggestion", "generate", body)
        if act == "GetSceneCandidates":
            return _dispatch_capability("scenario-roleplay", "get_scene_candidates", body)
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        logger.error("action %s failed: %s", act, exc)
        return _err(str(exc))


def _dispatch_capability(cap: str, func: str, body: Dict[str, Any]):
    """调用能力 src/handler.py 里的 facade 函数（复刻 Demo 的响应形状）。"""
    mod = try_load_capability(cap, "src/handler.py")
    if mod is None or not hasattr(mod, func):
        return _err(f"capability {cap!r} not installed")
    return getattr(mod, func)(body)


# ---------------------------------------------------------------------------
# 静态 Web Demo（Path A）—— 由 WEB_DEMO_DIR 指向三屏 SPA
# ---------------------------------------------------------------------------
_DEMO_DIR = Path(os.getenv("WEB_DEMO_DIR", "")) if os.getenv("WEB_DEMO_DIR") else None
if _DEMO_DIR and _DEMO_DIR.exists():
    app.mount("/static", StaticFiles(directory=str(_DEMO_DIR), html=True), name="static")

    @app.get("/")
    def index() -> FileResponse:
        # 优先 coach.html（定稿 Demo 入口），否则 index.html
        for name in ("coach.html", "index.html"):
            p = _DEMO_DIR / name
            if p.exists():
                return FileResponse(str(p))
        raise HTTPException(status_code=404, detail="demo index not found")


def main() -> None:
    import uvicorn
    uvicorn.run(app, host=os.getenv("HOST", "0.0.0.0"), port=int(os.getenv("PORT", "8000")))


if __name__ == "__main__":
    main()
