"""
tools/flow.py
=============

TRTC AI Integration —— flow 路由 + scenario 匹配 + phase 进入。

session.py 是状态总线（"我在哪、做到哪一步"），flow.py 是控制流总线
（"该走哪条路、加载哪份指引"）。两者职责互补：

  - session.py 答："给定写操作，能否合 schema 落到磁盘？"
  - flow.py   答："给定用户输入 + 当前 session 状态，下一步该进入哪个 flow？"

flow.py 是 SKILL.md 在做路由 / 进入新 phase 时的 first-class tool。
所有"进入某个 flow / 切换 scenario"的动作都必须经过它，让 session 副作用
（active_flow / active_scenario / flow_entered）能被 hook 物理强制依赖。


============================================================
设计讨论备忘（2026-06-10）
============================================================

# 为什么需要这个工具

skill 体系里"加载某份 flow 指引（如 flows/onboarding.md）"过去靠 prose：
SKILL.md 里写"请先 Read flows/onboarding.md"，模型自由决定读不读。
问题：

  1. 跳过没有副作用 —— 模型可能因 context 紧张直接跳过
  2. hook 没有可断言的事实 —— 没法做 "没 enter flow 不能 Edit/Write" 兜底
  3. 跨 agent 不一致 —— Claude / CodeBuddy / Codex 对 prose 指令的服从度不同
  4. trace 缺失 —— 不知道模型有没有真的读过

flow.py 把 "决定走哪条路 + 加载内容 + 写状态副作用" 收口到一个 tool call：

  python3 -m tools.flow enter --phase onboarding --product conference
    ↓ 工具读 skills/trtc-conference/flows/onboarding.md，stdout 推给模型
    ↓ 同时调 session.py 写 active_flow=onboarding / flow_entered=true
  → 后续模型尝试 Edit / Write 时，hook 检查 flow_entered，可阻断

观测 / 一致性 / hook 可断言性都是 tool 化的副产品。


# 三大职责（→ 5 个 CLI 子命令）

  1. ROUTE：粗分流——根据用户 intent 识别 product + platform
            （如果 SKILL.md 没传入）。
            脚本驱动，不依赖 LLM 判断。识别不出时返回 ask_user prompt，
            让 caller AskUserQuestion 收口。

  2. MATCH-SCENARIO：scenario 匹配——读取 product/platform 下的 scenario
            frontmatter，跟用户 intent 做关键词匹配，返回三类结果之一：

              - specific：命中具体场景（如 1v1-video-consultation）
              - vague：只命中"标准 / 通用"场景（如 general-conference）
              - no_match：完全不命中

            specific 命中且 scenario 有 template → 返回 fork option（模板 vs 自选）；
            vague 命中且 scenario 有 alternative_integrations → 返回 fork option（如 RoomKit vs 自选）；
            no_match → 不出 fork，caller 应直接进标准 onboarding。

            ROUTE / MATCH-SCENARIO 都是 read-only，不写 session。

  3. ENTER：加载某个 flow（phase 文件或 playbook）的 markdown 内容到 stdout
            + 写 session 副作用（active_flow / flow_entered / active_scenario / flow_state 清空）。

退出对称做 EXIT（用户主动放弃 flow 或 flow 完成时调）。


# Phase vs Playbook 的区分

  Phase（标准管线）：
    onboarding / topic
    走完整 phase 流程，状态机（state_machine.py）推进 execution_queue
    flow 文件位于 skills/trtc-{product}/flows/{phase}.md

  Playbook（bypass 路径）：
    medical-quickstart / official-roomkit / ...
    跳过状态机，一键完成（复制模板 / 装包 + 配 API）
    flow 文件位于 skills/trtc-{product}/playbooks/{playbook}.md

  active_flow 字段同时承载两种值；hook 区分时按 active_flow 是 phase 名还是
  playbook id 判断。约定：

    phase    用小写单词           onboarding / topic
    playbook 用 kebab-case        medical-quickstart / official-roomkit


# 关键字匹配策略

  match_scenario 用 substring 匹配 + 简单 ranking：

    for scenario in scenarios:
        score = 0
        for kw in scenario.trigger.intent_keywords:
            if kw in intent:
                score += len(kw)         # 长关键词权重高
        if score > 0:
            candidates.append((scenario, score))
    candidates.sort(key=score, reverse=True)

  跨 agent 一致：纯脚本逻辑，不依赖 LLM 判断。
  缺陷：用户用同义词时漏匹配（"视频会议" vs "视频通话"）。
  接受：边缘 case 退化到 no_match → 标准 onboarding，仍能完成需求。
  未来：如不稳定，加 search.py 模糊匹配做 fallback（详见 §Open work）。


# Fork option 是数据，不直接调 AskUserQuestion

  AskUserQuestion 是模型权限，脚本调不了。flow.py 的输出是
  "fork 选项菜单" + 给用户解释的简介。caller（SKILL.md prose）读到 stdout
  上的 JSON 后自行 AskUserQuestion 渲染。

  这样的设计：
    - flow.py 保持 read-only / write 职责单一，不混入交互逻辑
    - 不同 agent 渲染选项的方式可能不同（chat 框 vs 命令行 prompt），
      让 caller 决定
    - 测试方便：脚本输出可断言，不依赖人交互


# 为什么 enter 不在 flow.py 里读 flow 文件并打印？

  其实就是这么做的。flow.py 读 skills/trtc-{product}/flows/{phase}.md → stdout。
  模型的 tool call 自动收 stdout 进 context。

  这一步的关键是：不让模型自主决定"读不读 flow 文件"，
  而是工具调用一次就把内容拿到了，且 session.flow_entered 副作用同步落定。


# 跟 session.py 的依赖关系

  flow.py import session.py（同目录）：

      from tools.session import Session, ConflictError, MissingError, ...

  典型调用序列：

      sess = Session.load()
      with sess.transaction() as upd:
          upd.active_flow = phase
          upd.flow_entered = True
          upd.flow_state = {}              # 新 flow 独立命名空间

  反过来 session.py 不 import flow.py，避免循环依赖。
  session 是 lower-level 总线，flow 是 higher-level 路由。


# 关键不变量

  1. 进入新 flow 必清空 flow_state：每个 flow 拥有独立的 flow_state 命名空间，
     避免上一个 flow 残留状态污染下一个。
  2. enter 是 idempotent：active_flow 已经是目标且 flow_entered=true，
     重复调返回当前内容 + 不写 session（不递增 state_version），仅 emit trace。
  3. exit 不删除历史：仅写 flow_entered=false / active_flow=null，
     flow_state 不清（保留供 trace），但 caller 不应该再依赖它。
  4. scenario 匹配是 read-only：match-scenario 不写 session，
     只在 enter 阶段才落副作用（避免误匹配污染状态）。
  5. ROUTE 是 read-only：仅识别 product/platform 返回，不创建 session。
     session 创建归 dispatcher（先 Session.create() 再 flow.enter()）。


# 文件路径解析

  flow.py 住在 skills/trtc/tools/flow.py，repo root 由它的位置反推：

      Path(__file__).parent.parent.parent.parent  # = repo root
                       ↑           ↑           ↑           ↑
                     tools       trtc        skills      repo_root

  KB 位置：{repo_root}/knowledge-base/
  product skill 位置：{repo_root}/skills/trtc-{product}/

  TRTC_REPO_ROOT 环境变量可覆盖（worktree 测试 / 打包发布用）。


# 关于 ui_mode 字段（2026-06-12 已对齐）

  session.py 的 v2 schema 现已包含顶层 ui_mode 字段，flow.py 也已跟上：

      - enter(playbook=...) 时：读取 playbook frontmatter.ui_mode 并写入 session
      - enter(phase=...) 时：不在 flow.py 内推断 ui_mode，交给 onboarding flow
        在用户完成 fork / 模式决策后写入

  这样做的原因：
    - hook / topic / codegen 读取 ui_mode 时不必反推 active_flow
    - playbook 的 ui_mode 是静态配置，适合在 enter 时一次性落盘
    - phase=onboarding 的 ui_mode 依赖后续交互，不应在 enter 时抢先猜测


============================================================
公开接口
============================================================

# Python API

  from tools.flow import Flow, MatchResult, RouteResult

  # 1) 路由：识别 product + platform（如 SKILL.md 没传入）
  routing = Flow.route(intent="做 1v1 视频问诊")
  # → routing.product = 'conference', routing.platform = None
  # → routing.confidence = 'low', routing.ask_user = "你的目标平台是？..."

  # 2) 匹配 scenario
  match = Flow.match_scenario(
      intent="做 1v1 视频问诊",
      product="conference",
      platform="web",
  )
  # match.kind ∈ {'specific', 'vague', 'no_match'}
  # match.scenario_id, match.candidates, match.fork_options

  # 3) 进入 flow（phase 或 playbook，二选一）
  content = Flow.enter(
      product="conference",
      platform="web",
      phase="onboarding",                  # 或 playbook='medical-quickstart'
      scenario="1v1-video-consultation",   # 可选，会写 session.active_scenario
  )
  # content 是 flow markdown 字符串
  # 副作用：session.active_flow / flow_entered=true / active_scenario / flow_state={}

  # 4) 退出
  Flow.exit()

  # 5) 当前状态摘要
  Flow.current()


# CLI（hook 或 SKILL prose 用 subprocess）

  python3 -m tools.flow route --intent "..."
  python3 -m tools.flow match-scenario --intent "..." --product X --platform Y
  python3 -m tools.flow enter --phase onboarding --product conference [--platform web] [--scenario X]
  python3 -m tools.flow enter --playbook medical-quickstart --product conference
  python3 -m tools.flow exit
  python3 -m tools.flow current

  退出码：
    0 = 成功
    1 = 输入错误（intent 缺失 / product 非法 / phase+playbook 都给 / 等）
    2 = 资源缺失（scenario 文件不存在 / phase 文件不存在 / playbook 不存在）
    3 = session 错误（不存在 / 损坏 / 字段非法）
    4 = CAS 冲突（罕见，caller 应重读重试）


============================================================
Open work / 待做（TODO，截至 2026-06-10）
============================================================

# A. match-scenario 关键词匹配回退到 search.py 模糊匹配
#
#    现状：纯 substring + 长度加权。同义词漏匹配（"视频会议" vs "视频通话"）。
#    备选：调 search.py 用 description / tags 做 BM25 / 向量检索。
#    实施时机：bootstrap probe 跨 agent 测过、确认 substring 不够再加。

# B. cross-product scenario 匹配
#
#    现状：仅匹配单产品 scenario（active_scenario）。
#    products.yaml.cross_product_scenarios 顶层字段已规划（详见
#    target-architecture.md §4.1），跨产品 scenario 写入 active_cross_scenario。
#    实施时机：跨产品需求出现时再加（短期内无 case）。

# C. enter 时的 hook 联动 contract test
#
#    enter 之后 hook 的"flow_entered=true 之前不能 Edit/Write"特性应该立即生效。
#    contract test 位置：tests/contract/test_flow_load_sequence.sh
#    验证：先 Edit 应被拒；先 enter 再 Edit 应通过。

# D. ui_mode 字段已落地（2026-06-12）
#
#    决议：ui_mode 顶层字段，enter() 进 playbook 时读 frontmatter.ui_mode 写入 session。
#    enter() 进 phase 时不写 ui_mode——由 onboarding flow 内部 fork 决策后写。
#    playbook frontmatter 需声明 ui_mode 字段（如 official-roomkit.md → ui_mode: official-roomkit）。

# E. abandon detection / stale flow trace
#
#    如果 active_flow 长期没 exit 也没推进（用户半路放弃），trace 看不出。
#    需要加 last_advance_at 字段或 trace digest 工具检测"flow 长期挂起"。

# F. route 关键词词典外部化
#
#    现状：product_kw / platform_kw 硬编码在 route() 里。
#    应该从 products.yaml.products[].description / aliases 读取。
#    products.yaml 实装时同步迁移。

============================================================
"""

from __future__ import annotations

import importlib
import importlib.util
import json
import os
import re
import sys
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Optional

import yaml

# ============================================================
# session.py 依赖（同目录）
# ============================================================
#
# 支持三种调用方式：
#   1. python3 -m tools.flow ...           （需 PYTHONPATH 或 cwd 包含 skills/trtc/）
#   2. python flow.py ...                 （直接运行脚本）
#   3. from tools.flow import Flow        （Python API import）

def _load_canonical_session_module():
    """Load the sibling session.py, never a cwd-shadowing tools.session shim.

    Domain Skills expose ``tools/flow.py`` shims for compatibility.  When the
    canonical flow is loaded through one of those shims, ``from tools.session``
    can resolve to the domain package instead of ``skills/trtc/tools``.  That
    package intentionally exports only a CLI delegate, so importing Flow then
    fails with a missing ConflictError.  Resolve the canonical sibling by file
    path after validating any ambient tools.session import.
    """
    required = (
        "ConflictError", "MissingError", "SchemaError", "Session",
        "SessionError", "emit_trace",
    )
    try:
        module = importlib.import_module("tools.session")
        if all(hasattr(module, name) for name in required):
            return module
    except Exception:
        pass

    session_path = Path(__file__).resolve().with_name("session.py")
    module_name = "_trtc_canonical_tools_session"
    module = sys.modules.get(module_name)
    if module is None:
        spec = importlib.util.spec_from_file_location(module_name, session_path)
        if spec is None or spec.loader is None:
            raise ImportError(f"Cannot load canonical session module: {session_path}")
        module = importlib.util.module_from_spec(spec)
        sys.modules[module_name] = module
        spec.loader.exec_module(module)
    if not all(hasattr(module, name) for name in required):
        raise ImportError(f"Canonical session module is incomplete: {session_path}")
    return module


_session_module = _load_canonical_session_module()
SessionConflictError = _session_module.ConflictError
SessionMissingError = _session_module.MissingError
SessionSchemaError = _session_module.SchemaError
Session = _session_module.Session
SessionError = _session_module.SessionError
_emit_trace = _session_module.emit_trace


# ============================================================
# Constants
# ============================================================

# 已知 phase 名（约定：小写单词）
VALID_PHASES = {"onboarding", "topic"}

# 路径解析
THIS_FILE = Path(__file__).resolve()
# skills/trtc/tools/flow.py → repo_root
DEFAULT_REPO_ROOT = THIS_FILE.parent.parent.parent.parent

# 环境变量覆盖（开发 / 测试用）
ENV_REPO_ROOT = "TRTC_REPO_ROOT"

# 已知产品 fallback（生产应从 products.yaml 读取，详见 §Open work F）
KNOWN_PRODUCTS = {"conference", "chat", "call", "live", "rtc-engine"}


# ============================================================
# Errors
# ============================================================

class FlowError(Exception):
    """flow.py 异常基类。"""


class InvalidIntentError(FlowError):
    """intent 为空或无法解析。"""


class InvalidInputError(FlowError):
    """输入参数非法（product / platform / phase 等不在已知集合内）。"""


class ScenarioNotFoundError(FlowError):
    """指定的 scenario id 不存在。"""


class PhaseNotFoundError(FlowError):
    """指定的 phase 文件不存在（如 flows/onboarding.md 缺失）。"""


class PlaybookNotFoundError(FlowError):
    """指定的 playbook 文件不存在。"""


class FlowSessionError(FlowError):
    """session 相关错误（未创建、损坏、字段非法等）。"""


# ============================================================
# Path resolution
# ============================================================

def _repo_root() -> Path:
    """定位 repo root。

    优先级：
      1. TRTC_REPO_ROOT 环境变量
      2. 相对于本文件的位置（skills/trtc/tools/flow.py 上溯 4 级）
    """
    env = os.environ.get(ENV_REPO_ROOT)
    if env:
        return Path(env).resolve()
    return DEFAULT_REPO_ROOT


def _kb_dir() -> Path:
    return _repo_root() / "knowledge-base"


def _skill_dir(product: str) -> Path:
    return _repo_root() / "skills" / f"trtc-{product}"


def _phase_file(product: str, phase: str) -> Path:
    return _skill_dir(product) / "flows" / f"{phase}.md"


def _playbook_file(product: str, playbook: str) -> Path:
    return _skill_dir(product) / "playbooks" / f"{playbook}.md"


def _scenarios_dir(product: str, platform: str) -> Path:
    return _kb_dir() / product / platform / "scenarios"


# ============================================================
# Frontmatter parser
# ============================================================

# 支持 \n 和 \r\n 两种换行
_FRONTMATTER_RE = re.compile(r"^---\s*\r?\n(.*?)\r?\n---\s*(\r?\n|$)", re.DOTALL)


def _parse_frontmatter(md_path: Path) -> tuple[dict, str]:
    """解析 markdown 文件的 yaml frontmatter。

    返回 (frontmatter_dict, body_str)。
    无 frontmatter 返回 ({}, full_text)。

    Raises:
      FlowError: 文件读不了 / frontmatter 不是合法 yaml mapping
    """
    try:
        text = md_path.read_text(encoding="utf-8")
    except OSError as e:
        raise FlowError(f"无法读取 markdown 文件：{md_path}（{e}）")

    m = _FRONTMATTER_RE.match(text)
    if not m:
        return {}, text

    fm_text = m.group(1)
    body = text[m.end():]
    try:
        fm = yaml.safe_load(fm_text) or {}
    except yaml.YAMLError as e:
        raise FlowError(f"frontmatter 解析失败：{md_path}（{e}）")
    if not isinstance(fm, dict):
        raise FlowError(f"frontmatter 不是 mapping：{md_path}")
    return fm, body


# ============================================================
# Result data classes
# ============================================================

@dataclass
class RouteResult:
    """route 的结果。"""
    product: Optional[str]
    platform: Optional[str]
    confidence: str   # 'high' | 'low' | 'unknown'
    ask_user: Optional[str]   # 不确定时给 caller AskUserQuestion 的 prompt

    def to_json(self) -> str:
        return json.dumps(asdict(self), ensure_ascii=False, indent=2)


@dataclass
class ScenarioCandidate:
    """单个 scenario 的匹配命中信息。"""
    scenario_id: str
    name: str
    score: int
    matched_keywords: list[str]
    has_template: bool
    has_alternatives: bool


@dataclass
class ForkOption:
    """fork 决策时给用户看的选项。

    flow.py 不直接调 AskUserQuestion——它输出选项菜单，caller（SKILL.md prose）
    读到后自行渲染 AskUserQuestion。
    """
    label: str          # AskUserQuestion 显示的标签
    value: str          # 选中后传给后续步骤的值（如 "use-template"）
    description: str    # 给用户的简介
    next_action: dict   # 选中后该做什么（caller 据此决定下一步 enter）


@dataclass
class MatchResult:
    """match-scenario 的结果。"""
    scenario_id: Optional[str]           # None = no_match
    candidates: list[ScenarioCandidate] = field(default_factory=list)
    fork_options: list[ForkOption] = field(default_factory=list)

    @property
    def matched(self) -> bool:
        return self.scenario_id is not None

    def to_json(self) -> str:
        return json.dumps({
            "scenario_id": self.scenario_id,
            "candidates": [asdict(c) for c in self.candidates],
            "fork_options": [asdict(f) for f in self.fork_options],
        }, ensure_ascii=False, indent=2)


# ============================================================
# Flow class
# ============================================================

class Flow:
    """flow 路由 + scenario 匹配 + phase 进入。

    无状态：所有方法都是 classmethod，状态在 session.yaml。
    """

    # ---- ROUTE ----

    @classmethod
    def route(cls, intent: str) -> RouteResult:
        """从 intent 推断 product + platform。

        简单关键词匹配（详见 §Open work F：未来从 products.yaml 读）。

        识别不出 → confidence='unknown'，ask_user 给 caller 让它 AskUserQuestion。
        识别出一个 → confidence='low'，ask_user 提示问另一个。
        都识别出 → confidence='high'。

        ROUTE 是 read-only，不写 session。
        """
        if not intent or not intent.strip():
            raise InvalidIntentError("intent 不能为空")

        # 简化版关键词字典（最终从 products.yaml 读）
        product_kw = {
            "conference": ["会议", "meeting", "conference", "视频会议", "会议室", "video conference"],
            "chat":       ["聊天", "chat", "im", "消息", "message", "instant message"],
            "call":       ["通话", "call", "1v1", "音视频通话", "视频通话"],
            "live":       ["直播", "live", "推流", "live streaming"],
            "rtc-engine": ["rtc", "engine", "底层", "raw sdk", "trtc engine"],
        }
        platform_kw = {
            "web":      ["web", "浏览器", "vue", "react", "angular", "h5"],
            "android":  ["android", "安卓"],
            "ios":      ["ios", "iphone", "swift", "objective-c"],
            "flutter":  ["flutter", "dart"],
            "electron": ["electron", "桌面客户端"],
            "unity":    ["unity", "游戏"],
        }

        intent_lower = intent.lower()

        product = None
        product_score = 0
        for p, kws in product_kw.items():
            for kw in kws:
                if kw.lower() in intent_lower and len(kw) > product_score:
                    # 只保留最长命中的关键词，避免 conference/chat 等短词互相抢占。
                    product = p
                    product_score = len(kw)

        platform = None
        platform_score = 0
        for plat, kws in platform_kw.items():
            for kw in kws:
                if kw.lower() in intent_lower and len(kw) > platform_score:
                    # 平台同样按最长关键词优先，保证 react native 等后续扩展可兼容。
                    platform = plat
                    platform_score = len(kw)

        if product and platform:
            confidence = "high"
            ask_user = None
        elif product or platform:
            confidence = "low"
            if not product:
                ask_user = "你想做哪个产品？会议（conference）/ 聊天（chat）/ 通话（call）/ 直播（live）/ 底层 RTC（rtc-engine）"
            else:
                ask_user = "你的目标平台是？web / android / ios / flutter / electron / unity"
        else:
            confidence = "unknown"
            ask_user = "你想做哪个产品 + 哪个平台？例如：会议 + web，或 聊天 + android"

        return RouteResult(
            product=product,
            platform=platform,
            confidence=confidence,
            ask_user=ask_user,
        )

    # ---- MATCH-SCENARIO ----

    @classmethod
    def match_scenario(
        cls,
        intent: str,
        product: str,
        platform: str,
    ) -> MatchResult:
        """根据 intent 匹配 product/platform 下的具体 scenario。

        策略：
          1. 扫 knowledge-base/{product}/{platform}/scenarios/*.md frontmatter
          2. 对每个 scenario：扫 trigger.intent_keywords，substring 匹配，
             长关键词加权
          3. 排序后取最高分；按 scenario.id 是否含 general/standard/default
             标记 kind='vague' 或 'specific'
          4. 根据 has_template / has_alternatives 生成 fork_options

        如 scenarios 目录不存在（KB 还没拆分到新结构）→ 返回 no_match，
        caller 应 fallback 到标准 onboarding。

        MATCH-SCENARIO 是 read-only，不写 session。
        """
        if not intent or not intent.strip():
            raise InvalidIntentError("intent 不能为空")
        if product not in KNOWN_PRODUCTS:
            raise InvalidInputError(
                f"未知 product：{product}（已知：{sorted(KNOWN_PRODUCTS)}）"
            )

        scenarios_dir = _scenarios_dir(product, platform)
        if not scenarios_dir.exists():
            # KB 未拆分 / 该平台没准备 scenario → no_match，caller 走标准 onboarding
            return MatchResult(scenario_id=None)

        intent_lower = intent.lower()
        candidates: list[ScenarioCandidate] = []

        for md_path in sorted(scenarios_dir.glob("*.md")):
            try:
                fm, _body = _parse_frontmatter(md_path)
            except FlowError:
                # 单个文件解析失败不影响整体匹配——记 trace 后跳过
                _emit_trace({
                    "event": "flow.match_scenario.bad_frontmatter",
                    "file": str(md_path),
                })
                continue

            if not fm:
                continue

            sid = fm.get("id") or md_path.stem
            name = fm.get("name") or sid
            keywords = (fm.get("trigger") or {}).get("intent_keywords") or []
            if not isinstance(keywords, list):
                keywords = []

            score = 0
            matched: list[str] = []
            for kw in keywords:
                if not isinstance(kw, str):
                    continue
                if kw.lower() in intent_lower:
                    # 先用 deterministic substring + 长词加权；宁可漏召回，也不引入不可控语义判断。
                    score += len(kw)
                    matched.append(kw)

            if score > 0:
                candidates.append(ScenarioCandidate(
                    scenario_id=sid,
                    name=name,
                    score=score,
                    matched_keywords=matched,
                    has_template=bool(fm.get("template")),
                    has_alternatives=bool(fm.get("alternative_integrations")),
                ))

        candidates.sort(key=lambda c: c.score, reverse=True)

        if not candidates:
            return MatchResult(scenario_id=None)

        top = candidates[0]
        fork_options: list[ForkOption] = []

        if top.has_template:
            # 4-A：scenario 有完整模板 → 出 fork（用模板 vs 自选）
            fork_options = [
                ForkOption(
                    label=f"用「{top.name}」完整模板",
                    value="use-template",
                    description="复制完整项目模板（含 UI），适合从零搭一个新项目",
                    next_action={"action": "enter-playbook", "scenario": top.scenario_id},
                ),
                ForkOption(
                    label="自己挑功能模块加到现有项目",
                    value="self-pick",
                    description="不复制整个项目，按勾选的能力逐个集成",
                    next_action={"action": "enter-onboarding", "scenario": top.scenario_id},
                ),
            ]
        elif top.has_alternatives:
            # 4-B：scenario 有替代集成方式 → 出 fork（套件 vs 自选）
            fork_options = [
                ForkOption(
                    label="用官方套件（含 UI）",
                    value="use-alternative",
                    description="装官方套件包，引入官方组件，主流程 API 已配好",
                    next_action={"action": "enter-playbook", "scenario": top.scenario_id},
                ),
                ForkOption(
                    label="自己挑功能模块",
                    value="self-pick",
                    description="不装套件，从底层 SDK 按需取用，UI 自己写",
                    next_action={"action": "enter-onboarding", "scenario": top.scenario_id},
                ),
            ]
        # else：无 fork，caller 直接 enter-onboarding，把 scenario 带过去用于能力单元过滤

        return MatchResult(
            scenario_id=top.scenario_id,
            candidates=candidates,
            fork_options=fork_options,
        )

    # ---- ENTER ----

    @classmethod
    def enter(
        cls,
        product: str,
        platform: str = "",
        phase: Optional[str] = None,
        playbook: Optional[str] = None,
        scenario: Optional[str] = None,
    ) -> str:
        """进入 phase 或 playbook，返回该 flow 的 markdown 内容。

        副作用：通过 session.py 写：
          - active_flow = phase 名或 playbook id
          - flow_entered = True
          - active_scenario = scenario（如有传入）
          - active_domain_skill = "trtc-{product}"
          - flow_state = {}（新 flow 独立命名空间）

        Args:
          product   : 产品（必传，已知 product 集内）
          platform  : 平台（可选，仅写 trace 用，不写 session.platform —— platform
                      是 dispatcher 阶段写的，flow.py 不应改）
          phase     : phase 名（onboarding / topic）
          playbook  : playbook id
          scenario  : 当前激活的 scenario id（可选）

          phase 与 playbook 二选一互斥。

        Raises:
          FlowError                : 输入不合法
          PhaseNotFoundError       : phase 文件不存在
          PlaybookNotFoundError    : playbook 文件不存在
          FlowSessionError         : session 不存在 / 损坏 / 字段非法
          SessionConflictError     : CAS 冲突（caller 重读重试）

        Returns:
          flow markdown 内容（带或不带 frontmatter，视 flow 文件本身格式）
        """
        if (phase is None) == (playbook is None):
            raise FlowError("phase 和 playbook 必须二选一")
        if product not in KNOWN_PRODUCTS:
            raise InvalidInputError(f"未知 product：{product}")

        if phase:
            if phase not in VALID_PHASES:
                raise InvalidInputError(
                    f"未知 phase：{phase}（已知：{sorted(VALID_PHASES)}）"
                )
            md_path = _phase_file(product, phase)
            flow_value = phase
            err_class: type[FlowError] = PhaseNotFoundError
        else:
            md_path = _playbook_file(product, playbook)  # type: ignore[arg-type]
            flow_value = playbook  # type: ignore[assignment]
            err_class = PlaybookNotFoundError

        if not md_path.exists():
            raise err_class(f"flow 文件不存在：{md_path}")

        try:
            content = md_path.read_text(encoding="utf-8")
        except OSError as e:
            raise FlowError(f"读取 flow 文件失败：{md_path}（{e}）")

        # 写 session 副作用
        try:
            sess = Session.load()
        except SessionMissingError:
            raise FlowSessionError(
                "session 不存在。dispatcher 应先 Session.create() 再 Flow.enter()"
            )
        except SessionError as e:
            raise FlowSessionError(f"session 加载失败：{e}")

        # idempotent：已经进入相同 flow 且 product 一致时不重复写 session
        already = (
            sess.active_flow == flow_value
            and bool(sess.flow_entered)
            and sess.active_domain_skill == f"trtc-{product}"
        )
        if already:
            # idempotent enter 不递增 session 版本，避免 caller 重复 enter 产生伪状态变化。
            _emit_trace({
                "session_id": sess.session_id,
                "event": "flow.enter.idempotent",
                "active_flow": flow_value,
                "product": product,
            })
            return content

        # playbook 的 ui_mode 由 playbook frontmatter 声明
        playbook_ui_mode: Optional[str] = None
        if playbook:
            try:
                fm, _ = _parse_frontmatter(md_path)
                playbook_ui_mode = fm.get("ui_mode") or None
            except FlowError as e:
                _emit_trace({
                    "event": "flow.enter.frontmatter_parse_failed",
                    "playbook": playbook,
                    "product": product,
                    "error": str(e),
                })
                # 解析失败不阻断 enter，ui_mode 留 null

        try:
            with sess.transaction() as upd:
                upd.active_flow = flow_value
                upd.flow_entered = True
                upd.active_domain_skill = f"trtc-{product}"
                upd.integration_path = "topic" if phase else flow_value
                # 新 flow 独立 flow_state 命名空间
                upd.flow_state = {}
                if scenario:
                    # 互斥字段：清掉跨产品 scenario，避免 schema 冲突
                    upd.active_scenario = scenario
                    upd.active_cross_scenario = None
                if playbook_ui_mode is not None:
                    # 只有 playbook 静态声明了 ui_mode 才在 enter 时写入；phase 路径留给后续流程决策。
                    upd.ui_mode = playbook_ui_mode
        except SessionSchemaError as e:
            raise FlowSessionError(f"session schema 校验失败：{e}")

        _emit_trace({
            "session_id": sess.session_id,
            "event": "flow.enter",
            "active_flow": flow_value,
            "kind": "phase" if phase else "playbook",
            "product": product,
            "platform": platform or None,
            "scenario": scenario,
        })

        return content

    # ---- EXIT ----

    @classmethod
    def exit(cls) -> None:
        """退出当前 flow。

        副作用：active_flow=null / flow_entered=false。
        flow_state 不删除（保留供 trace），但 caller 不应该再依赖它。

        Raises:
          FlowSessionError       : session 不存在
          SessionConflictError   : CAS 冲突
        """
        try:
            sess = Session.load()
        except SessionMissingError:
            raise FlowSessionError("session 不存在")
        except SessionError as e:
            raise FlowSessionError(f"session 加载失败：{e}")

        prev_flow = sess.active_flow
        if not prev_flow and not sess.flow_entered:
            return  # 已经在 idle 状态

        try:
            with sess.transaction() as upd:
                upd.active_flow = None
                upd.flow_entered = False
        except SessionSchemaError as e:
            raise FlowSessionError(f"session schema 校验失败：{e}")

        _emit_trace({
            "session_id": sess.session_id,
            "event": "flow.exit",
            "exited_flow": prev_flow,
        })

    # ---- CURRENT ----

    @classmethod
    def current(cls) -> dict:
        """返回当前 flow 状态摘要（调试 / status 用）。"""
        try:
            sess = Session.load()
        except SessionMissingError:
            return {"session": "missing"}
        except SessionError as e:
            return {"session": "error", "error": str(e)}

        return {
            "session": "ok",
            "session_id": sess.session_id,
            "active_flow": sess.active_flow,
            "active_scenario": sess.active_scenario,
            "active_cross_scenario": sess.active_cross_scenario,
            "flow_entered": bool(sess.flow_entered),
            "active_domain_skill": sess.active_domain_skill,
            "product": sess.product,
            "products": sess.products,
            "platform": sess.platform,
            "status": sess.status,
        }


# ============================================================
# CLI
# ============================================================

def _parse_kv_args(argv: list[str]) -> dict:
    """简单 --key value parser（支持 --flag 当 bool 用）。"""
    out: dict = {}
    i = 0
    while i < len(argv):
        a = argv[i]
        if a.startswith("--"):
            key = a[2:]
            if i + 1 < len(argv) and not argv[i + 1].startswith("--"):
                out[key] = argv[i + 1]
                i += 2
            else:
                out[key] = True
                i += 1
        else:
            i += 1
    return out


def _arg_str(kv: dict, key: str) -> Optional[str]:
    """从 kv 里取 string 值，--flag 形式（True）或缺失返回 None。"""
    v = kv.get(key)
    if isinstance(v, str) and v:
        return v
    return None


def _cli_route(args: list[str]) -> int:
    kv = _parse_kv_args(args)
    intent = _arg_str(kv, "intent")
    if not intent:
        print("ERROR: --intent 必须提供", file=sys.stderr)
        return 1
    try:
        result = Flow.route(intent=intent)
    except InvalidIntentError as e:
        print(f"ERROR: {e}", file=sys.stderr)
        return 1
    except FlowError as e:
        print(f"ERROR: {e}", file=sys.stderr)
        return 1
    print(result.to_json())
    return 0


def _cli_match_scenario(args: list[str]) -> int:
    kv = _parse_kv_args(args)
    intent = _arg_str(kv, "intent")
    product = _arg_str(kv, "product")
    platform = _arg_str(kv, "platform")
    if not intent:
        print("ERROR: --intent 必须提供", file=sys.stderr)
        return 1
    if not product:
        print("ERROR: --product 必须提供", file=sys.stderr)
        return 1
    if not platform:
        print("ERROR: --platform 必须提供", file=sys.stderr)
        return 1
    try:
        result = Flow.match_scenario(
            intent=intent, product=product, platform=platform,
        )
    except (InvalidIntentError, InvalidInputError) as e:
        print(f"ERROR: {e}", file=sys.stderr)
        return 1
    except FlowError as e:
        print(f"ERROR: {e}", file=sys.stderr)
        return 2
    print(result.to_json())
    return 0


def _cli_enter(args: list[str]) -> int:
    kv = _parse_kv_args(args)
    product = _arg_str(kv, "product")
    platform = _arg_str(kv, "platform") or ""
    phase = _arg_str(kv, "phase")
    playbook = _arg_str(kv, "playbook")
    scenario = _arg_str(kv, "scenario")

    if not product:
        print("ERROR: --product 必须提供", file=sys.stderr)
        return 1
    if (phase is None) == (playbook is None):
        print("ERROR: --phase 和 --playbook 必须二选一", file=sys.stderr)
        return 1

    try:
        content = Flow.enter(
            product=product,
            platform=platform,
            phase=phase,
            playbook=playbook,
            scenario=scenario,
        )
    except (PhaseNotFoundError, PlaybookNotFoundError) as e:
        # 资源不存在单独映射到 exit code 2，供 caller / hook 明确分支处理。
        print(f"ERROR: {e}", file=sys.stderr)
        return 2
    except FlowSessionError as e:
        # session 缺失 / 损坏必须保留独立退出码；上层依赖它判断是否先 create session。
        print(f"ERROR: {e}", file=sys.stderr)
        return 3
    except SessionConflictError as e:
        # CAS 冲突是可重试错误，不能和一般输入错误混在一起。
        print(f"ERROR (CAS): {e}", file=sys.stderr)
        return 4
    except (InvalidInputError, FlowError) as e:
        print(f"ERROR: {e}", file=sys.stderr)
        return 1

    sys.stdout.write(content)
    if not content.endswith("\n"):
        sys.stdout.write("\n")
    return 0


def _cli_exit(_args: list[str]) -> int:
    try:
        Flow.exit()
    except FlowSessionError as e:
        print(f"ERROR: {e}", file=sys.stderr)
        return 3
    except SessionConflictError as e:
        print(f"ERROR (CAS): {e}", file=sys.stderr)
        return 4
    return 0


def _cli_current(_args: list[str]) -> int:
    info = Flow.current()
    print(json.dumps(info, ensure_ascii=False, indent=2))
    return 0


def main() -> int:
    argv = sys.argv[1:]
    # Keep Flow commands on the same project session as tools.session when a
    # domain shim is invoked from an installed Skill directory.
    if "--project-root" in argv:
        idx = argv.index("--project-root")
        if idx + 1 >= len(argv) or argv[idx + 1].startswith("--"):
            print("ERROR: --project-root 需要目录", file=sys.stderr)
            return 2
        project_root = os.path.abspath(argv[idx + 1])
        if not os.path.isdir(project_root):
            print(f"ERROR: project root 不存在：{project_root}", file=sys.stderr)
            return 2
        os.environ["TRTC_PROJECT_ROOT"] = project_root
        argv = argv[:idx] + argv[idx + 2:]
    if not argv:
        print(__doc__)
        return 0
    cmd, rest = argv[0], argv[1:]
    handlers = {
        "route": _cli_route,
        "match-scenario": _cli_match_scenario,
        "enter": _cli_enter,
        "exit": _cli_exit,
        "current": _cli_current,
    }
    handler = handlers.get(cmd)
    if not handler:
        print(f"未知子命令：{cmd}", file=sys.stderr)
        print(f"可用：{', '.join(handlers)}", file=sys.stderr)
        return 1
    return handler(rest)


if __name__ == "__main__":
    raise SystemExit(main())
