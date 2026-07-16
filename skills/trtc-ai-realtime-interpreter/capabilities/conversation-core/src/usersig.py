# -*- coding: utf-8 -*-
"""TLS-SIG-API-v2 UserSig 签发（纯 Python 实现，无第三方依赖）。

TRTC 进房鉴权：用 SDKAppID + SDKSecretKey 对 UserId 做 HMAC-SHA256 签名，
再 zlib 压缩 + base64url 编码得到 UserSig。

参考：https://cloud.tencent.com/document/product/647/17275
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time
import zlib


def _base64_encode(data: bytes) -> str:
    s = base64.b64encode(data).decode("utf-8")
    return s.replace("+", "*").replace("/", "-").replace("=", "_")


def _hmac_sha256(sdk_app_id: int, user_id: str, secret_key: str, current_ts: int, expire: int) -> str:
    raw_to_sign = (
        f"TLS.identifier:{user_id}\n"
        f"TLS.sdkappid:{sdk_app_id}\n"
        f"TLS.time:{current_ts}\n"
        f"TLS.expire:{expire}\n"
    )
    digest = hmac.new(secret_key.encode("utf-8"), raw_to_sign.encode("utf-8"), hashlib.sha256).digest()
    return base64.b64encode(digest).decode("utf-8")


def gen_user_sig(sdk_app_id: int, sdk_secret_key: str, user_id: str, expire_seconds: int = 86400) -> str:
    """签发一个 UserSig，供 TRTC Web/Native SDK 进房使用。"""
    if not sdk_app_id or not sdk_secret_key:
        raise ValueError("sdk_app_id and sdk_secret_key are required")
    if not user_id:
        raise ValueError("user_id is required")

    current_ts = int(time.time())
    sig = _hmac_sha256(sdk_app_id, user_id, sdk_secret_key, current_ts, expire_seconds)
    payload = {
        "TLS.ver": "2.0",
        "TLS.identifier": str(user_id),
        "TLS.sdkappid": int(sdk_app_id),
        "TLS.expire": int(expire_seconds),
        "TLS.time": int(current_ts),
        "TLS.sig": sig,
    }
    compressed = zlib.compress(json.dumps(payload).encode("utf-8"))
    return _base64_encode(compressed)
