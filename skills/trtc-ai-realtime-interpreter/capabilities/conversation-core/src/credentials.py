# -*- coding: utf-8 -*-
"""三把钥匙（TRTC / 腾讯云 API / LLM）的读取与封装。

密钥只从环境变量读取（Secrets 规范：env-only），绝不出现在代码或日志里。
本文件不依赖包内相对导入，调用方需自行把本目录加入 sys.path 后 `import credentials`。
"""
from __future__ import annotations

import os
from dataclasses import dataclass


@dataclass(frozen=True)
class TencentCloudCredential:
    """钥匙 1：腾讯云 API 密钥（用于给 TRTC 控制面接口签名）。"""

    secret_id: str
    secret_key: str
    region: str = "ap-guangzhou"

    @property
    def configured(self) -> bool:
        return bool(self.secret_id and self.secret_key)


@dataclass(frozen=True)
class TrtcCredential:
    """钥匙 2：TRTC 应用凭证（用于签发 UserSig + 调用 Conversational AI 控制面）。

    region:
      - "intl" -> 国际站 console.trtc.io，endpoint=trtc.intl.tencentcloudapi.com
    """

    sdk_app_id: int
    sdk_secret_key: str
    region: str = "intl"

    @property
    def configured(self) -> bool:
        return bool(self.sdk_app_id and self.sdk_secret_key)

    @property
    def trtc_endpoint(self) -> str:
        return "trtc.tencentcloudapi.com" if self.region == "cn" else "trtc.intl.tencentcloudapi.com"

    @property
    def trtc_region(self) -> str:
        return "ap-guangzhou" if self.region == "cn" else "ap-singapore"


@dataclass(frozen=True)
class LlmCredential:
    """钥匙 3：LLM API Key（OpenAI 兼容协议）。"""

    api_key: str
    api_url: str = "https://api.openai.com/v1/chat/completions"
    model: str = "gpt-4o-mini"
    llm_type: str = "openai"

    @property
    def configured(self) -> bool:
        return bool(self.api_key and self.api_url and self.model)


@dataclass(frozen=True)
class Credentials:
    tencent_cloud: TencentCloudCredential
    trtc: TrtcCredential
    llm: LlmCredential

    @property
    def fully_configured(self) -> bool:
        return self.tencent_cloud.configured and self.trtc.configured and self.llm.configured

    def missing(self) -> list:
        miss = []
        if not self.tencent_cloud.configured:
            miss.append("tencent_cloud")
        if not self.trtc.configured:
            miss.append("trtc")
        if not self.llm.configured:
            miss.append("llm")
        return miss


def _int_env(key: str, default: int = 0) -> int:
    raw = os.getenv(key, "")
    try:
        return int(raw)
    except (TypeError, ValueError):
        return default


def load_from_env() -> Credentials:
    return Credentials(
        tencent_cloud=TencentCloudCredential(
            secret_id=os.getenv("TENCENT_CLOUD_SECRET_ID", ""),
            secret_key=os.getenv("TENCENT_CLOUD_SECRET_KEY", ""),
            region=os.getenv("TENCENT_CLOUD_REGION", "ap-guangzhou"),
        ),
        trtc=TrtcCredential(
            sdk_app_id=_int_env("TRTC_SDK_APP_ID", 0),
            sdk_secret_key=os.getenv("TRTC_SDK_SECRET_KEY", ""),
            region=os.getenv("TRTC_REGION", "cn"),
        ),
        llm=LlmCredential(
            api_key=os.getenv("LLM_API_KEY", ""),
            api_url=os.getenv("LLM_API_URL", "https://api.openai.com/v1/chat/completions"),
            model=os.getenv("LLM_MODEL", "gpt-4o-mini"),
            llm_type=os.getenv("LLM_TYPE", "openai"),
        ),
    )
