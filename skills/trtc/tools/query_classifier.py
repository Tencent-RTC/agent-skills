"""Deterministic query kind classifier for dispatcher/domain skill routing.

两级分类：

  Level 1 — detect_query_kind()
    返回 "error_code" | "symptom_like" | "capability"
    区分 troubleshoot 类（错误码 / 症状描述）和功能类查询。

  Level 2 — detect_capability_intent()（仅在 Level 1 返回 "capability" 时调用）
    返回 "integrate" | "lookup" | "ambiguous"
    区分"想做集成/构建"和"想了解/查文档"，辅助 dispatcher 路由决策：
      integrate  → domain skill onboarding（写代码路径）
      lookup     → trtc-docs（文档查询路径，默认兜底）
      ambiguous  → 仅保留给空 query 等无法判别场景
"""

from __future__ import annotations

import os
import json
import re
import sys
from functools import lru_cache
from pathlib import Path
from typing import Iterable, Optional

import yaml

THIS_FILE = Path(__file__).resolve()
DEFAULT_REPO_ROOT = THIS_FILE.parent.parent.parent.parent
ENV_REPO_ROOT = "TRTC_REPO_ROOT"
_ERROR_CODE_RE = re.compile(
    r"(?:"
    r"(?:error[_\s]?code|错误码|ERR[_-]?)\s*[：:\s]?\s*-?\d{4,6}"  # 显式上下文 + 数字
    r"|\w+Error[：:]"  # TUICallEngineError: 等命名错误模式
    r"|(?<![A-Za-z0-9])-?\d{5,6}(?![A-Za-z0-9])"  # 独立 5-6 位数字（4位太易误判端口/版本号）
    r")",
    re.IGNORECASE
)
_ERROR_CODE_HINT_RE = re.compile(r"(?:error[_\s]?code|错误码)", re.IGNORECASE)
_MINIMAL_SYMPTOMS = (
    "失败", "报错", "黑屏", "黑帧", "crash", "error", "闪退",
    "没声音", "无声音", "听不到", "看不到", "收不到", "卡住", "超时",
    "断开", "进不去", "不工作", "定格", "升级后", "无法",
    "canceled", "cancelled", "没有响应", "没反应",
)
# 词表缺失时的最小内置信号，覆盖最常见的中英文表达
_MINIMAL_INTEGRATE_SIGNALS = (
    "接入", "集成", "搭建", "我要做", "我想做", "做一个", "快速接入",
    "如何实现", "怎么实现",
    "how to build", "how to implement", "how to integrate",
    "how to set up", "how to add", "integrate", "implement",
    "build a", "create a", "set up", "get started", "quickstart",
)
_MINIMAL_LOOKUP_SIGNALS = (
    "是什么", "有哪些", "支持吗", "能否", "可以吗", "有什么区别", "对比", "原理",
    "what is", "what are", "does it support", "can it",
    "how does it work", "how does", "vs", "compared to",
    "difference between", "overview", "explain",
)
_BUILD_PATTERNS = (
    re.compile(r"^[\w\u4e00-\u9fff\s.+/-]{1,48}(?:集成|接入|搭建)$", re.IGNORECASE),
    re.compile(r"(?:如何|怎么|how to).{0,12}(?:实现|集成|接入|搭建|新增|添加|嵌入|迁移|改造|重构|定制)", re.IGNORECASE),
    re.compile(r"(?:帮我|请|继续|需要|我要|我想|想要|想做).{0,12}(?:实现|集成|接入|搭建|新增|添加|迁移|做)", re.IGNORECASE),
    re.compile(r"(?:重新|再次|重复|重跑).{0,16}(?:执行|运行|接入|集成|流程|测试)", re.IGNORECASE),
    re.compile(r"(?:执行|运行).{0,16}(?:接入|集成)(?:流程|测试)?", re.IGNORECASE),
    re.compile(r"(?:给现有项目加|加到项目里|接到现有项目里|接到项目里|接进现有项目里|接进项目里)", re.IGNORECASE),
    re.compile(r"(?:在|给).{0,16}(?:项目|应用|页面|直播间|房间).{0,16}(?:集成|接入|增加|新增|添加|加)", re.IGNORECASE),
    re.compile(r"(?:实现|implement).{0,24}(?:功能|页面|模块|场景|workflow|battle|gift|barrage|co-guest|cohost|comments?|feature)", re.IGNORECASE),
    re.compile(r"(?:add|integrate|implement|wire up|migrate).{0,28}(?:to|into|in).{0,16}(?:my|our|existing).{0,16}(?:project|app|vue|react|ios|android|flutter)", re.IGNORECASE),
    re.compile(r"(?:walk me through|help me (?:build|integrate|implement)|how to (?:build|integrate|implement|set up|add)|get started with|quick start(?: for)?)", re.IGNORECASE),
)
_LOOKUP_PATTERNS = (
    re.compile(r"(?:是什么|有哪些|是否支持|支持什么|支持.{0,16}吗|能否|可以吗|有没有|什么区别|有什么区别|有什么不同|对比|原理|机制|概念|说明|介绍一下|了解)", re.IGNORECASE),
    re.compile(r"(?:如何|怎么|how to).{0,12}(?:配置|开启|调用|使用|获取|展示|显示|判断|查看|填写|设置|导入)", re.IGNORECASE),
    re.compile(r"(?:获取|查询|查找|看看).{0,16}(?:文档|docs|documentation|说明)", re.IGNORECASE),
    re.compile(r"(?:错误码|error code|字段含义|调用方式|从哪里来|在哪里|官方方式|导入和使用方式|api 用法|api 调用方式|技术实现细节|基础集成文档|对照表)", re.IGNORECASE),
    re.compile(r"(?:what is|what are|does it support|can it|is it possible|how does it work|difference between|what's the difference|compared to|vs|overview|concept|explain|documentation|docs)", re.IGNORECASE),
)
_QUESTION_STARTERS = (
    "什么", "为什么", "为何", "怎么", "如何", "是否", "能否", "可以", "支持", "有没有",
    "what", "why", "how", "does", "can", "is", "which", "where",
    "了解", "查询", "获取",
)
_GENERIC_INTEGRATE_SIGNALS = {
    "接入", "集成", "integrate", "implement", "build a", "create a", "set up", "get started", "quickstart", "quick start",
}
_INTEGRATION_CONTEXT_PATTERNS = (
    re.compile(r"(?:已|已经|当前).{0,4}(?:集成|接入)", re.IGNORECASE),
    re.compile(r"(?:集成|接入)(?:中|后)", re.IGNORECASE),
    re.compile(r"integrated?\s+(?:with|in)", re.IGNORECASE),
)


def _repo_root() -> Path:
    env = os.environ.get(ENV_REPO_ROOT)
    return Path(env).resolve() if env else DEFAULT_REPO_ROOT


def _symptom_keywords_path() -> Path:
    return _repo_root() / "knowledge-base" / "tooling" / "symptom-keywords.yaml"


def _intent_signals_path() -> Path:
    return _repo_root() / "knowledge-base" / "tooling" / "intent-signals.yaml"


@lru_cache(maxsize=1)
def load_symptom_keywords() -> tuple[str, ...]:
    path = _symptom_keywords_path()
    if not path.exists():
        # fail-open：系统词表缺失时退回最小内置词集，而不是让调用方整体失效。
        return _MINIMAL_SYMPTOMS
    try:
        data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    except Exception:
        return _MINIMAL_SYMPTOMS
    raw = data.get("symptom_keywords") or []
    values = list(_MINIMAL_SYMPTOMS)
    for item in raw:
        text = str(item).strip().lower()
        if text and text not in values:
            values.append(text)
    return tuple(values)


@lru_cache(maxsize=1)
def load_intent_signals() -> tuple[tuple[str, ...], tuple[str, ...]]:
    """加载 integrate / lookup 信号词。

    返回 (integrate_signals, lookup_signals)，两者均已 lowercase。
    fail-open：文件缺失或解析失败时退回最小内置信号集。
    """
    path = _intent_signals_path()
    if not path.exists():
        return _MINIMAL_INTEGRATE_SIGNALS, _MINIMAL_LOOKUP_SIGNALS
    try:
        data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    except Exception:
        return _MINIMAL_INTEGRATE_SIGNALS, _MINIMAL_LOOKUP_SIGNALS

    def _load_list(key: str, defaults: tuple[str, ...]) -> tuple[str, ...]:
        raw = data.get(key) or []
        values = list(defaults)
        for item in raw:
            text = str(item).strip().lower()
            if text and text not in values:
                values.append(text)
        return tuple(values)

    integrate = _load_list("integrate_signals", _MINIMAL_INTEGRATE_SIGNALS)
    lookup = _load_list("lookup_signals", _MINIMAL_LOOKUP_SIGNALS)
    return integrate, lookup


def _normalize_query(query: str) -> str:
    # classifier 只做轻量空白归一化；更重的 normalize 留给 search.py。
    return " ".join((query or "").strip().lower().split())


def _has_error_code(query: str) -> bool:
    query = query or ""
    normalized = _normalize_query(query)
    if re.fullmatch(r"-?\d{4,6}", normalized):
        return True
    return bool(_ERROR_CODE_RE.search(query) or _ERROR_CODE_HINT_RE.search(query))


def _has_symptom_token(query: str, keywords: Iterable[str]) -> bool:
    normalized = _normalize_query(query)
    return any(token and token in normalized for token in keywords)


def _matches_any(query: str, patterns: Iterable[re.Pattern[str]]) -> bool:
    return any(pattern.search(query) for pattern in patterns)


def _has_non_generic_integrate_signal(query: str, signals: Iterable[str]) -> bool:
    hits = [sig for sig in signals if sig and sig in query and sig not in _GENERIC_INTEGRATE_SIGNALS]
    return bool(hits)


def _looks_like_question(query: str, raw_query: str) -> bool:
    if "?" in raw_query or "？" in raw_query:
        return True
    return query.startswith(_QUESTION_STARTERS)


def _is_integration_context_only(query: str) -> bool:
    return _matches_any(query, _INTEGRATION_CONTEXT_PATTERNS)


def detect_query_kind(query: str, symptom_keywords: Optional[Iterable[str]] = None) -> str:
    normalized = _normalize_query(query)
    if not normalized:
        return "capability"
    if _has_error_code(normalized):
        # error code 是最强 troubleshoot 信号，优先于其他症状词判断。
        return "error_code"
    keywords = tuple(symptom_keywords) if symptom_keywords is not None else load_symptom_keywords()
    if _has_symptom_token(normalized, keywords):
        # symptom_like 只负责快慢路径分流，不在这里继续做产品/能力级分类。
        return "symptom_like"
    return "capability"


def detect_capability_intent(
    query: str,
    integrate_signals: Optional[Iterable[str]] = None,
    lookup_signals: Optional[Iterable[str]] = None,
) -> str:
    """capability 查询的二级意图分类。

    仅在 detect_query_kind() 返回 "capability" 后调用。

    Returns:
        "integrate"  用户想在项目里接入 / 构建功能 → domain skill onboarding
        "lookup"     用户想了解 / 查阅文档 → trtc-docs
        "ambiguous"  仅用于空 query 等无法判别场景

    判断逻辑：
        - 只看 query 里是否含有信号词（substring，已 lowercase），不看 session 状态。
        - 只要命中强 integration 规则，就走 integrate。
        - 其他所有 capability 查询默认都走 lookup，优先保证 docs 召回。
    """
    raw_query = query or ""
    normalized = _normalize_query(raw_query)
    if not normalized:
        return "ambiguous"

    build_match = _matches_any(normalized, _BUILD_PATTERNS)
    lookup_match = _matches_any(normalized, _LOOKUP_PATTERNS)

    # 白名单策略：只有任务级集成/改造诉求才进入 integrate。
    if build_match:
        return "integrate"

    # 文档/API/字段/错误码/组件用法查询优先判 lookup。
    if lookup_match:
        return "lookup"

    loaded_int, loaded_lkp = load_intent_signals()
    int_sigs = tuple(integrate_signals) if integrate_signals is not None else loaded_int
    lkp_sigs = tuple(lookup_signals) if lookup_signals is not None else loaded_lkp

    has_integrate = _has_non_generic_integrate_signal(normalized, int_sigs)
    has_lookup = any(sig and sig in normalized for sig in lkp_sigs)

    # “集成中 / 接入后 / 已集成” 这类是上下文说明，不应单独触发 integrate。
    if not has_integrate and _is_integration_context_only(normalized):
        has_lookup = True or has_lookup

    if has_integrate and not has_lookup:
        return "integrate"
    if has_lookup:
        return "lookup"

    # 两边都没命中时，只要整体像提问，就保守落到 docs 路径，避免漏掉文档查询。
    if _looks_like_question(normalized, raw_query):
        return "lookup"

    # 默认兜底到 docs：模糊 prompt 也优先给文档检索，避免漏路由。
    return "lookup"


def _parse_args(argv: list[str]) -> dict[str, str | bool]:
    out: dict[str, str | bool] = {}
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


def main() -> int:
    argv = sys.argv[1:]
    if not argv:
        print(__doc__)
        return 0
    kv = _parse_args(argv)
    query = kv.get("query")
    if not query or isinstance(query, bool):
        print("ERROR: --query 必须提供", file=sys.stderr)
        return 1
    kind = detect_query_kind(str(query))
    result: dict = {"query": query, "kind": kind}
    if kind == "capability":
        result["capability_intent"] = detect_capability_intent(str(query))
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
