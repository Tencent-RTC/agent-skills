# -*- coding: utf-8 -*-
"""Path A 场景专属后端：会议室 AI 实时翻译 demo。

这是「场景层」代码，不是可复用能力包——它把三个可复用能力包（conversation-core /
realtime-translation / meeting-ops）粘合成这一个具体 demo 的 API 形状，并且实现了
demo 专属的产品规则：**仅会议主持人可开关 AI 翻译**。

这条权限规则是我们自己拍的产品决策（控制云服务调用开销），不是接入 TRTC 会议能力
的必要条件，也不属于任何可复用能力包的职责——meeting-ops 本身不做权限校验（见其
README/manifest 的安全声明）。所以这段 AuthZ glue 代码只放在场景层，Path B 集成方
接入自己系统时完全不需要参考这套内存字典实现。

API 形状：
  GET  /api/v1/health            —— 三把钥匙自检（代理 conversation-core）
  POST /api/v1/config            —— 签发真人 + 静默旁听客户端两套身份 + 语言对列表
  POST /api/v1/room/register     —— 房间归属登记（demo 专属，供后续主持人校验）
  POST /api/v1/session/start     —— 主持人开启 AI 翻译（校验房主后转发给 meeting-ops 扇出）
  POST /api/v1/session/stop      —— 主持人关闭 AI 翻译（校验房主后转发）
  GET  /api/v1/session/state     —— 查询房间当前 AI 翻译状态（只读，无需权限）
  GET  /                          —— 托管前端构建产物（WEB_DEMO_DIR）
"""
from __future__ import annotations

import logging
import os
import sys
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional

from dotenv import load_dotenv

# ---------------------------------------------------------------------------
# 路径基线：把三个可复用能力包的 src 目录逐个按需加载（不整体塞进 sys.path，
# 避免不同能力包内同名文件（如 router.py）互相覆盖；使用 conversation-core 的
# _capability_loader 做隔离加载）。
# ---------------------------------------------------------------------------
# 兜底 HTML：dist 缺失时返回的友好提示（避免浏览器看到空白页一脸懵）
# ---------------------------------------------------------------------------
_MISSING_DIST_HTML = """<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8"><title>前端资源缺失</title>
<style>body{font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;max-width:640px;margin:60px auto;padding:24px;line-height:1.6;color:#1f2937}
h1{color:#b91c1c}code{background:#f3f4f6;padding:2px 6px;border-radius:4px;font-size:13px}
ol{padding-left:24px}li{margin:8px 0}</style></head>
<body>
<h1>前端资源缺失</h1>
<p>后端服务已经启动，但 <code>scenarios/meeting-interpreter/ui/dist/</code> 不存在或被删除了。</p>
<p>Path A 依赖预构建的前端静态资产（dist 由本 Skill 仓库自带，应在 <code>git clone</code> 后立即可见）。</p>
<p><strong>修复方法（任选其一）：</strong></p>
<ol>
<li>从 Skill 仓库重新克隆：<code>git clone &lt;repo-url&gt;</code>，确保 dist 目录被下载下来</li>
<li>或重新构建前端：<code>cd scenarios/meeting-interpreter/ui &amp;&amp; npm install &amp;&amp; npm run build</code></li>
</ol>
<p>完成后重启本服务即可。<br>后端 API 仍可用：<a href="/docs">/docs</a> · <a href="/api/v1/health">/api/v1/health</a></p>
</body></html>"""

_HERE = Path(__file__).resolve()
_SKILL_ROOT = _HERE.parents[4]  # scenarios/meeting-interpreter/backend/app/server.py -> skill root
_CORE_DIR = _SKILL_ROOT / "capabilities" / "conversation-core"
_CORE_SRC = _CORE_DIR / "src"

if str(_CORE_SRC) not in sys.path:
    sys.path.insert(0, str(_CORE_SRC))

load_dotenv(_CORE_DIR / ".env")

from fastapi import FastAPI, HTTPException, Query  # noqa: E402
from fastapi.middleware.cors import CORSMiddleware  # noqa: E402
from fastapi.responses import FileResponse, HTMLResponse  # noqa: E402
from fastapi.staticfiles import StaticFiles  # noqa: E402
from pydantic import BaseModel  # noqa: E402

from agent import ConversationAgent  # noqa: E402
from credentials import load_from_env  # noqa: E402
from health import check_all  # noqa: E402
from log_filter import install_redacting_filter  # noqa: E402
from _capability_loader import load_capability  # noqa: E402

logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"), format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
install_redacting_filter(logging.getLogger())
logger = logging.getLogger("meeting-interpreter-scenario")

_credentials = load_from_env()
_agent: Optional[ConversationAgent] = None
_init_error: Optional[str] = None
try:
    _agent = ConversationAgent(_credentials)
    logger.info("ConversationAgent initialized")
except Exception as exc:  # noqa: BLE001
    _init_error = str(exc)
    logger.warning("ConversationAgent not initialized: %s", _init_error)

# 动态加载 meeting-ops 的扇出编排器 + realtime-translation 的语言对列表
_fanout_mod = load_capability("meeting-ops", "src/fanout.py")
_modes_mod = load_capability("realtime-translation", "src/modes.py")
_orchestrator = _fanout_mod.get_orchestrator()

app = FastAPI(title="meeting-interpreter-scenario", version="1.0.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])

# ---------------------------------------------------------------------------
# demo 专属内存态：房间归属登记（AuthZ 基准，仅场景层持有，不属于任何能力包）
# ---------------------------------------------------------------------------
_ROOM_OWNERS: Dict[str, str] = {}


def _require_agent() -> ConversationAgent:
    if _agent is None:
        raise HTTPException(status_code=503, detail={
            "code": "credentials_missing",
            "message": _init_error or "credentials not configured",
            "hint": "在 capabilities/conversation-core/.env 里配好三把钥匙后重启",
        })
    return _agent


def _verify_owner(room_id: str, caller_user_id: str) -> None:
    """服务端独立校验调用者是否为该房间主持人（不信任前端自报）。

    这是 demo 专属的产品规则实现，不代表接入 meeting-ops 必须要有这层校验——
    Path B 集成方应该用自己系统里真实的权限判断替换这里的逻辑。
    """
    owner = _ROOM_OWNERS.get(room_id)
    if not owner:
        raise HTTPException(status_code=403, detail={"code": "room_not_registered", "message": "房间未登记归属，无法校验主持人权限"})
    if owner != caller_user_id:
        raise HTTPException(status_code=403, detail={"code": "not_owner", "message": "仅会议主持人可操作 AI 实时翻译"})


# ---------------------------------------------------------------------------
@app.get("/api/v1/health")
def health() -> Dict[str, Any]:
    cred = load_from_env()
    tc, trtc, llm = check_all(cred.tencent_cloud, cred.trtc, cred.llm)
    missing = cred.missing()
    return {
        "status": "ok" if (tc.ok and trtc.ok and llm.ok) else "missing_credentials",
        "trtc_configured": cred.trtc.configured,
        "tencent_configured": cred.tencent_cloud.configured,
        "llm_configured": cred.llm.configured,
        "missing": missing,
        "modes": list(_modes_mod.MODE_CONFIG.keys()),
    }


# ---------------------------------------------------------------------------
class RoomRegisterRequest(BaseModel):
    roomId: str
    ownerUserId: str


@app.post("/api/v1/room/register")
def register_room(body: RoomRegisterRequest) -> Dict[str, Any]:
    _ROOM_OWNERS[body.roomId] = body.ownerUserId
    logger.info("room registered: %s -> owner %s", body.roomId, body.ownerUserId)
    return {"ok": True, "roomId": body.roomId, "ownerUserId": body.ownerUserId}


# ---------------------------------------------------------------------------
class ConfigRequest(BaseModel):
    userid: Optional[str] = None


@app.post("/api/v1/config")
def issue_config(body: ConfigRequest) -> Dict[str, Any]:
    agent = _require_agent()
    user_id = (body.userid or f"host_{uuid.uuid4().hex[:8]}")[:32]
    # 旁听客户端：独立身份进同一房间，只收自定义消息，不推流（见 conversation-core/frontend/silent-listener.ts）
    listener_user_id = f"{user_id}_lsnr"[:32]
    user_sig = agent.issue_user_sig(user_id)
    listener_user_sig = agent.issue_user_sig(listener_user_id)
    return {
        "sdkappid": agent.sdk_app_id,
        "userid": user_id,
        "usersig": user_sig,
        "listener_userid": listener_user_id,
        "listener_usersig": listener_user_sig,
        "modes": _modes_mod.list_modes(),
    }


# ---------------------------------------------------------------------------
class SessionStartRequest(BaseModel):
    roomId: str
    roomIdType: int = 1
    callerUserId: str
    mode: str
    participants: List[str]
    ttsEnabled: bool = False


@app.post("/api/v1/session/start")
def session_start(body: SessionStartRequest) -> Dict[str, Any]:
    agent = _require_agent()
    _verify_owner(body.roomId, body.callerUserId)
    try:
        result = _orchestrator.start(
            agent=agent,
            room_id=body.roomId,
            participants=body.participants,
            capability="realtime-translation",
            params={"mode": body.mode, "tts_enabled": body.ttsEnabled},
            room_id_type=body.roomIdType,
        )
    except RuntimeError as exc:
        # fanout 全部失败时，返回 500 + 错误详情（而不是 200 空数组让前端以为成功）
        logger.error("session_start failed: %s", exc)
        raise HTTPException(status_code=500, detail={
            "code": "fanout_failed",
            "message": str(exc),
            "hint": "常见原因：①SDKSecretKey 填成了 STSecretKey ②SDKAppID 与密钥不匹配 ③TRTC 应用未开通对话式 AI",
        })
    return {
        "active": result["active"],
        "mode": body.mode,
        "bots": [{"botUserId": b["agentUserId"], "targetUserId": b["targetUserId"]} for b in result["bots"]],
    }


class SessionStopRequest(BaseModel):
    roomId: str
    callerUserId: str


@app.post("/api/v1/session/stop")
def session_stop(body: SessionStopRequest) -> Dict[str, Any]:
    agent = _require_agent()
    _verify_owner(body.roomId, body.callerUserId)
    stopped = _orchestrator.stop(agent, body.roomId)
    return {"ok": True, "stopped": stopped}


@app.get("/api/v1/session/state")
def session_state(roomId: str = Query(...)) -> Dict[str, Any]:
    st = _orchestrator.state(roomId)
    return {
        "active": st["active"],
        "mode": (st.get("params") or {}).get("mode"),
        "bots": [{"botUserId": b["agentUserId"], "targetUserId": b["targetUserId"]} for b in st["bots"]],
    }


# ---------------------------------------------------------------------------
# 静态前端：默认托管 ../ui/dist（Vite 构建产物），可用 FRONTEND_DIR 覆盖
# ---------------------------------------------------------------------------
_FRONTEND_DIR = Path(os.getenv("FRONTEND_DIR") or (Path(__file__).resolve().parents[2] / "ui" / "dist"))
if _FRONTEND_DIR.exists():
    # 把预构建的 dist 挂到根路径（index.html 引用 /assets/xxx.js，所以必须根挂载）
    # FastAPI 的 /api/* 显式路由优先级高于 mount，/docs /openapi.json 等也都能正常访问
    app.mount("/", StaticFiles(directory=str(_FRONTEND_DIR), html=True), name="dist")

    @app.get("/")
    def index():
        p = _FRONTEND_DIR / "index.html"
        if p.exists():
            return FileResponse(str(p))
        # 兜底：dist 不存在时给个明确的修复提示（避免浏览器白屏一脸懵）
        return HTMLResponse(_MISSING_DIST_HTML, status_code=503)


def main() -> None:
    import uvicorn

    cert_dir = Path(__file__).resolve().parents[1]  # scenarios/meeting-interpreter/backend/
    cert_file = cert_dir / "cert.pem"
    key_file = cert_dir / "key.pem"
    port = int(os.getenv("PORT", "8020"))
    if cert_file.exists() and key_file.exists():
        logger.info("Starting HTTPS server (cert=%s)", cert_file)
        uvicorn.run(app, host=os.getenv("HOST", "0.0.0.0"), port=port, ssl_certfile=str(cert_file), ssl_keyfile=str(key_file))
    else:
        logger.info("Starting HTTP server (no cert.pem/key.pem found)")
        uvicorn.run(app, host=os.getenv("HOST", "0.0.0.0"), port=port)


if __name__ == "__main__":
    main()
