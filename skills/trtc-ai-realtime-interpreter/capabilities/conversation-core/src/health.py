# -*- coding: utf-8 -*-
"""三把钥匙的实时连通性自检。"""
from __future__ import annotations

import hashlib
import hmac
import json
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Optional
from urllib.parse import urlparse

import requests

from credentials import LlmCredential, TencentCloudCredential, TrtcCredential
from usersig import gen_user_sig


@dataclass
class CheckResult:
    ok: bool
    latency_ms: int
    error_code: str = ""
    detail: str = ""

    def to_dict(self) -> dict:
        return {
            "status": "ok" if self.ok else "failed",
            "latency_ms": self.latency_ms,
            "error_code": self.error_code,
            "detail": self.detail,
        }


# ---------------------------------------------------------------------------
# 1) 腾讯云 API 密钥：调用 STS GetFederationToken
# ---------------------------------------------------------------------------
_STS_HOST = "sts.tencentcloudapi.com"
_STS_SERVICE = "sts"
_STS_VERSION = "2018-08-13"
_STS_ACTION = "GetFederationToken"


def _sign_tc3(secret_key: str, date: str, service: str, string_to_sign: str) -> str:
    k_date = hmac.new(("TC3" + secret_key).encode("utf-8"), date.encode("utf-8"), hashlib.sha256).digest()
    k_service = hmac.new(k_date, service.encode("utf-8"), hashlib.sha256).digest()
    k_signing = hmac.new(k_service, b"tc3_request", hashlib.sha256).digest()
    return hmac.new(k_signing, string_to_sign.encode("utf-8"), hashlib.sha256).hexdigest()


def check_tencent_cloud(cred: TencentCloudCredential, timeout: float = 5.0) -> CheckResult:
    if not cred.configured:
        return CheckResult(ok=False, latency_ms=0, error_code="E001", detail="empty credential")

    payload = json.dumps(
        {
            "Name": "trtc-ai-realtime-interpreter-credential-check",
            "Policy": json.dumps(
                {"version": "2.0", "statement": [{"effect": "deny", "action": ["*"], "resource": ["*"]}]}
            ),
            "DurationSeconds": 1800,
        },
        separators=(",", ":"),
    )
    timestamp = int(time.time())
    date = datetime.fromtimestamp(timestamp, tz=timezone.utc).strftime("%Y-%m-%d")
    canonical_headers = (
        f"content-type:application/json; charset=utf-8\nhost:{_STS_HOST}\nx-tc-action:{_STS_ACTION.lower()}\n"
    )
    signed_headers = "content-type;host;x-tc-action"
    hashed_payload = hashlib.sha256(payload.encode("utf-8")).hexdigest()
    canonical_request = f"POST\n/\n\n{canonical_headers}\n{signed_headers}\n{hashed_payload}"
    credential_scope = f"{date}/{_STS_SERVICE}/tc3_request"
    hashed_canonical = hashlib.sha256(canonical_request.encode("utf-8")).hexdigest()
    string_to_sign = f"TC3-HMAC-SHA256\n{timestamp}\n{credential_scope}\n{hashed_canonical}"
    signature = _sign_tc3(cred.secret_key, date, _STS_SERVICE, string_to_sign)
    authorization = (
        f"TC3-HMAC-SHA256 Credential={cred.secret_id}/{credential_scope}, "
        f"SignedHeaders={signed_headers}, Signature={signature}"
    )
    headers = {
        "Authorization": authorization,
        "Content-Type": "application/json; charset=utf-8",
        "Host": _STS_HOST,
        "X-TC-Action": _STS_ACTION,
        "X-TC-Timestamp": str(timestamp),
        "X-TC-Version": _STS_VERSION,
        "X-TC-Region": cred.region,
    }
    started = time.perf_counter()
    try:
        resp = requests.post(f"https://{_STS_HOST}", headers=headers, data=payload.encode("utf-8"), timeout=timeout)
        elapsed = int((time.perf_counter() - started) * 1000)
        body = resp.json() if resp.content else {}
        err = body.get("Response", {}).get("Error")
        if resp.status_code == 200 and not err:
            return CheckResult(ok=True, latency_ms=elapsed)
        if err and err.get("Code", "").startswith("AuthFailure"):
            return CheckResult(ok=False, latency_ms=elapsed, error_code="E001", detail=err.get("Message", "AuthFailure"))
        return CheckResult(
            ok=False, latency_ms=elapsed, error_code="E001", detail=(err or {}).get("Message") or f"HTTP {resp.status_code}"
        )
    except requests.Timeout:
        return CheckResult(ok=False, latency_ms=int(timeout * 1000), error_code="E004", detail="timeout")
    except requests.RequestException as exc:
        return CheckResult(ok=False, latency_ms=0, error_code="E004", detail=str(exc))


# ---------------------------------------------------------------------------
# 2) TRTC 应用凭证：本地 UserSig 自洽 + 可选 OpenAPI 探测
# ---------------------------------------------------------------------------
_TRTC_SERVICE = "trtc"
_TRTC_VERSION = "2019-07-22"


def _trtc_sign_tc3(secret_key: str, date: str, string_to_sign: str) -> str:
    k_date = hmac.new(("TC3" + secret_key).encode("utf-8"), date.encode("utf-8"), hashlib.sha256).digest()
    k_service = hmac.new(k_date, _TRTC_SERVICE.encode("utf-8"), hashlib.sha256).digest()
    k_signing = hmac.new(k_service, b"tc3_request", hashlib.sha256).digest()
    return hmac.new(k_signing, string_to_sign.encode("utf-8"), hashlib.sha256).hexdigest()


def check_trtc(cred: TrtcCredential, tencent: Optional[TencentCloudCredential] = None, timeout: float = 5.0) -> CheckResult:
    if not cred.configured:
        return CheckResult(ok=False, latency_ms=0, error_code="E002", detail="empty credential")

    started = time.perf_counter()
    try:
        sig = gen_user_sig(cred.sdk_app_id, cred.sdk_secret_key, "credential_check", expire_seconds=60)
    except Exception as exc:  # noqa: BLE001
        return CheckResult(ok=False, latency_ms=0, error_code="E002", detail=str(exc))
    if not sig or len(sig) < 32:
        return CheckResult(
            ok=False, latency_ms=int((time.perf_counter() - started) * 1000), error_code="E002", detail="invalid usersig length"
        )

    if tencent is None or not tencent.configured:
        return CheckResult(ok=True, latency_ms=int((time.perf_counter() - started) * 1000), detail=f"local-only (no tencent cred); region={cred.region}")

    trtc_host = cred.trtc_endpoint
    trtc_region = cred.trtc_region
    now_ts = int(time.time())
    payload = json.dumps({"SdkAppId": cred.sdk_app_id, "StartTime": now_ts - 60, "EndTime": now_ts}, separators=(",", ":"))
    timestamp = now_ts
    date = datetime.fromtimestamp(timestamp, tz=timezone.utc).strftime("%Y-%m-%d")
    canonical_headers = (
        f"content-type:application/json; charset=utf-8\nhost:{trtc_host}\n"
        f"x-tc-action:describetrtcrealtimequalitydata\n"
    )
    signed_headers = "content-type;host;x-tc-action"
    hashed_payload = hashlib.sha256(payload.encode("utf-8")).hexdigest()
    canonical_request = f"POST\n/\n\n{canonical_headers}\n{signed_headers}\n{hashed_payload}"
    credential_scope = f"{date}/{_TRTC_SERVICE}/tc3_request"
    hashed_canonical = hashlib.sha256(canonical_request.encode("utf-8")).hexdigest()
    string_to_sign = f"TC3-HMAC-SHA256\n{timestamp}\n{credential_scope}\n{hashed_canonical}"
    signature = _trtc_sign_tc3(tencent.secret_key, date, string_to_sign)
    authorization = (
        f"TC3-HMAC-SHA256 Credential={tencent.secret_id}/{credential_scope}, "
        f"SignedHeaders={signed_headers}, Signature={signature}"
    )
    headers = {
        "Authorization": authorization,
        "Content-Type": "application/json; charset=utf-8",
        "Host": trtc_host,
        "X-TC-Action": "DescribeTRTCRealTimeQualityData",
        "X-TC-Timestamp": str(timestamp),
        "X-TC-Version": _TRTC_VERSION,
        "X-TC-Region": trtc_region,
    }
    try:
        resp = requests.post(f"https://{trtc_host}", headers=headers, data=payload.encode("utf-8"), timeout=timeout)
        elapsed = int((time.perf_counter() - started) * 1000)
        body = resp.json() if resp.content else {}
        err = body.get("Response", {}).get("Error")
        if resp.status_code == 200 and not err:
            return CheckResult(ok=True, latency_ms=elapsed, detail=f"region={cred.region}, endpoint={trtc_host}")
        if err:
            code = err.get("Code", "")
            if "SdkAppId" in code or "AuthFailure" in code or "ResourceNotFound" in code:
                return CheckResult(ok=False, latency_ms=elapsed, error_code="E002", detail=f"{code}: {err.get('Message', '')}")
            return CheckResult(ok=True, latency_ms=elapsed, detail=f"sdkappid valid (region={cred.region}, endpoint={trtc_host}); api warning: {code}")
        return CheckResult(ok=False, latency_ms=elapsed, error_code="E002", detail=f"HTTP {resp.status_code}")
    except requests.Timeout:
        return CheckResult(ok=False, latency_ms=int(timeout * 1000), error_code="E004", detail="trtc api timeout")
    except requests.RequestException as exc:
        return CheckResult(ok=False, latency_ms=0, error_code="E004", detail=str(exc))


# ---------------------------------------------------------------------------
# 3) LLM Key：发一个最小 prompt 验证有效性
# ---------------------------------------------------------------------------
def check_llm(cred: LlmCredential, timeout: float = 10.0) -> CheckResult:
    if not cred.configured:
        return CheckResult(ok=False, latency_ms=0, error_code="E003", detail="empty credential")
    parsed = urlparse(cred.api_url)
    if parsed.scheme not in ("http", "https"):
        return CheckResult(ok=False, latency_ms=0, error_code="E003", detail="invalid api_url scheme")

    headers = {"Authorization": f"Bearer {cred.api_key}", "Content-Type": "application/json"}
    body = {"model": cred.model, "messages": [{"role": "user", "content": "ping"}], "max_tokens": 1, "temperature": 0, "stream": False}
    started = time.perf_counter()
    try:
        resp = requests.post(cred.api_url, headers=headers, json=body, timeout=timeout)
        elapsed = int((time.perf_counter() - started) * 1000)
        if resp.status_code == 200:
            return CheckResult(ok=True, latency_ms=elapsed)
        if resp.status_code in (401, 403):
            return CheckResult(ok=False, latency_ms=elapsed, error_code="E003", detail=f"unauthorized: {resp.status_code}")
        return CheckResult(ok=False, latency_ms=elapsed, error_code="E003", detail=f"HTTP {resp.status_code}: {resp.text[:200]}")
    except requests.Timeout:
        return CheckResult(ok=False, latency_ms=int(timeout * 1000), error_code="E004", detail="timeout")
    except requests.RequestException as exc:
        return CheckResult(ok=False, latency_ms=0, error_code="E004", detail=str(exc))


def check_all(tencent: TencentCloudCredential, trtc: TrtcCredential, llm: LlmCredential):
    return (check_tencent_cloud(tencent), check_trtc(trtc, tencent=tencent), check_llm(llm))
