# -*- coding: utf-8 -*-
"""健康自检：三 LED（tencent_cloud / trtc / llm）。供前端顶栏状态灯 + Path B e2e 用。

轻量策略：不做深度联网探测（避免慢/误报），只校验凭据是否齐全 + 格式合理。
需要深度校验时走 scripts/verify-credentials.py（对齐客服）。
"""
from __future__ import annotations

import re
from typing import Dict

from .config import CoreConfig


def _led(ok: bool, msg: str) -> Dict[str, object]:
    return {"ok": ok, "message": msg}


def check_all(cfg: CoreConfig) -> Dict[str, Dict[str, object]]:
    # TRTC
    if not cfg.trtc.configured:
        trtc = _led(False, "TRTC 应用凭据未配置")
    elif not re.fullmatch(r"[0-9a-fA-F]{64}", cfg.trtc.sdk_secret_key or ""):
        trtc = _led(False, "SDKSecretKey 格式异常（应为 64 位十六进制）")
    else:
        trtc = _led(True, "TRTC 凭据就绪")

    # Tencent Cloud
    tc = _led(cfg.tencent.configured,
              "腾讯云 API 凭据就绪" if cfg.tencent.configured else "腾讯云 API 凭据未配置")

    # LLM
    llm = _led(cfg.llm.configured,
               "LLM 密钥就绪" if cfg.llm.configured else "LLM 密钥未配置")

    return {"tencent_cloud": tc, "trtc": trtc, "llm": llm}
