# -*- coding: utf-8 -*-
"""Dify / Coze / user_custom KB adapters + 工厂。

- dify : POST {KB_DIFY_API_URL}/datasets/{id}/retrieve  (Bearer KB_DIFY_API_KEY)
- coze : POST {KB_COZE_API_URL}/open_api/knowledge/recall (Bearer KB_COZE_API_KEY)
- user_custom : POST {KB_REST_BASE_URL} (Bearer KB_REST_TOKEN) —— 用户自研 REST

所有 adapter 走 assert_safe_url 做 SSRF 防护。
"""
from __future__ import annotations

import logging
import os
from typing import Dict, List

import requests

from ..ports import KBClient, assert_safe_url

logger = logging.getLogger("custom-learning-kb.adapter")


def _env(k: str, d: str = "") -> str:
    return (os.getenv(k) or d).strip()


class DifyKBClient(KBClient):
    def __init__(self) -> None:
        self.base = _env("KB_DIFY_API_URL")
        self.key = _env("KB_DIFY_API_KEY")
        self.dataset = _env("KB_DIFY_DATASET_ID")

    def retrieve(self, query: str, top_k: int = 3) -> List[Dict]:
        if not (self.base and self.key):
            raise RuntimeError("KB_DIFY_API_URL / KB_DIFY_API_KEY not configured")
        url = f"{self.base.rstrip('/')}/datasets/{self.dataset}/retrieve"
        assert_safe_url(url)
        headers = {"Authorization": f"Bearer {self.key}"}

        def _payload(search_method: str) -> dict:
            # Dify HitTestingPayload 的 retrieval_model 是强校验的 pydantic 模型，
            # reranking_enable / score_threshold_enabled 是必填字段，缺了会直接 400。
            return {
                "query": query,
                "retrieval_model": {
                    "search_method": search_method,
                    "reranking_enable": False,
                    "reranking_mode": None,
                    "reranking_model": {"reranking_provider_name": "", "reranking_model_name": ""},
                    "weights": None,
                    "top_k": top_k,
                    "score_threshold_enabled": False,
                    "score_threshold": None,
                },
            }

        # 优先 hybrid_search（语义检索，能理解查询词和素材内容之间没有字面重合但语义
        # 相关的情况——这是场景检索的真实需求）。但 Dify 数据集若以「经济」模式建索引
        # （免费/默认档常见），没有配置 Embedding 模型、也没有向量 Collection，请求
        # hybrid_search 会报 400 "Collection not found"。这种情况下自动降级成
        # keyword_search（关键词倒排索引，不依赖 Embedding）重试一次，保证「经济」
        # 模式数据集也能用，只是检索质量会退化为关键词匹配。
        resp = requests.post(url, headers=headers, json=_payload("hybrid_search"), timeout=(5, 8))
        if resp.status_code == 400 and "Collection not found" in resp.text:
            logger.warning("Dify hybrid_search unavailable (dataset likely uses Economy "
                           "indexing without an embedding model) — retrying with keyword_search")
            resp = requests.post(url, headers=headers, json=_payload("keyword_search"), timeout=(5, 8))
        resp.raise_for_status()
        records = resp.json().get("records", [])
        out = []
        for r in records[:top_k]:
            seg = r.get("segment", {}) if isinstance(r, dict) else {}
            out.append({"text": seg.get("content", ""),
                        "source": (seg.get("document") or {}).get("name", "dify"),
                        "score": r.get("score", 0)})
        return out


class CozeKBClient(KBClient):
    def __init__(self) -> None:
        self.base = _env("KB_COZE_API_URL", "https://api.coze.cn")
        self.key = _env("KB_COZE_API_KEY")
        self.dataset = _env("KB_COZE_DATASET_ID")

    def retrieve(self, query: str, top_k: int = 3) -> List[Dict]:
        if not self.key:
            raise RuntimeError("KB_COZE_API_KEY not configured")
        url = f"{self.base.rstrip('/')}/open_api/knowledge/recall"
        assert_safe_url(url)
        resp = requests.post(url, headers={"Authorization": f"Bearer {self.key}"},
                             json={"dataset_ids": [self.dataset] if self.dataset else [],
                                   "query": query, "top_k": top_k},
                             timeout=(5, 8))
        resp.raise_for_status()
        chunks = resp.json().get("chunks", []) or resp.json().get("data", [])
        out = []
        for c in (chunks or [])[:top_k]:
            if isinstance(c, dict):
                out.append({"text": c.get("content") or c.get("text", ""),
                            "source": c.get("doc_name", "coze"), "score": c.get("score", 0)})
        return out


class UserCustomKBClient(KBClient):
    def __init__(self) -> None:
        self.base = _env("KB_REST_BASE_URL")
        self.token = _env("KB_REST_TOKEN")

    def retrieve(self, query: str, top_k: int = 3) -> List[Dict]:
        if not self.base:
            raise RuntimeError("KB_REST_BASE_URL not configured")
        assert_safe_url(self.base)
        headers = {"Authorization": f"Bearer {self.token}"} if self.token else {}
        resp = requests.post(self.base, headers=headers,
                             json={"query": query, "top_k": top_k}, timeout=(5, 8))
        resp.raise_for_status()
        data = resp.json()
        records = data.get("records") or data.get("results") or []
        return [{"text": r.get("text", ""), "source": r.get("source", "custom"),
                 "score": r.get("score", 0)} for r in records[:top_k] if isinstance(r, dict)]


def get_client() -> KBClient:
    adapter = _env("KB_ADAPTER", "dify").lower()
    return {"dify": DifyKBClient, "coze": CozeKBClient,
            "user_custom": UserCustomKBClient}.get(adapter, DifyKBClient)()
