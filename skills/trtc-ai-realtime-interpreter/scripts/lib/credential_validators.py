# -*- coding: utf-8 -*-
"""三把钥匙的免密校验函数（供 verify-credentials.py 调用）。

密钥只从 .env / 进程环境变量读取，绝不接受命令行参数传入；输出的 JSON 不包含
明文密钥，error 字段只是错误码/简短描述。调用方（AI/CLI）应把 stdout 当纯 JSON
解析，终端里不回显密钥内容。
"""
from __future__ import annotations

import os
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List, Optional

_HERE = Path(__file__).resolve().parent
_SKILL_ROOT = _HERE.parent.parent
_CORE_SRC = _SKILL_ROOT / "capabilities" / "conversation-core" / "src"

if str(_CORE_SRC) not in sys.path:
    sys.path.insert(0, str(_CORE_SRC))


def _imports():
    from credentials import load_from_env  # type: ignore  # noqa: WPS433
    from health import check_llm, check_tencent_cloud, check_trtc  # type: ignore  # noqa: WPS433

    return {
        "load_from_env": load_from_env,
        "check_llm": check_llm,
        "check_tencent_cloud": check_tencent_cloud,
        "check_trtc": check_trtc,
    }


_ERROR_HINTS: Dict[str, str] = {
    "E001": "腾讯云 SecretId/SecretKey 校验失败（AuthFailure，或账号未开通 STS）。",
    "E002": "TRTC 应用凭证校验失败（SDKAppID 不属于该账号 / SDKSecretKey 不匹配）。",
    "E003": "LLM 校验失败（鉴权 401/403 或非 200 响应）。",
    "E004": "网络不可达 / 超时（检查代理/防火墙）。",
    "E000": "密钥未配置或为空。",
}


@dataclass
class ValidationResult:
    ok: bool
    type: str
    error: str = ""
    message: str = ""
    latency_ms: int = 0

    def to_dict(self) -> Dict:
        return {"ok": self.ok, "type": self.type, "error": self.error, "message": self.message, "latency_ms": self.latency_ms}


@dataclass
class BatchResult:
    ok: bool
    items: List[ValidationResult] = field(default_factory=list)

    def to_dict(self) -> Dict:
        return {"ok": self.ok, "type": "all", "items": [r.to_dict() for r in self.items]}


def load_dotenv(env_path: Optional[Path] = None) -> Dict[str, str]:
    """把 .env 读进 os.environ；优先级：参数 > capabilities/conversation-core/.env > skill 根目录 .env。"""
    candidates: List[Path] = []
    if env_path is not None:
        candidates.append(Path(env_path))
    candidates.append(_SKILL_ROOT / "capabilities" / "conversation-core" / ".env")
    candidates.append(_SKILL_ROOT / ".env")

    seen: Dict[str, str] = {}
    for c in candidates:
        if not c.exists() or not c.is_file():
            continue
        try:
            text = c.read_text(encoding="utf-8")
        except OSError:
            continue
        for line in text.splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, _, v = line.partition("=")
            k = k.strip()
            v = v.strip().strip('"').strip("'")
            if k and k not in seen:
                seen[k] = v
                os.environ.setdefault(k, v)
        if seen:
            break
    return seen


def validate_tencent() -> ValidationResult:
    mods = _imports()
    creds = mods["load_from_env"]()
    tc = creds.tencent_cloud
    if not tc.configured:
        return ValidationResult(ok=False, type="tencent", error="E000", message="TENCENT_CLOUD_SECRET_ID / TENCENT_CLOUD_SECRET_KEY 未配置")
    r = mods["check_tencent_cloud"](tc)
    return ValidationResult(
        ok=r.ok, type="tencent", error="" if r.ok else (r.error_code or "E001"),
        message=r.detail if not r.ok else f"sts/GetFederationToken ok (region={tc.region})", latency_ms=r.latency_ms,
    )


def validate_trtc(deep: bool = True) -> ValidationResult:
    mods = _imports()
    creds = mods["load_from_env"]()
    trtc = creds.trtc
    tc = creds.tencent_cloud if deep else None
    if not trtc.configured:
        return ValidationResult(ok=False, type="trtc", error="E000", message="TRTC_SDK_APP_ID / TRTC_SDK_SECRET_KEY 未配置")
    r = mods["check_trtc"](trtc, tencent=tc if (tc and tc.configured) else None)
    return ValidationResult(
        ok=r.ok, type="trtc", error="" if r.ok else (r.error_code or "E002"),
        message=r.detail or ("usersig/openapi ok" if r.ok else "trtc check failed"), latency_ms=r.latency_ms,
    )


def validate_llm() -> ValidationResult:
    mods = _imports()
    creds = mods["load_from_env"]()
    llm = creds.llm
    if not llm.configured:
        return ValidationResult(ok=False, type="llm", error="E000", message="LLM_API_KEY / LLM_API_URL / LLM_MODEL 未配置")
    r = mods["check_llm"](llm)
    return ValidationResult(
        ok=r.ok, type="llm", error="" if r.ok else (r.error_code or "E003"),
        message=r.detail or (f"chat/completions 200 ok (model={llm.model})" if r.ok else "llm failed"), latency_ms=r.latency_ms,
    )


def validate_all() -> BatchResult:
    items = [validate_tencent(), validate_trtc(deep=True), validate_llm()]
    return BatchResult(ok=all(i.ok for i in items), items=items)


def hint(error_code: str) -> str:
    return _ERROR_HINTS.get(error_code, "")
