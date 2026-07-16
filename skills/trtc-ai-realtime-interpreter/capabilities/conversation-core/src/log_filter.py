# -*- coding: utf-8 -*-
"""日志脱敏过滤器：防止密钥/UserSig 意外落进日志文件（Secrets 规范）。"""
from __future__ import annotations

import logging
import re

_PATTERNS = [
    re.compile(r"(secret[_-]?key\s*[=:]\s*)([^\s,&\"']+)", re.IGNORECASE),
    re.compile(r"(secret[_-]?id\s*[=:]\s*)([^\s,&\"']+)", re.IGNORECASE),
    re.compile(r"(api[_-]?key\s*[=:]\s*)([^\s,&\"']+)", re.IGNORECASE),
    re.compile(r"(usersig\s*[=:]\s*)([^\s,&\"']+)", re.IGNORECASE),
    re.compile(r"(authorization\s*[=:]\s*)([^\s,&\"']+)", re.IGNORECASE),
]


def _redact(msg: str) -> str:
    for pat in _PATTERNS:
        msg = pat.sub(lambda m: m.group(1) + "***REDACTED***", msg)
    return msg


class RedactingFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:  # noqa: A003
        try:
            record.msg = _redact(str(record.msg))
        except Exception:  # noqa: BLE001
            pass
        return True


def install_redacting_filter(logger: logging.Logger) -> None:
    logger.addFilter(RedactingFilter())
