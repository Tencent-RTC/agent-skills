#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""verify-credentials.py —— 三把钥匙校验（对齐客服 Skill）。

安全：不接收命令行密钥；从 conversation-core/.env 读取。只输出 ok/error/message（不回显密钥）。
用法: python3 scripts/verify-credentials.py --type <trtc|tencent|llm|all>
输出: 单行 JSON
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
from pathlib import Path

SKILL_ROOT = Path(__file__).resolve().parent.parent
ENV_PATH = SKILL_ROOT / "capabilities" / "conversation-core" / ".env"


def _load_env() -> dict:
    env = {}
    if ENV_PATH.exists():
        for line in ENV_PATH.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            env[k.strip()] = v.strip()
    return env


def _out(ok: bool, error: str = "", message: str = "") -> None:
    print(json.dumps({"ok": ok, "error": error, "message": message}, ensure_ascii=False))
    sys.exit(0 if ok else 1)


def check_trtc(env: dict):
    app_id = env.get("TRTC_SDK_APP_ID", "")
    secret = env.get("TRTC_SDK_SECRET_KEY", "")
    if not app_id or app_id in ("0", "yourSDKAppID") or not secret or secret == "yourSDKSecretKey":
        return _out(False, "E000", "TRTC 凭据为空或仍是占位符")
    if not app_id.isdigit():
        return _out(False, "E002", "SDKAppID 应为纯数字")
    # 128 位 → 前后 64 相同则自动截断提示
    if len(secret) == 128 and secret[:64] == secret[64:]:
        return _out(True, "", "SDKSecretKey 检测到 128 位重复，取前 64 位；格式 OK")
    if not re.fullmatch(r"[0-9a-fA-F]{64}", secret):
        return _out(False, "E002", "SDKSecretKey 应为 64 位十六进制（注意别填成客户端 STSecretKey）")
    return _out(True, "", "TRTC 凭据格式 OK")


def check_tencent(env: dict):
    sid = env.get("TENCENT_CLOUD_SECRET_ID", "")
    skey = env.get("TENCENT_CLOUD_SECRET_KEY", "")
    if not sid or sid == "yourSecretId" or not skey or skey == "yourSecretKey":
        return _out(False, "E000", "腾讯云 API 凭据为空或仍是占位符")
    if not re.fullmatch(r"[A-Za-z0-9]+", sid):
        return _out(False, "E001", "SecretId 格式异常")
    return _out(True, "", "腾讯云 API 凭据格式 OK")


def check_llm(env: dict):
    key = env.get("LLM_API_KEY", "")
    if not key or key == "yourAPIKey":
        return _out(False, "E000", "LLM 密钥为空或仍是占位符")
    return _out(True, "", "LLM 密钥已配置")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--type", default="all", choices=["trtc", "tencent", "llm", "all"])
    args = ap.parse_args()
    env = _load_env()
    if not ENV_PATH.exists():
        _out(False, "E000", f".env 不存在：{ENV_PATH}")
    if args.type == "trtc":
        check_trtc(env)
    elif args.type == "tencent":
        check_tencent(env)
    elif args.type == "llm":
        check_llm(env)
    else:
        # all：任一失败即失败
        for fn in (check_trtc, check_tencent, check_llm):
            try:
                fn(env)
            except SystemExit as e:
                if e.code != 0:
                    raise
        _out(True, "", "三把钥匙均已配置")


if __name__ == "__main__":
    main()
