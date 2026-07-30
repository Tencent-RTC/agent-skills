"""
tools/session.py
================

TRTC AI Integration —— session 状态总线（state bus）。

本文件是 .trtc-session.yaml 读写的 SINGLE ENTRY POINT。
所有 hook / domain skill / flow.py / search.py 等组件想读写 session，
**必须**经过本模块（或 CLI），不允许直接 Read/Write yaml 文件。
PreToolUse hook 在外层拦截直接 Edit/Write `.trtc-session.yaml` 的尝试。


============================================================
设计讨论备忘（2026-06-08）
============================================================

# 为什么需要这个工具

session.yaml 是项目的"系统总线"——dispatcher / domain skill / flow.py /
hook / verify 都在读它的字段、写它的状态。如果让大家直接 Read/Write yaml：

  1. 没有 schema 校验：错字段 / 错值类型可以静默写入
  2. 没有并发保护：两个 hook subprocess 同时写会 silent overwrite
  3. 没有迁移路径：schema 升级时旧 hook 先碎
  4. 敏感信息可能进 git：缺少 .gitignore 守护
  5. 没有可观测性：不知道谁改了什么

session.py 是一层薄包装，把这些 concern 收口到一处。


# Schema v2 字段（最终定稿，2026-06-08）

  Meta:
    schema_version: 2          结构版本，迁移用，release 才变
    state_version: int         内容版本，每次写 +1，CAS 用
    session_id: str            ULID/UUID，session 创建时定，用于 trace 关联
    created_at / updated_at    时间戳（ISO 8601 UTC）

  Routing：
    product: str               单产品（与 products 互斥）
    products: list[str]        跨产品（与 product 互斥）
    platform: str              web / android / ios / flutter / electron / unity
    intent: str                integrate-scenario / troubleshoot / lookup / ...
    agent: str                 claude / cursor / codebuddy / codex

  Flow 执行：
    active_domain_skill: str
    active_flow: str           开放枚举（topic / onboarding / medical-quickstart / ...）
    active_scenario: str       单产品 scenario id（与 active_cross_scenario 互斥）
    active_cross_scenario: str 跨产品 scenario id
    flow_entered: bool         hook 拦截依据
    flow_owner_version: int    optional
    ui_mode: str | null        集成方式（headless / official-roomkit / medical-template 等）
                               conference 写入；其他产品 null
    integration_path: str | null  标准 topic 管线 / bypass 路径的显式收口
                               可选值：topic / medical-quickstart / official-roomkit

  会话状态：
    status: str                active / paused / completed

  状态机执行（state_machine.py / flow.py 写）：
    confirmed_plan: list[str]          onboarding 输出的 slice id 列表
    coverage_decided: bool | null      coverage ownership 显式标记
                                       true  = confirmed_plan 已定，不再问 coverage
                                       false = topic Step 1.5 必须先做 coverage 决策
                                       null  = legacy / 非法中间态，topic fail-closed
    execution_queue: list[dict]        topic 物化的执行步骤队列
                                       每步 {id, type: slice|unit, title, status, slices[]}
    current_execution_index: int       当前步骤游标
    current_execution_state: str       not_started / slice_read / code_written /
                                       apply_passed / apply_failed / user_confirmed / all_done
    auto_advance_policy: str | null    pause_each / pause_on_failure / pause_at_end
                                       unset = fail closed = pause_each

  业务决策（onboarding flow 写）：
    session_context:
      business_decisions:
        <slice-id>:
          <key>: <value>        单选 → string；多选 → list[string]

  自由结构：
    flow_state: dict           当前 active_flow 的进度数据，结构由 flow 自治
                               conference 专有字段放此处：
                                 execution_granularity: slice | unit
                                 delivery_units: list | null（session 级覆盖）


# 为什么砍掉 current_step（v1 → v2 迁移要点）

current_step 在 v1 schema 里被滥用，单字段塞了三种语义：
  - 子步骤标识（A2.3 / A2.4）—— 应该归 flow_state
  - 阶段终态（template-copied / official-roomkit-done）—— 应该归 flow_state.result
  - 会话状态（completed / paused）—— 应该是顶层 status 字段

是 leaky abstraction 的典型表现。新设计把它拆到三个不同的字段，避免：
  - 不同 flow 对 step 含义不一致（A2.3 跟 G3 都叫 step 但不是一回事）
  - flow 切换时 step 数字带过来含义错乱
  - "session 完了没" 跟 "step 走到哪了" 共用一个字段，互相干扰

现 codebase 有 30+ 处引用 current_step，迁移影响：
  - product-owned flows and shared tools（conference 已迁到 trtc-conference/flows/*）
  - skills/trtc-conference/flows/topic.md (~3 处)
  - skills/trtc/tools/finalize_session.py (1 处)
  - skills/trtc/SKILL.md (1 处 dispatcher 判断)
  - CODEBUDDY.md (1 处 dispatcher prose)

兼容窗口：本模块在读 v1 时自动 in-memory 升级到 v2，写永远写 v2 schema。
具体迁移规则见 _migrate_v1_to_v2()。


# 为什么必须经过 tool 层（不是观测，是可靠性）

模型有"问题看似简单就不读资料"的内在倾向。如果让模型直接 Read .yaml：
  - 跳过没有副作用，外界感知不到
  - 自主决定要不要读，不可靠
  - 没法基于"读没读"做后续决策（如 hook 拦截）

工具调用相比 Read：
  - first-class event（trace 可见）
  - 有副作用（state_version+1）
  - 可叠加 hook 校验（"flow_entered=true 之前不能 Edit/Write"）

observability 是 tool 化的副产品，不是动机。详见
internal-docs/target-architecture.md §10.1。


# 关键不变量

  1. 写入并发安全：fcntl.flock + state_version CAS 双层
  2. 原子写：临时文件 + os.replace（POSIX 原子 rename）
  3. Schema 校验：每次写都检查字段范围 + 互斥字段
  4. .gitignore 守护：Session.create 时 idempotent 添加
  5. v1 → v2 lazy migrate：读时升级 in-memory，写时持久化


# 文件路径

  .trtc-session.yaml 必须放在用户**项目根**，不在 skill 路径。
  原因：
    - session 是用户某个项目的整合状态，不是 skill 自身状态
    - 多项目并行 = 多份 session.yaml 自然分离
    - 跨工具一致（Claude / Cursor 同一个项目共享 session）

  项目根定位算法见 find_project_root()。


# Trace 事件

  每次写都生成 JSONL trace event，落盘到本地缓存目录。
  目的：runtime-F-observability 的 dev 层日志输入源。
  开销：磁盘 ~150 字节 / event，运行时 <1ms，**0 token**（不进模型 context）。


============================================================
公开接口
============================================================

# Python API（推荐方式，flow.py / search.py 等直接 import）

  from tools.session import Session, ConflictError

  s = Session.load()                    # 读，没有则 raise MissingError
  s.product                             # 'conference'
  s.flow_entered                        # True

  with s.transaction() as upd:          # CAS-protected 写
      upd.product = 'conference'
      upd.flow_entered = True
  # context exit → atomic write，state_version +1

  s = Session.create(                   # 首次创建
      product='conference', platform='web',
  )

# CLI（hook 用 subprocess，调试用）

  python3 -m tools.session read [--field X]
  python3 -m tools.session write --field X=Y --expected-version N
  python3 -m tools.session write-batch --updates '{...}' --expected-version N
  python3 -m tools.session reset
  python3 -m tools.session migrate
  python3 -m tools.session validate
  python3 -m tools.session status


============================================================
Open work / 待做（TODO，截至 2026-06-08）
============================================================

# C. 把现有 hook 改成调 session.py 而不是直接读 yaml
#
#    现状（refactor 分支 hooks/hooks.json 引用的脚本，共 399 行）：
#      - skills/trtc/hooks/gate_slice_read.py        (133 行)
#      - skills/trtc/hooks/gate_slice_write.py       (169 行)
#      - skills/trtc/hooks/stop_require_apply_evidence.py  (97 行)
#
#    这三个 hook 现在直接 yaml.load(open('.trtc-session.yaml'))，绕过本模块——
#    缺乏 schema 校验、不识别 v1/v2、不参与 trace。
#
#    迁移要点：
#      - 改成 from tools.session import Session
#      - hook 是 subprocess，每次冷启动 → Session.load() 一次做决策即可
#      - 不在 hook 内开 transaction——hook 的语义是"基于当前状态做决策"
#        不是"修改状态"。修改 session 状态归 flow.py 这种工具，不归 hook。
#        （唯一例外可能是 stop_require_apply_evidence 要标 status='completed'，
#         那也应该是调用 finalize 工具而不是直接写。）
#      - 注意 hook subprocess 的 PYTHONPATH 要能 import tools.session：
#          option 1: 用 sys.path.insert 把 skills/trtc/tools/ 加进去
#          option 2: 把 tools/ 安装为 pip-installable package
#          option 3: hook 改成走 CLI（subprocess.run [python, -m, tools.session, ...]）
#         倾向 option 3——hook 已经是 subprocess，多一次 subprocess 开销可接受，
#         好处是 PYTHONPATH 不依赖、跟 hook 当前形态一致（都走 CLI）。

============================================================
"""

from __future__ import annotations

import json
import os
import sys
import tempfile
import time
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator, Optional

import yaml

# 在 macOS / Linux 用 fcntl；Windows 没有 fcntl，本项目暂不支持 Windows native。
try:
    import fcntl
except ImportError:
    fcntl = None  # 之后用 lock helper 时统一兜底


# ============================================================
# Constants
# ============================================================

SCHEMA_VERSION = 2
SESSION_FILENAME = ".trtc-session.yaml"
LOCK_SUFFIX = ".lock"

# 项目根定位用的 marker 文件——按优先级。.git 最权威。
PROJECT_MARKERS = (
    ".git",                # git repo
    "package.json",        # JS / Node
    "pyproject.toml",      # Python (PEP 518)
    "Cargo.toml",          # Rust
    "pubspec.yaml",        # Flutter / Dart
    "build.gradle",        # Android (Gradle)
    "build.gradle.kts",    # Android (Kotlin DSL)
    "Podfile",             # iOS (CocoaPods)
)

# 字段约束
VALID_PRODUCTS = {"conference", "chat", "call", "live", "rtc-engine", None}
VALID_INTENTS = {
    "integrate-scenario",
    "integrate-feature",
    "expand",
    "explore",
    "troubleshoot",
    "lookup",
    "demo",
    None,
}
VALID_STATUSES = {"active", "paused", "completed"}
VALID_AGENTS = {"claude", "cursor", "codebuddy", "codex", None}
VALID_PLATFORMS = {"web", "android", "ios", "flutter", "electron", "unity", None}

VALID_AUTO_ADVANCE = {"pause_each", "pause_on_failure", "pause_at_end", None}
VALID_INTEGRATION_PATHS = {"topic", "medical-quickstart", "official-roomkit", None}

PROTECTED_PATCH_FIELDS = {
    "schema_version",
    "state_version",
    "session_id",
    "created_at",
    "updated_at",
}
MUTEX_PAIRS = [
    ("product", "products"),
    ("active_scenario", "active_cross_scenario"),
]


# ============================================================
# Errors
# ============================================================

class SessionError(Exception):
    """所有 session 异常的基类。"""


class MissingError(SessionError):
    """session.yaml 文件不存在。"""


class CorruptError(SessionError):
    """session.yaml 存在但解析失败（YAML 错误等）。"""


class ConflictError(SessionError):
    """CAS 失败：另一个写入者在 expected_version 之后已经修改。

    调用方应重读最新状态后重试。
    """


class SchemaError(SessionError):
    """字段不符合 v2 schema（值非法、互斥字段同时设置等）。"""


class UnknownVersionError(SessionError):
    """schema_version 高于本工具支持的最高版本。

    意味着 session 由更新版本的 session.py 创建——升级工具或换分支。
    """


# ============================================================
# Helpers
# ============================================================

def _iso_now() -> str:
    """返回当前 UTC 时间的 ISO 8601 字符串。"""
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _new_session_id() -> str:
    """生成 session id。

    用 UUID4 而不是 ULID——避免引入第三方依赖。trace 关联只需唯一性，
    不需要 ULID 的时间排序属性（trace event 自身有时间戳）。
    """
    return str(uuid.uuid4())


def find_project_root(start: Optional[str] = None) -> str:
    """从 start（默认 CWD）往上找，遇到 PROJECT_MARKERS 任一就停。

    都找不到 → fallback 到 start（或 CWD）本身。

    边界情况：
      - 用户在 monorepo 子目录但 sub-repo 也有 .git：用 sub-repo（git submodule
        语义符合用户对"我的项目"的直觉）
      - 用户在 monorepo 子目录仅根有 .git：用根
      - 用户从未 init 过任何项目：fallback 到 CWD（demo / 测试场景）
    """
    cur = Path(os.path.abspath(start or os.getcwd()))
    while True:
        for marker in PROJECT_MARKERS:
            if (cur / marker).exists():
                return str(cur)
        parent = cur.parent
        if parent == cur:
            # 到文件系统根了还没找到
            return os.path.abspath(start or os.getcwd())
        cur = parent


def _session_path(project_root: Optional[str] = None) -> str:
    """拿到 session.yaml 的绝对路径。"""
    root = project_root or find_project_root()
    return os.path.join(root, SESSION_FILENAME)


# ============================================================
# Trace logging
# ============================================================

def _trace_dir() -> Path:
    """trace 日志目录。

    放在 ~/.cache/trtc-traces/ 而不是项目内：
      - 不污染用户项目目录
      - 不需要 .gitignore 守护
      - 多项目共享同一缓存目录，按 session_id 隔离
    """
    base = os.environ.get("XDG_CACHE_HOME") or os.path.expanduser("~/.cache")
    d = Path(base) / "trtc-traces"
    d.mkdir(parents=True, exist_ok=True)
    return d


def emit_trace(event: dict) -> None:
    """追加一条 JSONL event 到本会话的 trace 文件。

    永不抛错——trace 出问题不能阻断 session 操作（fail-open，per runtime-D
    分类：体验类失败用 fail-open）。
    """
    try:
        sid = event.get("session_id") or "unknown"
        path = _trace_dir() / f"{sid}.jsonl"
        event_with_ts = {"ts": _iso_now(), **event}
        with open(path, "a", encoding="utf-8") as f:
            f.write(json.dumps(event_with_ts, ensure_ascii=False) + "\n")
    except Exception:
        # 静默吞——trace 不该影响 session 主路径
        pass


# ============================================================
# Atomic write
# ============================================================

def _atomic_write(path: str, data: dict) -> None:
    """整文件原子写：临时文件 → fsync → rename。

    保证：进程崩溃 / OS 崩溃只会留下"旧文件不变" 或 "新文件就位"，
    永远不会出现半截损坏的文件。
    """
    dir_ = os.path.dirname(os.path.abspath(path)) or "."
    fd, tmp_path = tempfile.mkstemp(
        dir=dir_,
        prefix=".session.tmp-",
        suffix=".yaml",
    )
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            yaml.safe_dump(data, f, allow_unicode=True, sort_keys=False)
            f.flush()
            os.fsync(f.fileno())
        # POSIX 保证原子，Python 3.3+ 在 Windows 上也是原子（覆盖目标）
        os.replace(tmp_path, path)
    except Exception:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
        raise


def _ensure_gitignored(project_root: str) -> None:
    """idempotent 地把 .trtc-session.yaml 加进项目的 .gitignore。

    设计选择：
      - 项目已有 .gitignore → 检查并追加（如果还没列）
      - 项目没有 .gitignore → 不创建（尊重用户没用 git 的选择，不擅自加文件）
      - 已列在 .gitignore → 不动
    """
    gi = Path(project_root) / ".gitignore"
    if not gi.exists():
        return
    line = SESSION_FILENAME
    try:
        content = gi.read_text(encoding="utf-8")
    except Exception:
        return  # 读不了就别折腾
    lines = content.splitlines()
    if line in lines:
        return
    with open(gi, "a", encoding="utf-8") as f:
        if not content.endswith("\n"):
            f.write("\n")
        f.write("\n# Added by tools/session.py — internal session state\n")
        f.write(f"{line}\n")


# ============================================================
# File lock (cross-process)
# ============================================================

@contextmanager
def _flock(lock_path: str) -> Iterator[None]:
    """跨进程独占锁。

    Windows 没有 fcntl，本项目当前不支持 Windows native——降级为无锁
    （单进程开发环境下不会出问题；生产 / CI 在 Linux/macOS）。
    """
    if fcntl is None:
        yield
        return
    Path(os.path.dirname(lock_path) or ".").mkdir(parents=True, exist_ok=True)
    with open(lock_path, "w") as lock_file:
        fcntl.flock(lock_file.fileno(), fcntl.LOCK_EX)
        try:
            yield
        finally:
            fcntl.flock(lock_file.fileno(), fcntl.LOCK_UN)


# ============================================================
# Schema migration v1 → v2
# ============================================================

def _migrate_v1_to_v2(v1: dict) -> dict:
    """老 schema → 新 schema，best-effort 解释 current_step 的语义。

    不会丢字段——无法解释的内容塞到 flow_state.legacy 里，由后续作者
    审视。

    迁移规则：
      current_step == 'completed'             → status='completed'
      current_step == 'paused'                → status='paused'
      current_step in 'template-copied' /     → status='completed',
                     'official-roomkit-done'    flow_state.result=<value>
      current_step == 'topic-handoff'         → 仅 active_domain_skill 已隐含；
                                                flow_state.handoff_from=<old_skill>
      current_step matches 'A2.*' / 'G\\d+'   → flow_state.sub_step=<value>
      其他                                    → flow_state.legacy_current_step=<value>

      slice_state                             → flow_state.slices

      ui_mode                                 → 顶层保留（hook / playbook / topic codegen
                                                都要读，不同产品 null 即不适用）

      execution_granularity                   → flow_state.execution_granularity（conference 专有）
      delivery_units                          → flow_state.delivery_units（conference 专有）
    """
    v2 = dict(v1)  # shallow copy
    v2["schema_version"] = 2

    # Meta 字段补齐
    v2.setdefault("state_version", 0)   # v1 无此字段时与磁盘默认值对齐，首次 transaction 升到 1
    v2.setdefault("session_id", _new_session_id())
    v2.setdefault("created_at", _iso_now())
    v2["updated_at"] = _iso_now()

    flow_state = dict(v2.get("flow_state") or {})

    # current_step 拆解
    if "current_step" in v1:
        cs = v1["current_step"]
        if cs == "completed":
            v2["status"] = "completed"
        elif cs == "paused":
            v2["status"] = "paused"
        elif cs in ("template-copied", "official-roomkit-done"):
            v2["status"] = "completed"
            flow_state["result"] = cs
        elif cs == "topic-handoff":
            flow_state["handoff_from"] = v1.get("active_domain_skill", "trtc-onboarding")
        elif isinstance(cs, str) and (cs.startswith("A2") or cs.startswith("A1")
                                      or cs.startswith("B") or cs.startswith("C")
                                      or (cs.startswith("G") and len(cs) <= 3)):
            flow_state["sub_step"] = cs
        elif cs is not None:
            flow_state["legacy_current_step"] = cs
        # 删 v1 字段——v2 不再保留
        v2.pop("current_step", None)

    # slice_state → flow_state.slices
    if "slice_state" in v1:
        flow_state.setdefault("slices", {})
        if isinstance(v1["slice_state"], dict):
            flow_state["slices"].update(v1["slice_state"])
        v2.pop("slice_state", None)

    # ui_mode → 顶层保留，v1/v2 均不搬移（不同产品 null 即不适用）

    # execution_granularity / delivery_units → flow_state（conference 专有）
    for key in ("execution_granularity", "delivery_units"):
        if key in v2 and v2[key] is not None:
            flow_state[key] = v2.pop(key)

    if flow_state:
        v2["flow_state"] = flow_state

    # status 默认值
    v2.setdefault("status", "active")

    return v2


# ============================================================
# Validation
# ============================================================

def _validate(data: dict) -> None:
    """对 v2 schema 做字段校验，不通过 raise SchemaError。"""
    sv = data.get("schema_version")
    if sv != SCHEMA_VERSION:
        raise SchemaError(f"schema_version 必须是 {SCHEMA_VERSION}，实际：{sv!r}")

    # 必需字段
    for field in ("state_version", "session_id"):
        if field not in data:
            raise SchemaError(f"缺少必需字段：{field}")

    # 互斥字段
    for a, b in MUTEX_PAIRS:
        if data.get(a) is not None and data.get(b) is not None:
            raise SchemaError(f"{a} 和 {b} 互斥，不能同时设置")

    # 枚举字段
    if data.get("product") not in VALID_PRODUCTS:
        raise SchemaError(f"product 必须是 {sorted(s for s in VALID_PRODUCTS if s)} 之一")
    products = data.get("products")
    if products is not None:
        # cross-product session 必须显式带非空 products 列表，避免 [] 这种半合法状态落盘。
        if not isinstance(products, list) or not products:
            raise SchemaError("products 必须是非空 list[str]")
        invalid_products = [p for p in products if p not in VALID_PRODUCTS or p is None]
        if invalid_products:
            raise SchemaError(
                f"products 含非法值：{invalid_products}；"
                f"允许值为 {sorted(s for s in VALID_PRODUCTS if s)}"
            )
    if data.get("intent") not in VALID_INTENTS:
        raise SchemaError(f"intent 必须是 {sorted(s for s in VALID_INTENTS if s)} 之一")
    if data.get("status") not in VALID_STATUSES | {None}:
        raise SchemaError(f"status 必须是 {sorted(VALID_STATUSES)} 之一")
    if data.get("agent") not in VALID_AGENTS:
        raise SchemaError(f"agent 必须是 {sorted(s for s in VALID_AGENTS if s)} 之一")
    if data.get("platform") not in VALID_PLATFORMS:
        raise SchemaError(f"platform 必须是 {sorted(s for s in VALID_PLATFORMS if s)} 之一")
    if data.get("auto_advance_policy") not in VALID_AUTO_ADVANCE:
        raise SchemaError(
            f"auto_advance_policy 必须是 {sorted(s for s in VALID_AUTO_ADVANCE if s)} 之一，"
            f"或不设置（unset = fail closed，等同 pause_each）"
        )
    if data.get("integration_path") not in VALID_INTEGRATION_PATHS:
        raise SchemaError(
            f"integration_path 必须是 {sorted(s for s in VALID_INTEGRATION_PATHS if s)} 之一，或不设置"
        )
    coverage_decided = data.get("coverage_decided")
    if coverage_decided not in {True, False, None}:
        raise SchemaError("coverage_decided 必须是 bool，或不设置（legacy session）")

    session_context = data.get("session_context")
    if session_context is not None and not isinstance(session_context, dict):
        raise SchemaError("session_context 必须是 dict")

    business_decisions = ((session_context or {}).get("business_decisions"))
    if business_decisions is not None:
        if not isinstance(business_decisions, dict):
            raise SchemaError("session_context.business_decisions 必须是 dict")
        for slice_id, decisions in business_decisions.items():
            if not isinstance(decisions, dict):
                raise SchemaError(
                    f"session_context.business_decisions[{slice_id!r}] 必须是 dict"
                )
            for key, value in decisions.items():
                if not isinstance(value, (str, list)):
                    raise SchemaError(
                        "session_context.business_decisions 的 value 只允许 string 或 list[string]"
                    )
                if isinstance(value, list) and not all(isinstance(item, str) for item in value):
                    raise SchemaError(
                        f"session_context.business_decisions[{slice_id!r}][{key!r}] "
                        "必须是 string 或 list[string]"
                    )


# ============================================================
# Session class
# ============================================================

class Session:
    """session.yaml 的内存代表。

    读：直接通过属性访问（s.product / s.flow_entered / ...）
    写：必须通过 transaction() 上下文，CAS 保护。

    Direct attribute mutation is not supported——mutation 必须经
    transaction() 才能保证原子性 + CAS。
    """

    def __init__(self, data: dict, path: str, project_root: str):
        self._data = data
        self._path = path
        self._project_root = project_root

    # ---- 读访问 ----

    def __getattr__(self, name: str) -> Any:
        # 这条只在 __getattribute__ 找不到时才走（即不是私有属性）
        if name.startswith("_"):
            raise AttributeError(name)
        return self._data.get(name)

    def get(self, key: str, default: Any = None) -> Any:
        """显式 get（属性不存在时返回 default 而非 None）。"""
        return self._data.get(key, default)

    def to_dict(self) -> dict:
        """返回 session 数据的浅拷贝（read-only 视角）。"""
        return dict(self._data)

    @property
    def state_version(self) -> int:
        return self._data.get("state_version", 0)

    @property
    def session_id(self) -> str:
        return self._data.get("session_id", "")

    @property
    def path(self) -> str:
        return self._path

    @property
    def project_root(self) -> str:
        return self._project_root

    def is_cross_product(self) -> bool:
        """跨产品会话？"""
        return bool(self._data.get("products"))

    # ---- 加载 / 创建 ----

    @classmethod
    def load(cls, path: Optional[str] = None, project_root: Optional[str] = None) -> "Session":
        """从磁盘加载 session.yaml。

        Args:
          path: 显式 yaml 文件路径。默认：自动定位项目根 + SESSION_FILENAME。
          project_root: 显式项目根。默认：自动定位。

        Raises:
          MissingError: 文件不存在
          CorruptError: yaml 解析失败
          UnknownVersionError: schema_version 高于本工具支持
        """
        if path is None:
            project_root = project_root or find_project_root()
            path = os.path.join(project_root, SESSION_FILENAME)
        else:
            project_root = project_root or os.path.dirname(os.path.abspath(path))

        if not os.path.exists(path):
            raise MissingError(f"session 文件不存在：{path}")

        try:
            with open(path, "r", encoding="utf-8") as f:
                data = yaml.safe_load(f) or {}
        except yaml.YAMLError as e:
            # 损坏文件 archive 一份再 raise，per runtime-D fail-close 状态完整性
            backup = f"{path}.corrupted-{int(time.time())}.bak"
            try:
                os.rename(path, backup)
            except OSError:
                pass
            raise CorruptError(f"session 文件损坏（已备份到 {backup}）：{e}")

        if not isinstance(data, dict):
            raise CorruptError(f"session 文件格式错误（不是 mapping）：{path}")

        # Schema 版本判断
        sv = data.get("schema_version")
        if sv is None or sv == 1:
            data = _migrate_v1_to_v2(data)
        elif sv > SCHEMA_VERSION:
            raise UnknownVersionError(
                f"session 由更新版本工具创建（schema_version={sv}）。"
                f"请升级 tools/session.py（当前支持最高 {SCHEMA_VERSION}）"
            )

        return cls(data=data, path=path, project_root=project_root)

    @classmethod
    def create(cls, project_root: Optional[str] = None, **fields: Any) -> "Session":
        """新建会话。

        Args:
          project_root: 项目根（默认自动定位）
          **fields: 初始字段（product, platform, agent 等）

        Raises:
          SessionError: session.yaml 已存在（避免误覆盖；用 Session.load 重续）
        """
        project_root = project_root or find_project_root()
        path = os.path.join(project_root, SESSION_FILENAME)
        if os.path.exists(path):
            raise SessionError(
                f"session 已存在：{path}。用 Session.load() 重续，"
                f"或先 reset。"
            )

        now = _iso_now()
        data = {
            "schema_version": SCHEMA_VERSION,
            "state_version": 1,
            "session_id": _new_session_id(),
            "created_at": now,
            "updated_at": now,
            "status": "active",
            "integration_path": None,
            **fields,
        }
        # create 是唯一一次允许从无到有建 session 的入口，因此在落盘前先做完整 schema 校验。
        _validate(data)

        # 写入前 .gitignore 守护
        _ensure_gitignored(project_root)

        _atomic_write(path, data)

        emit_trace({
            "session_id": data["session_id"],
            "event": "session.create",
            "project_root": project_root,
            "initial_fields": list(fields.keys()),
        })

        return cls(data=data, path=path, project_root=project_root)

    # ---- 写：transaction ----

    @contextmanager
    def transaction(self) -> Iterator["Updater"]:
        """CAS-protected 写事务上下文。

        进入：拿独占锁
        yield：Updater 对象，调用方在它上面改字段
        退出：重读 session.yaml，校验 state_version，写新版本（state_version+1）

        Raises（在 __exit__ 时）:
          ConflictError: 期间有别人写过（state_version 不匹配）
          SchemaError: 修改后字段非法
        """
        lock_path = self._path + LOCK_SUFFIX
        with _flock(lock_path):
            # 重读，确认当前 state_version 跟我们记忆里的一致
            try:
                with open(self._path, "r", encoding="utf-8") as f:
                    on_disk = yaml.safe_load(f) or {}
            except FileNotFoundError:
                raise SessionError("session 文件在事务期间消失了")
            except yaml.YAMLError as e:
                raise CorruptError(f"事务期间 session 文件损坏：{e}")

            disk_version = on_disk.get("state_version", 0)
            if disk_version != self.state_version:
                # 先比 CAS，再写磁盘；谁先写成功，谁拥有下一个 state_version。
                raise ConflictError(
                    f"state_version 不匹配（内存={self.state_version}，"
                    f"磁盘={disk_version}）。请重 load 后重试。"
                )

            updater = Updater(dict(self._data))
            try:
                yield updater
            except Exception:
                raise

            new_data = updater._data
            new_data["state_version"] = self.state_version + 1
            new_data["updated_at"] = _iso_now()
            # 所有写入路径在落盘前统一校验，防止上层 transaction 忘了守 schema。
            _validate(new_data)
            _atomic_write(self._path, new_data)

            # trace
            emit_trace({
                "session_id": new_data.get("session_id"),
                "event": "session.write",
                "from_version": self.state_version,
                "to_version": new_data["state_version"],
                "fields_changed": _diff_fields(self._data, new_data),
                "agent": new_data.get("agent"),
            })

            # 同步内存
            self._data = new_data


class Updater:
    """事务期间用的可变视图。改完后 transaction 自动写盘。"""

    def __init__(self, data: dict):
        # 用 object.__setattr__ 避免触发自身的 __setattr__
        object.__setattr__(self, "_data", data)

    def __getattr__(self, name: str) -> Any:
        if name.startswith("_"):
            raise AttributeError(name)
        return self._data.get(name)

    def __setattr__(self, name: str, value: Any) -> None:
        if name.startswith("_"):
            object.__setattr__(self, name, value)
            return
        self._data[name] = value

    def __delattr__(self, name: str) -> None:
        if name.startswith("_"):
            object.__delattr__(self, name)
            return
        self._data.pop(name, None)

    def update(self, **fields: Any) -> None:
        """批量字段写入。"""
        self._data.update(fields)

    def apply_merge(self, patch: dict) -> None:
        """把 patch deep-merge 到当前 session 视图。"""
        self._data = _deep_merge_dicts(self._data, patch)

    def get(self, key: str, default: Any = None) -> Any:
        return self._data.get(key, default)


def _diff_fields(old: dict, new: dict) -> list:
    """返回字段层面的 diff（哪些字段被改 / 加 / 删）。"""
    keys = set(old.keys()) | set(new.keys())
    changed = []
    for k in keys:
        if old.get(k) != new.get(k):
            changed.append(k)
    return sorted(changed)


def _deep_merge_dicts(base: dict, patch: dict) -> dict:
    """递归合并 dict。

    语义：
      - dict + dict → 递归合并
      - list / scalar → patch 整体覆盖 base

    这样 write-batch 更新 session_context.business_decisions 时，不会把同层的
    enhancement_level / headless_business_flow 等兄弟字段静默抹掉。
    """
    merged = dict(base)
    for key, value in patch.items():
        if isinstance(value, dict) and isinstance(merged.get(key), dict):
            merged[key] = _deep_merge_dicts(merged[key], value)
        else:
            merged[key] = value
    return merged


def _parse_expected_version(args: list[str]) -> int:
    if "--expected-version" not in args:
        raise ValueError("缺少 --expected-version N")
    i = args.index("--expected-version")
    try:
        return int(args[i + 1])
    except (IndexError, ValueError):
        raise ValueError("--expected-version 必须跟整数")


def _reject_protected_patch_fields(patch: dict, path: tuple[str, ...] = ()) -> None:
    for key, value in patch.items():
        current = path + (key,)
        dotted = ".".join(current)
        if key in PROTECTED_PATCH_FIELDS and len(current) == 1:
            raise SchemaError(f"{dotted} 不能通过 write-batch patch")
        if isinstance(value, dict):
            _reject_protected_patch_fields(value, current)


def _parse_field_assignment(text: str) -> tuple[str, Any]:
    if "=" not in text:
        raise ValueError("--field 必须是 key=value")
    key, raw = text.split("=", 1)
    if not key:
        raise ValueError("--field 的 key 不能为空")
    try:
        value = json.loads(raw)
    except json.JSONDecodeError:
        value = raw
    return key, value


# ============================================================
# CLI
# ============================================================

def _prepare_completed_session_for_add_feature(session_data: dict) -> dict:
    """把 completed topic session 归一化为可继续加功能的 active session。"""
    return {
        "intent": "integrate-feature",
        "status": "active",
        "active_flow": "onboarding",
        "flow_entered": True,
        "integration_path": "topic",
        "flow_state": {},
        "execution_queue": [],
        "current_execution_index": 0,
        "current_execution_state": None,
        "confirmed_plan": [],
        "coverage_decided": True,
        "completed_steps": [],
    }


def _cli_create(args: list[str]) -> int:
    """python3 -m tools.session create [--product X] [--platform Y] [--agent Z]"""
    # 简单 --key value 解析
    fields: dict = {}
    i = 0
    while i < len(args):
        a = args[i]
        if a.startswith("--") and i + 1 < len(args) and not args[i + 1].startswith("--"):
            fields[a[2:]] = args[i + 1]
            i += 2
        else:
            i += 1
    try:
        s = Session.create(**fields)
    except SessionError as e:
        print(f"ERROR: {e}", file=sys.stderr)
        return 1
    except SchemaError as e:
        print(f"INVALID: {e}", file=sys.stderr)
        return 1
    print(f"created session_id: {s.session_id}")
    print(f"path: {s.path}")
    return 0


def _cli_read(args: list[str]) -> int:
    """python3 -m tools.session read [--field X]"""
    field = None
    with_version = "--with-version" in args
    if "--field" in args:
        i = args.index("--field")
        field = args[i + 1]
    try:
        s = Session.load()
    except MissingError as e:
        print(str(e), file=sys.stderr)
        return 1
    except (CorruptError, UnknownVersionError) as e:
        print(f"ERROR: {e}", file=sys.stderr)
        return 2
    if field:
        payload = {field: s.get(field)}
        if with_version:
            payload["state_version"] = s.state_version
        print(yaml.safe_dump(payload, allow_unicode=True, sort_keys=False), end="")
    else:
        print(yaml.safe_dump(s.to_dict(), allow_unicode=True, sort_keys=False), end="")
    return 0


def _cli_write(args: list[str]) -> int:
    """python3 -m tools.session write --field key=value --expected-version N"""
    if "--field" not in args:
        print("ERROR: 缺少 --field key=value", file=sys.stderr)
        return 1
    i = args.index("--field")
    try:
        assignment = args[i + 1]
        expected_version = _parse_expected_version(args)
        key, value = _parse_field_assignment(assignment)
        _reject_protected_patch_fields({key: value})
        s = Session.load()
        with s.transaction() as upd:
            if s.state_version != expected_version:
                raise ConflictError(
                    f"state_version 不匹配（内存={s.state_version}，期望={expected_version}）"
                )
            setattr(upd, key, value)
    except ValueError as e:
        print(f"ERROR: {e}", file=sys.stderr)
        return 1
    except SchemaError as e:
        print(f"INVALID: {e}", file=sys.stderr)
        return 1
    except ConflictError as e:
        print(f"CONFLICT: {e}", file=sys.stderr)
        return 3
    except MissingError as e:
        print(str(e), file=sys.stderr)
        return 2
    except (CorruptError, UnknownVersionError) as e:
        print(f"ERROR: {e}", file=sys.stderr)
        return 2
    except SessionError as e:
        print(f"ERROR: {e}", file=sys.stderr)
        return 2
    print(f"state_version: {s.state_version}")
    return 0


def _cli_write_batch(args: list[str]) -> int:
    """python3 -m tools.session write-batch --updates '{...}' --expected-version N"""
    if "--updates" not in args:
        print("ERROR: 缺少 --updates '{...}'", file=sys.stderr)
        return 1
    i = args.index("--updates")
    try:
        raw_updates = args[i + 1]
        expected_version = _parse_expected_version(args)
        updates = json.loads(raw_updates)
        if not isinstance(updates, dict) or not updates:
            raise ValueError("--updates 必须是非空 JSON object")
        _reject_protected_patch_fields(updates)
        s = Session.load()
        with s.transaction() as upd:
            if s.state_version != expected_version:
                raise ConflictError(
                    f"state_version 不匹配（内存={s.state_version}，期望={expected_version}）"
                )
            upd.apply_merge(updates)
    except (json.JSONDecodeError, ValueError) as e:
        print(f"ERROR: {e}", file=sys.stderr)
        return 1
    except SchemaError as e:
        print(f"INVALID: {e}", file=sys.stderr)
        return 1
    except ConflictError as e:
        print(f"CONFLICT: {e}", file=sys.stderr)
        return 3
    except MissingError as e:
        print(str(e), file=sys.stderr)
        return 2
    except (CorruptError, UnknownVersionError) as e:
        print(f"ERROR: {e}", file=sys.stderr)
        return 2
    except SessionError as e:
        print(f"ERROR: {e}", file=sys.stderr)
        return 2
    print(f"state_version: {s.state_version}")
    return 0


def _cli_reopen_add_feature(_args: list[str]) -> int:
    """python3 -m tools.session reopen-add-feature"""
    try:
        s = Session.load()
        with s.transaction() as upd:
            prepared = _prepare_completed_session_for_add_feature(dict(upd._data))
            for key, value in prepared.items():
                setattr(upd, key, value)
    except SchemaError as e:
        print(f"INVALID: {e}", file=sys.stderr)
        return 1
    except MissingError as e:
        print(str(e), file=sys.stderr)
        return 2
    except (CorruptError, UnknownVersionError) as e:
        print(f"ERROR: {e}", file=sys.stderr)
        return 2
    except SessionError as e:
        print(f"ERROR: {e}", file=sys.stderr)
        return 2
    print("session reopened for add-feature")
    return 0


def _cli_reset(_args: list[str]) -> int:
    """python3 -m tools.session reset"""
    try:
        s = Session.load()
    except MissingError as e:
        print(str(e), file=sys.stderr)
        return 2
    except (CorruptError, UnknownVersionError) as e:
        print(f"ERROR: {e}", file=sys.stderr)
        return 2

    src = Path(s.path)
    backup = src.with_name(f"{src.name}.reset-{int(time.time())}.bak")
    src.rename(backup)
    emit_trace({
        "session_id": s.session_id,
        "event": "session.reset",
        "backup_path": str(backup),
    })
    print(f"reset backup: {backup}")
    return 0


def _cli_status(_args: list[str]) -> int:
    """人类可读摘要。调试用。"""
    try:
        s = Session.load()
    except MissingError:
        print("session: 不存在")
        return 0
    except (CorruptError, UnknownVersionError) as e:
        print(f"session: ERROR {e}")
        return 2
    d = s.to_dict()
    print(f"session_id:        {d.get('session_id')}")
    print(f"schema_version:    {d.get('schema_version')}")
    print(f"state_version:     {d.get('state_version')}")
    print(f"status:            {d.get('status')}")
    print(f"product:           {d.get('product') or d.get('products')}")
    print(f"platform:          {d.get('platform')}")
    print(f"intent:            {d.get('intent')}")
    print(f"agent:             {d.get('agent')}")
    print(f"active_domain_skill: {d.get('active_domain_skill')}")
    print(f"active_flow:       {d.get('active_flow')}")
    print(f"active_scenario:   {d.get('active_scenario') or d.get('active_cross_scenario')}")
    print(f"flow_entered:      {d.get('flow_entered')}")
    print(f"updated_at:        {d.get('updated_at')}")
    return 0


def _cli_validate(_args: list[str]) -> int:
    """CI 用。"""
    try:
        s = Session.load()
        _validate(s.to_dict())
    except MissingError:
        print("session: 不存在（视为 OK——还没创建）")
        return 0
    except SchemaError as e:
        print(f"INVALID: {e}", file=sys.stderr)
        return 1
    except (CorruptError, UnknownVersionError) as e:
        print(f"ERROR: {e}", file=sys.stderr)
        return 2
    print("VALID")
    return 0


def _cli_migrate(_args: list[str]) -> int:
    """v1 → v2 一次性迁移。"""
    project_root = find_project_root()
    path = os.path.join(project_root, SESSION_FILENAME)
    if not os.path.exists(path):
        print("session 不存在，无需迁移", file=sys.stderr)
        return 0
    with open(path, "r", encoding="utf-8") as f:
        data = yaml.safe_load(f) or {}
    sv = data.get("schema_version")
    if sv == SCHEMA_VERSION:
        print(f"已经是 v{SCHEMA_VERSION}，无需迁移")
        return 0
    if sv is None or sv == 1:
        # 备份
        backup = f"{path}.v1.bak"
        with open(backup, "w", encoding="utf-8") as f:
            yaml.safe_dump(data, f, allow_unicode=True, sort_keys=False)
        new_data = _migrate_v1_to_v2(data)
        _validate(new_data)
        _atomic_write(path, new_data)
        print(f"迁移完成：v1 → v{SCHEMA_VERSION}")
        print(f"v1 备份：{backup}")
        return 0
    print(f"未知 schema_version：{sv}", file=sys.stderr)
    return 2


def main() -> int:
    argv = sys.argv[1:]
    if not argv:
        print(__doc__)
        return 0
    cmd, rest = argv[0], argv[1:]
    handlers = {
        "create": _cli_create,
        "read": _cli_read,
        "write": _cli_write,
        "write-batch": _cli_write_batch,
        "reset": _cli_reset,
        "reopen-add-feature": _cli_reopen_add_feature,
        "status": _cli_status,
        "validate": _cli_validate,
        "migrate": _cli_migrate,
    }
    if cmd in {"-h", "--help"}:
        print(__doc__)
        return 0
    handler = handlers.get(cmd)
    if not handler:
        print(f"未知子命令：{cmd}", file=sys.stderr)
        print(f"可用：{', '.join(handlers)}", file=sys.stderr)
        return 2
    if any(arg in {"-h", "--help"} for arg in rest):
        print(handler.__doc__ or __doc__)
        return 0
    return handler(rest)


if __name__ == "__main__":
    raise SystemExit(main())
