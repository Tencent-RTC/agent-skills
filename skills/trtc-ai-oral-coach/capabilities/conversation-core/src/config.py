# -*- coding: utf-8 -*-
"""conversation-core 配置加载（从 .env 读三把钥匙 + Region + 两组 LLM）。

对齐 AI 客服 Skill：三把钥匙走扁平 .env（配合 verify-credentials.py 复用）。
陪练特有的场景/风格/难度默认值内置在 scenario-roleplay 能力里，core 不管。
"""
from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

_BASE_DIR = Path(__file__).resolve().parent.parent   # capabilities/conversation-core/
load_dotenv(_BASE_DIR / ".env.local")
load_dotenv(_BASE_DIR / ".env")


# Region → TRTC OpenAPI Endpoint
REGION_PROFILES = {
    "cn":   {"endpoint": "trtc.tencentcloudapi.com",      "region": "ap-guangzhou"},
    "intl": {"endpoint": "trtc.intl.tencentcloudapi.com", "region": "ap-singapore"},
}


def _env(key: str, default: str = "") -> str:
    return (os.getenv(key) or default).strip()


@dataclass
class TRTCCred:
    sdk_app_id: int
    sdk_secret_key: str
    region: str

    @property
    def configured(self) -> bool:
        return bool(self.sdk_app_id) and bool(self.sdk_secret_key)

    @property
    def endpoint(self) -> str:
        return REGION_PROFILES.get(self.region, REGION_PROFILES["intl"])["endpoint"]

    @property
    def api_region(self) -> str:
        return REGION_PROFILES.get(self.region, REGION_PROFILES["intl"])["region"]


@dataclass
class TencentCloudCred:
    secret_id: str
    secret_key: str

    @property
    def configured(self) -> bool:
        return bool(self.secret_id) and bool(self.secret_key)


@dataclass
class LLMCred:
    api_key: str
    api_url: str
    model: str

    @property
    def configured(self) -> bool:
        return bool(self.api_key)


class CoreConfig:
    """core 运行期配置：三把钥匙 + 实时对话 LLM + 报告 LLM（共享评估基座用）。"""

    def __init__(self) -> None:
        region = _env("TRTC_REGION", "intl")
        if region not in REGION_PROFILES:
            region = "intl"
        self.trtc = TRTCCred(
            sdk_app_id=int(_env("TRTC_SDK_APP_ID", "0") or 0),
            sdk_secret_key=_env("TRTC_SDK_SECRET_KEY"),
            region=region,
        )
        self.tencent = TencentCloudCred(
            secret_id=_env("TENCENT_CLOUD_SECRET_ID"),
            secret_key=_env("TENCENT_CLOUD_SECRET_KEY"),
        )
        # 实时对话 LLM（TRTC 云端 AI Bot 调用）
        self.llm = LLMCred(
            api_key=_env("LLM_API_KEY"),
            api_url=_env("LLM_API_URL", "https://api.openai.com/v1/chat/completions"),
            model=_env("LLM_MODEL", "gpt-4o-mini"),
        )
        # 报告/纠正/建议 LLM（后端直连；空则回退到实时对话 LLM 配置）
        self.report_llm = LLMCred(
            api_key=_env("REPORT_LLM_API_KEY") or self.llm.api_key,
            api_url=_env("REPORT_LLM_API_URL") or self.llm.api_url,
            model=_env("REPORT_LLM_MODEL") or self.llm.model,
        )
        self.report_llm_temperature = float(_env("REPORT_LLM_TEMPERATURE", "0.2") or 0.2)
        self.report_llm_timeout = float(_env("REPORT_LLM_TIMEOUT", "120") or 120)

    # ---- 实时对话 LLMConfig（注入动态 SystemPrompt 后传给 TRTC）----
    def llm_config_with_prompt(self, system_prompt: str) -> dict:
        # History: TRTC 服务端自动维护的上下文轮数，官方上限 50，做个保护
        history = max(0, min(50, int(_env("LLM_HISTORY", "20") or 20)))
        return {
            "LLMType":     "openai",
            "Model":       self.llm.model,
            "APIKey":      self.llm.api_key,
            "APIUrl":      self.llm.api_url,
            "SystemPrompt": system_prompt,
            "Streaming":   True,
            "Temperature": float(_env("LLM_TEMPERATURE", "0.4") or 0.4),
            "History":     history,
            # 上下文与音频播放进度同步：未播完的音频对应文本不计入下一轮上下文，
            # 避免"AI 自相矛盾/重复问候/像是在跟自己说话"这类问题。默认开启。
            "HistoryMode": int(_env("LLM_HISTORY_MODE", "1") or 1),
            # 原来没有 Timeout：实时对话模型响应稍慢时，TRTC 云端 AI Bot 可能拿不到
            # LLM 回复而静默无输出。给个较宽松的默认值。
            "Timeout":     float(_env("LLM_TIMEOUT", "20") or 20),
        }

    # ---- 数字人（三项全填启用）----
    def avatar_enabled(self) -> bool:
        return bool(_env("AVATAR_APPKEY")) and bool(_env("AVATAR_ACCESS_TOKEN")) \
            and bool(_env("AVATAR_PROJECT_ID"))

    def avatar_config(self) -> dict:
        return {
            "AvatarType":          _env("AVATAR_TYPE", "tencent"),
            "Appkey":              _env("AVATAR_APPKEY"),
            "AccessToken":         _env("AVATAR_ACCESS_TOKEN"),
            "VirtualmanProjectId": _env("AVATAR_PROJECT_ID"),
        }

    @property
    def fully_configured(self) -> bool:
        return self.trtc.configured and self.tencent.configured and self.llm.configured

    def missing(self) -> list:
        m = []
        if not self.trtc.configured:    m.append("TRTC")
        if not self.tencent.configured: m.append("TENCENT_CLOUD")
        if not self.llm.configured:     m.append("LLM")
        return m


def load_config() -> CoreConfig:
    return CoreConfig()
