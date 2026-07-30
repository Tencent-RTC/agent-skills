"""
tools/search.py
===============

TRTC AI Integration —— 结构化 KB 搜索工具。

两种模式：
  route  ：dispatcher 层，query 未知 product 时做跨产品路由消歧义
  slices ：domain skill 层，已知 product 时查找对应 slice

不做语义搜索，不调 LLM。
确定性匹配：L0 normalize + weighted token match + error-code exact match。
"""

from __future__ import annotations

import json
import os
import re
import sys
import unicodedata
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any, Iterable, Optional

import yaml

THIS_FILE = Path(__file__).resolve()
DEFAULT_REPO_ROOT = THIS_FILE.parent.parent.parent.parent
ENV_REPO_ROOT = "TRTC_REPO_ROOT"
KNOWN_PRODUCTS = {"conference", "chat", "call", "live", "rtc-engine"}
KNOWN_PLATFORMS = ("web", "android", "ios", "flutter", "electron", "unity")
_WORD_RE = re.compile(r"[A-Za-z0-9_]+|[一-鿿]+")
_FRONTMATTER_RE = re.compile(r"^---\n(.*?)\n---\n", re.DOTALL)
_ERROR_CODE_RE = re.compile(r"(?<!\d)-?{code}(?!\d)")


class SearchError(Exception):
    """搜索异常基类。"""


class KBNotFoundError(SearchError):
    """KB 文件不存在。"""


class InvalidInputError(SearchError):
    """输入参数非法。"""


@dataclass(frozen=True)
class AliasVariant:
    value: str
    strength: str
    normalized: str


@dataclass(frozen=True)
class AliasEntry:
    canonical: str
    normalized_canonical: str
    variants: tuple[AliasVariant, ...]
    products: tuple[str, ...] = ()


@dataclass(frozen=True)
class MatchAlias:
    entry: AliasEntry
    variant: AliasVariant
    exact: bool


@dataclass(frozen=True)
class SliceDoc:
    slice_id: str
    title: str
    description: str
    tags: tuple[str, ...]
    keywords: tuple[str, ...]
    file_rel: str
    platform: Optional[str]


@dataclass(frozen=True)
class RouteCandidate:
    kind: str
    product: Optional[str]
    name: str
    description: str
    relation_id: Optional[str] = None
    products: tuple[str, ...] = ()
    weight_kind: str = "product"


def _repo_root() -> Path:
    env = os.environ.get(ENV_REPO_ROOT)
    return Path(env).resolve() if env else DEFAULT_REPO_ROOT


def _kb_root() -> Path:
    return _repo_root() / "knowledge-base"


def _system_root() -> Path:
    return _kb_root() / "tooling"


def _products_yaml() -> Path:
    return _kb_root() / "products.yaml"


def _new_index_yaml(product: str, platform: str) -> Path:
    return _kb_root() / product / platform / "index.yaml"


def _aliases_yaml() -> Path:
    return _system_root() / "aliases.yaml"


def _load_yaml(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    return yaml.safe_load(path.read_text(encoding="utf-8")) or {}


@lru_cache(maxsize=1)
def _alias_catalog() -> dict[str, Any]:
    # aliases 是全局静态 KB；缓存后同一进程内避免重复解析 YAML。
    data = _load_yaml(_aliases_yaml())
    common = tuple(_parse_alias_entries(data.get("common") or []))
    products = {
        str(product): tuple(_parse_alias_entries(entries or []))
        for product, entries in (data.get("products") or {}).items()
    }
    cross_product = tuple(_parse_alias_entries(data.get("cross_product") or [], include_products=True))
    return {
        "common": common,
        "products": products,
        "cross_product": cross_product,
    }


@lru_cache(maxsize=1)
def _products_data() -> dict[str, Any]:
    if _products_yaml().exists():
        return _load_yaml(_products_yaml())
    return {}


@lru_cache(maxsize=None)
def _new_index_data(product: str, platform: str) -> dict[str, Any]:
    return _load_yaml(_new_index_yaml(product, platform))


@lru_cache(maxsize=256)
def _slice_frontmatter(path_str: str) -> dict[str, Any]:
    path = Path(path_str)
    if not path.exists():
        return {}
    text = path.read_text(encoding="utf-8")
    match = _FRONTMATTER_RE.match(text)
    if not match:
        return {}
    return yaml.safe_load(match.group(1)) or {}


@lru_cache(maxsize=256)
def _slice_body(path_str: str) -> str:
    path = Path(path_str)
    if not path.exists():
        return ""
    return path.read_text(encoding="utf-8")



def _parse_alias_entries(raw_entries: Iterable[Any], include_products: bool = False) -> list[AliasEntry]:
    parsed: list[AliasEntry] = []
    for raw in raw_entries:
        if not isinstance(raw, dict):
            continue
        canonical = str(raw.get("canonical") or "").strip()
        if not canonical:
            continue
        variants: list[AliasVariant] = []
        for item in raw.get("variants") or []:
            if isinstance(item, str):
                value = item.strip()
                strength = "weak"
            elif isinstance(item, dict):
                value = str(item.get("value") or "").strip()
                strength = str(item.get("strength") or "weak").strip().lower() or "weak"
            else:
                continue
            if not value:
                continue
            if strength not in {"strong", "weak"}:
                strength = "weak"
            variants.append(AliasVariant(value=value, strength=strength, normalized=_normalize_basic(value)))
        if not variants:
            continue
        products = tuple(str(p) for p in (raw.get("products") or [])) if include_products else ()
        parsed.append(
            AliasEntry(
                canonical=canonical,
                normalized_canonical=_normalize_basic(canonical),
                # 长变体优先，避免短词先命中把更具体的 alias 吃掉。
                variants=tuple(sorted(variants, key=lambda v: len(v.normalized), reverse=True)),
                products=products,
            )
        )
    return parsed



def _normalize_basic(text: str) -> str:
    # 搜索第一层只做可复现的基础归一化：NFKC + lower + 提取中英数字 token。
    text = unicodedata.normalize("NFKC", text or "").lower()
    parts = _WORD_RE.findall(text)
    return " ".join(part.strip() for part in parts if part.strip())



def _iter_cjk_chars(text: str) -> list[str]:
    return [ch for ch in text if "一" <= ch <= "鿿"]



def _tokenize(text: str) -> set[str]:
    tokens: set[str] = set()
    for part in _WORD_RE.findall(text or ""):
        if re.fullmatch(r"[A-Za-z0-9_]+", part):
            tokens.add(part.lower())
            continue
        if len(part) == 1:
            tokens.add(part)
            continue
        # 中文第一版不引入分词器，统一按 bigram 切，保证实现简单且可复现。
        for i in range(len(part) - 1):
            tokens.add(part[i : i + 2])
    return tokens



def _match_aliases(text: str, entries: Iterable[AliasEntry]) -> list[MatchAlias]:
    normalized = _normalize_basic(text)
    matches: list[MatchAlias] = []
    for entry in entries:
        if entry.normalized_canonical:
            if normalized == entry.normalized_canonical:
                # query 直接等于 canonical，视为最强信号。
                matches.append(
                    MatchAlias(
                        entry=entry,
                        variant=AliasVariant(
                            value=entry.canonical,
                            strength="strong",
                            normalized=entry.normalized_canonical,
                        ),
                        exact=True,
                    )
                )
                continue
            if entry.normalized_canonical in normalized:
                # canonical 仅作为 query 子串出现时，只给弱命中，避免误放大长句。
                matches.append(
                    MatchAlias(
                        entry=entry,
                        variant=AliasVariant(
                            value=entry.canonical,
                            strength="weak",
                            normalized=entry.normalized_canonical,
                        ),
                        exact=False,
                    )
                )
                continue
        for variant in entry.variants:
            if not variant.normalized:
                continue
            if normalized == variant.normalized:
                # 一个 entry 只保留首个最强 variant 命中，避免重复加分。
                matches.append(MatchAlias(entry=entry, variant=variant, exact=True))
                break
            if variant.normalized in normalized:
                matches.append(MatchAlias(entry=entry, variant=variant, exact=False))
                break
    return matches



def _expand_query_aliases(text: str, entries: Iterable[AliasEntry]) -> tuple[str, list[MatchAlias]]:
    normalized = _normalize_basic(text)
    matches = _match_aliases(text, entries)
    extras: list[str] = []
    for match in matches:
        canonical = match.entry.normalized_canonical
        if canonical and canonical not in normalized:
            # 只扩 query，不扩 KB 字段；KB 默认维护 canonical 术语。
            extras.append(canonical)
    if extras:
        normalized = " ".join(part for part in [normalized, *extras] if part)
    return normalized.strip(), matches



def _candidate_alias_text(entry: AliasEntry) -> set[str]:
    values = {entry.normalized_canonical}
    values.update(variant.normalized for variant in entry.variants)
    return {value for value in values if value}



def _alias_score(matches: Iterable[MatchAlias], searchable_text: str, allowed_products: Optional[set[str]] = None) -> int:
    best = 0
    for match in matches:
        if allowed_products is not None and match.entry.products:
            # cross-product alias 必须与当前候选产品集合完全一致，避免串路由。
            if not set(match.entry.products).issubset(allowed_products):
                continue
        for candidate in _candidate_alias_text(match.entry):
            if candidate in searchable_text:
                # alias 只取单个 entry 的最佳 boost；不做叠加，避免 schema 维护噪声放大。
                boost = 28 if match.exact and match.variant.strength == "strong" else 12
                best = max(best, boost)
                break
    return best



def _confidence(score: int) -> float:
    if score <= 0:
        return 0.0
    return min(0.95, 0.30 + score * 0.02)



def _field_hits(query_tokens: set[str], text: str) -> int:
    if not text:
        return 0
    return len(query_tokens & _tokenize(text))



def _cjk_overlap(query_text: str, field_text: str) -> int:
    return len(set(_iter_cjk_chars(query_text)) & set(_iter_cjk_chars(field_text)))


def _has_explicit_product_label(query: str, product: str) -> bool:
    normalized_query = _normalize_basic(query)
    normalized_product = _normalize_basic(product)
    escaped_product = re.escape(normalized_product)
    patterns = (
        rf"(?:产品|product)\s*(?:明确)?\s*(?:为|是|=|:)?\s*{escaped_product}(?:\s|$)",
        rf"(?:^|\s){escaped_product}\s+skill(?:\s|$)",
    )
    return any(re.search(pattern, normalized_query, re.IGNORECASE) for pattern in patterns)



def _slice_file(product: str, platform: Optional[str], file_rel: str) -> Path:
    if platform:
        new_path = _kb_root() / product / platform / file_rel
        if new_path.exists():
            return new_path
    legacy_path = _kb_root() / file_rel
    if legacy_path.exists():
        return legacy_path
    return _kb_root() / product / (platform or "") / file_rel



def _guess_platform_from_id(slice_id: str) -> Optional[str]:
    for platform in KNOWN_PLATFORMS:
        if slice_id.endswith(f"-{platform}"):
            return platform
    return None



def _slice_docs(product: str, platform: Optional[str]) -> list[SliceDoc]:
    docs: list[SliceDoc] = []
    seen: set[str] = set()

    indexes: list[tuple[dict[str, Any], Optional[str]]] = []
    if platform:
        data = _new_index_data(product, platform)
        if data:
            indexes.append((data, platform))
    else:
        for plat in KNOWN_PLATFORMS:
            data = _new_index_data(product, plat)
            if data:
                indexes.append((data, plat))

    for data, index_platform in indexes:
        for raw in data.get("slices") or []:
            slice_id = str(raw.get("id") or "")
            if not slice_id or slice_id in seen:
                continue
            seen.add(slice_id)
            docs.append(_build_slice_doc(raw, product, index_platform))

    if docs:
        return docs

    # Phase 5 过渡：仅 conference 已有 per-platform index，其它产品先回退扫描 legacy slice 目录。
    legacy_root = _kb_root() / "slices" / product
    if not legacy_root.exists():
        return docs

    candidates = sorted(legacy_root.rglob("*.md"))
    for path in candidates:
        relative = path.relative_to(_kb_root())
        parts = relative.parts
        inferred_platform: Optional[str] = None
        if len(parts) >= 4 and parts[2] in KNOWN_PLATFORMS:
            inferred_platform = parts[2]
        elif platform:
            inferred_platform = platform

        if platform and inferred_platform and inferred_platform != platform:
            continue

        frontmatter = _slice_frontmatter(str(path))
        slice_id = str(frontmatter.get("id") or "").strip()
        if not slice_id or not slice_id.startswith(f"{product}/") or slice_id in seen:
            continue

        seen.add(slice_id)
        docs.append(
            SliceDoc(
                slice_id=slice_id,
                title=str(frontmatter.get("name") or slice_id),
                description="",
                tags=(),
                keywords=tuple(str(item).strip() for item in (frontmatter.get("keywords") or []) if str(item).strip()),
                file_rel=str(relative),
                platform=inferred_platform,
            )
        )
    return docs



def _build_slice_doc(raw: dict[str, Any], product: str, platform: Optional[str]) -> SliceDoc:
    slice_id = str(raw.get("id") or "")
    file_rel = str(raw.get("file") or "")
    path = _slice_file(product, platform, file_rel)
    frontmatter = _slice_frontmatter(str(path)) if file_rel else {}
    keywords = tuple(str(item).strip() for item in (frontmatter.get("keywords") or []) if str(item).strip())
    title = str(raw.get("name") or frontmatter.get("name") or slice_id)
    description = str(raw.get("description") or "")
    tags = tuple(str(tag).strip() for tag in (raw.get("tags") or []) if str(tag).strip())
    return SliceDoc(
        slice_id=slice_id,
        title=title,
        description=description,
        tags=tags,
        keywords=keywords,
        file_rel=file_rel,
        platform=platform or _guess_platform_from_id(slice_id),
    )



def _route_candidates() -> list[RouteCandidate]:
    candidates: list[RouteCandidate] = []
    products_yaml = _products_data()
    for raw in products_yaml.get("products") or []:
        candidates.append(
            RouteCandidate(
                kind="product",
                product=str(raw.get("id") or ""),
                name=str(raw.get("name") or raw.get("id") or ""),
                description=str(raw.get("description") or ""),
            )
        )
    for raw in products_yaml.get("cross_product_scenarios") or []:
        products = tuple(str(p) for p in (raw.get("products") or []))
        candidates.append(
            RouteCandidate(
                kind="cross_product",
                product=None,
                name=str(raw.get("name") or raw.get("id") or ""),
                description=str(raw.get("description") or ""),
                relation_id=str(raw.get("id") or ""),
                products=products,
                weight_kind="scenario",
            )
        )
    return [candidate for candidate in candidates if candidate.name]



def _score_route_candidate(query: str, candidate: RouteCandidate) -> tuple[int, dict[str, Any]]:
    catalog = _alias_catalog()
    common_entries = catalog["common"]
    product_entries = catalog["products"].get(candidate.product or "", ()) if candidate.kind == "product" else ()
    cross_entries = catalog["cross_product"] if candidate.kind == "cross_product" else ()
    query_entries = (*common_entries, *product_entries, *cross_entries)
    normalized_query, alias_matches = _expand_query_aliases(query, query_entries)
    query_tokens = _tokenize(normalized_query)

    product_exact_boost = 0
    if candidate.kind == "product" and candidate.product:
        normalized_product = _normalize_basic(candidate.product)
        if _has_explicit_product_label(query, candidate.product):
            product_exact_boost = 100
        elif normalized_query == normalized_product:
            # route 层只有 product id 精确命中时才直接拉满 high confidence。
            product_exact_boost = 100
        elif normalized_query and normalized_query in normalized_product:
            product_exact_boost = 30
        elif any(match.exact and match.entry.normalized_canonical == normalized_product for match in alias_matches):
            product_exact_boost = 100

    searchable = " ".join(part for part in [
        _normalize_basic(candidate.name),
        _normalize_basic(candidate.description),
        _normalize_basic(candidate.product or ""),
        _normalize_basic(candidate.relation_id or ""),
    ] if part)
    allowed_products = {candidate.product} if candidate.kind == "product" and candidate.product else set(candidate.products)
    alias_boost = _alias_score(alias_matches, searchable, allowed_products or None)
    scenario_weight_boost = 6 if candidate.weight_kind == "scenario" else 0
    product_name_hits = _field_hits(query_tokens, _normalize_basic(candidate.name)) if candidate.kind == "product" else 0
    relation_hits = 0
    if candidate.kind == "cross_product":
        relation_hits = _field_hits(query_tokens, _normalize_basic(candidate.name))
    product_desc_hits = _field_hits(query_tokens, _normalize_basic(candidate.description)) if candidate.kind == "product" else 0
    relation_desc_hits = _field_hits(query_tokens, _normalize_basic(candidate.description)) if candidate.kind == "cross_product" else 0
    cjk_overlap = _cjk_overlap(normalized_query, searchable)

    score = (
        product_exact_boost
        + alias_boost
        + scenario_weight_boost
        + product_name_hits * 5
        + relation_hits * 4
        + product_desc_hits * 3
        + relation_desc_hits * 2
        + cjk_overlap
    )
    # route 返回 payload 时直接带上给调用方可消费的归因字段，避免调用方再推断候选类型。
    payload: dict[str, Any] = {
        "kind": candidate.kind,
        "confidence": _confidence(score),
        "reason": "matched route candidate",
    }
    if candidate.kind == "product":
        payload["product"] = candidate.product
        payload["name"] = candidate.name
    else:
        payload["relation_id"] = candidate.relation_id
        payload["products"] = list(candidate.products)
        payload["name"] = candidate.name
    return score, payload



def _score_slice_doc(query: str, product: str, doc: SliceDoc) -> tuple[int, dict[str, Any]]:
    catalog = _alias_catalog()
    entries = (*catalog["common"], *catalog["products"].get(product, ()))
    normalized_query, alias_matches = _expand_query_aliases(query, entries)
    query_tokens = _tokenize(normalized_query)
    normalized_slice_id = _normalize_basic(doc.slice_id)
    title_text = _normalize_basic(doc.title)
    keyword_text = _normalize_basic(" ".join(doc.keywords))
    tag_text = _normalize_basic(" ".join(doc.tags))
    desc_text = _normalize_basic(doc.description)
    # Do not let product-level aliases score against the slice_id prefix
    # (`conference/...`), otherwise broad product terms like "视频会议" will
    # over-boost every slice under the same product.
    searchable = " ".join(part for part in [title_text, keyword_text, tag_text, desc_text] if part)

    exact_boost = 0
    if normalized_query == normalized_slice_id:
        exact_boost = 100
    elif normalized_query and normalized_query in normalized_slice_id:
        exact_boost = 30

    alias_boost = _alias_score(alias_matches, searchable)
    title_hits = _field_hits(query_tokens, title_text)
    keyword_hits = _field_hits(query_tokens, keyword_text)
    tag_hits = _field_hits(query_tokens, tag_text)
    description_hits = _field_hits(query_tokens, desc_text)
    cjk_overlap = _cjk_overlap(normalized_query, searchable)

    score = (
        exact_boost
        + alias_boost
        + title_hits * 5
        + keyword_hits * 4
        + tag_hits * 3
        + description_hits * 2
        + cjk_overlap
    )
    path = _slice_file(product, doc.platform, doc.file_rel)
    path_str = str(path.relative_to(_repo_root())) if path.exists() else doc.file_rel
    return score, {
        "slice_id": doc.slice_id,
        "title": doc.title,
        "path": path_str,
        "confidence": _confidence(score),
    }



def _search_error_code_in_file(path: Path, code: int) -> bool:
    if not path.exists():
        return False
    text = _slice_body(str(path))
    # 错误码查找绕开打分链路，直接做文件级 exact match，保证 troubleshoot 场景稳定。
    pattern = re.compile(_ERROR_CODE_RE.pattern.format(code=re.escape(str(code))))
    return bool(pattern.search(text))


class Search:
    """KB 搜索。无状态，全为 classmethod。"""

    @classmethod
    def route(cls, query: str) -> dict[str, Any]:
        if not query or not query.strip():
            raise InvalidInputError("query 不能为空")
        candidates = _route_candidates()
        if not candidates:
            return {"mode": "route", "status": "not_found", "candidates": [], "ask_user": None}

        scored = []
        for candidate in candidates:
            score, payload = _score_route_candidate(query, candidate)
            if score > 0:
                scored.append((score, payload))
        scored.sort(key=lambda item: item[0], reverse=True)
        if not scored:
            return {"mode": "route", "status": "not_found", "candidates": [], "ask_user": None}

        top_score = scored[0][0]
        # route 层允许 medium confidence 继续路由；只有相邻候选过近时才要求追问。
        ambiguous = len(scored) >= 2 and scored[1][0] >= top_score * 0.8 and top_score < 100
        top_candidates = [payload for _, payload in scored[:3]]
        ask_user = None
        if ambiguous:
            labels = []
            for candidate in top_candidates:
                if candidate["kind"] == "product":
                    labels.append(candidate.get("name") or candidate.get("product") or "")
                else:
                    labels.append(" + ".join(candidate.get("products") or []))
            ask_user = f"你的需求可能对应多个方向（{'、'.join(label for label in labels if label)}），你具体想做哪个？"
        return {
            "mode": "route",
            "status": "ambiguous" if ambiguous else "exact",
            "candidates": top_candidates if ambiguous else top_candidates[:1],
            "ask_user": ask_user,
        }

    @classmethod
    def slices(
        cls,
        product: str,
        query: Optional[str] = None,
        platform: Optional[str] = None,
        error_code: Optional[int] = None,
        limit: int = 5,
    ) -> dict[str, Any]:
        if product not in KNOWN_PRODUCTS:
            raise InvalidInputError(f"未知 product：{product}（已知：{sorted(KNOWN_PRODUCTS)}）")
        if not query and error_code is None:
            raise InvalidInputError("query 和 error_code 必须提供其中一个")

        docs = _slice_docs(product, platform)
        if not docs:
            return {
                "mode": "slices",
                "status": "not_found",
                "candidates": [],
                "ask_user": None,
                "reason": f"product '{product}' 的 KB 索引不存在或无 slice",
            }

        if error_code is not None:
            hits = []
            for doc in docs:
                path = _slice_file(product, doc.platform, doc.file_rel)
                if _search_error_code_in_file(path, error_code):
                    hits.append({
                        "slice_id": doc.slice_id,
                        "title": doc.title,
                        "path": str(path.relative_to(_repo_root())) if path.exists() else doc.file_rel,
                        "confidence": 0.99,
                    })
            if not hits:
                return {
                    "mode": "slices",
                    "status": "not_found",
                    "candidates": [],
                    "ask_user": None,
                    "reason": f"错误码 {error_code} 未在任何 slice 中找到",
                }

            def _error_code_rank(item: dict[str, Any]) -> tuple[int, str]:
                slice_id = str(item.get("slice_id") or "")
                title = str(item.get("title") or "").lower()
                is_error_catalog = int(slice_id.endswith("/error-codes") or "错误码" in title or "error code" in title)
                return (-is_error_catalog, slice_id)

            hits.sort(key=_error_code_rank)
            return {
                "mode": "slices",
                "status": "exact" if len(hits) == 1 else "ambiguous",
                "candidates": hits[:limit],
                "ask_user": None,
            }

        scored = []
        for doc in docs:
            score, payload = _score_slice_doc(query or "", product, doc)
            if score > 0:
                scored.append((score, payload))
        scored.sort(key=lambda item: item[0], reverse=True)
        if not scored:
            return {
                "mode": "slices",
                "status": "not_found",
                "candidates": [],
                "ask_user": None,
                "reason": f"query '{query}' 未命中任何 slice",
            }

        top_score = scored[0][0]
        # slices 层比 route 更保守：多个能力分数接近时宁可 ask_user，不直接拍板。
        ambiguous = len(scored) >= 2 and scored[1][0] >= top_score * 0.8 and top_score < 50
        top_candidates = [payload for _, payload in scored[:limit]]
        return {
            "mode": "slices",
            "status": "ambiguous" if ambiguous else "exact",
            "candidates": top_candidates if ambiguous else top_candidates[:1],
            "ask_user": "找到多个相关 slice，你具体想了解哪个能力？" if ambiguous else None,
        }


def _parse_args(argv: list[str]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    i = 0
    while i < len(argv):
        arg = argv[i]
        if arg.startswith("--"):
            key = arg[2:]
            if i + 1 < len(argv) and not argv[i + 1].startswith("--"):
                out[key] = argv[i + 1]
                i += 2
            else:
                out[key] = True
                i += 1
        else:
            i += 1
    return out


def _cli_route(args: list[str]) -> int:
    kv = _parse_args(args)
    query = kv.get("query")
    if not query or isinstance(query, bool):
        print("ERROR: --query 必须提供", file=sys.stderr)
        return 1
    try:
        result = Search.route(query=query)
    except InvalidInputError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


def _cli_slices(args: list[str]) -> int:
    kv = _parse_args(args)
    product = kv.get("product")
    if not product or isinstance(product, bool):
        print("ERROR: --product 必须提供", file=sys.stderr)
        return 1

    query = kv.get("query")
    if isinstance(query, bool):
        query = None

    error_code = None
    raw_error = kv.get("error-code")
    if raw_error and not isinstance(raw_error, bool):
        try:
            error_code = int(str(raw_error).lstrip("-"))
        except ValueError:
            print("ERROR: --error-code 必须是数字", file=sys.stderr)
            return 1

    platform = kv.get("platform")
    if isinstance(platform, bool):
        platform = None

    try:
        result = Search.slices(
            product=str(product),
            query=str(query) if query else None,
            platform=str(platform) if platform else None,
            error_code=error_code,
            limit=int(kv.get("limit") or 5),
        )
    except InvalidInputError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


def main() -> int:
    argv = sys.argv[1:]
    if not argv:
        print(__doc__)
        return 0
    handlers = {"route": _cli_route, "slices": _cli_slices}
    cmd = argv[0]
    handler = handlers.get(cmd)
    if not handler:
        print(f"未知子命令：{cmd}", file=sys.stderr)
        return 1
    return handler(argv[1:])


if __name__ == "__main__":
    raise SystemExit(main())
