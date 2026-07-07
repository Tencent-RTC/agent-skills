# -*- coding: utf-8 -*-
"""KBClient port —— 检索用户自有教研知识库，返回相关片段。

adapter：dify（默认）/ coze / user_custom，通过 .env KB_ADAPTER 切换。
安全：outbound 对非 localhost 强制 HTTPS + 禁止内网地址（SSRF 防护）。
"""
from __future__ import annotations

import ipaddress
import socket
from abc import ABC, abstractmethod
from typing import Dict, List
from urllib.parse import urlparse


class KBClient(ABC):
    @abstractmethod
    def retrieve(self, query: str, top_k: int = 3) -> List[Dict]:
        """返回 [{text, source, score}, ...]"""
        ...


# ---- SSRF 防护：拒绝内网/环回（localhost 除外用于本地联调）----
_BLOCKED_PREFIXES = ("9.", "10.", "11.", "21.", "30.", "172.", "192.168.")


def assert_safe_url(url: str) -> None:
    parsed = urlparse(url)
    if parsed.scheme != "https" and parsed.hostname not in ("localhost", "127.0.0.1"):
        raise ValueError(f"KB endpoint must be HTTPS (got {parsed.scheme!r})")
    host = parsed.hostname or ""
    if host in ("localhost", "127.0.0.1"):
        return
    try:
        ip = socket.gethostbyname(host)
    except Exception:
        ip = host
    try:
        addr = ipaddress.ip_address(ip)
        if addr.is_private or addr.is_loopback or addr.is_link_local:
            raise ValueError(f"KB endpoint resolves to a private/internal address: {ip}")
    except ValueError as e:
        if "private/internal" in str(e):
            raise
    if any(ip.startswith(p) for p in _BLOCKED_PREFIXES):
        raise ValueError(f"KB endpoint points to a blocked internal range: {ip}")
