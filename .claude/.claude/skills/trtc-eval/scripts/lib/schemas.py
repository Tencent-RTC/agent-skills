"""Data contracts for the TRTC eval toolchain.

All cross-script JSON payloads MUST be validated through these models.
"""
from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from typing import Any, Literal, Union


class UIInteraction(BaseModel):
    """A single UI interaction point for hybrid UI-driven eval mode.

    When the autorun flow reaches this action, it first attempts to find and
    click an interactive element matching the keywords, then falls back to the
    direct API call if no element is found.
    """

    action: str  # e.g. "login", "create-room", "toggle-camera"
    keywords: list[str]  # text content to match: ["登录", "Login"]
    element: str = "button"  # element type selector: "button", "a", etc.


class Constraints(BaseModel):
    """Code constraints for a single eval case. evaluator.py reads and executes grep."""

    must_include: list[str] = Field(default_factory=list)
    must_not_include: list[str] = Field(default_factory=list)
    must_include_in_files: dict[str, list[str]] = Field(default_factory=dict)
    file_count_min: int = 1


class Weights(BaseModel):
    """Scoring weights. Defined in cases.json, NEVER in skill prompts."""

    w_must_include: float = 0.6
    w_must_not: float = 0.4
    w_events: float = 0.7
    w_compile_bonus: float = 0.3
    w_static_in_final: float = 0.4
    w_dynamic_in_final: float = 0.6

    @field_validator("w_static_in_final", "w_dynamic_in_final")
    @classmethod
    def _check_final_sum(cls, v: float) -> float:
        return v


class Acceptance(BaseModel):
    """Pass thresholds. Either static or dynamic not meeting threshold => passed=False."""

    static_score_min: float = 0.7
    dynamic_score_min: float = 0.7
    must_compile: bool = True


class InjectionPoint(BaseModel):
    """A single ability's code injection point (pairs with template INJECTION.json, see §5.2)."""

    target_file: str
    replace_mode: Literal["overwrite", "append", "between_markers"] = "overwrite"
    marker_begin: str | None = None
    marker_end: str | None = None


class TraceStep(BaseModel):
    """A single line written to trace.jsonl by orchestrator."""

    step: Literal[
        "_meta", "run_ai", "evaluator", "demo_build",
        "log_stream_start", "demo_run", "log_stream_stop", "runtime_monitor"
    ]
    ts: str
    exit_code: int | None = None
    duration_sec: float | None = None
    status: Literal["ok", "fail", "skipped", "timeout"] | None = None
    reason: str | None = None
    stdout_tail: str | None = None
    stderr_tail: str | None = None
    nonce: str | None = None


# ---------------------------------------------------------------------------
# Auto-run flow DSL (web only, consumed by scripts/lib/flow_codegen.py)
# ---------------------------------------------------------------------------
#
# The DSL replaces hand-written templates/web-demo/src/autorun/<flow>.ts
# files. Each Case carries its own flow definition; the codegen runs at
# build time and emits a single <test_id>.ts plus an autoRunCoordinator
# that registers it (and any depends_on builtin).
#
# The five step shapes below cover the structural variation of all 27
# legacy flows:
#
#   - CallStep:      `await <hook>.<method>(...args)` with timeout + on_error
#   - SleepStep:     `await new Promise(r => setTimeout(r, <ms>))`
#   - LogStep:       `console.log(<text>)` — used to drop cpp-style tokens
#                    that runtime_monitor's expected_event_hit matches on
#   - SubscribeStep: `<hook>.subscribeEvent(<event>, () => console.log(<log>))`
#   - WaitForStep:   poll `<hook>.<prop>` to truthy with <timeout_ms> budget
#
# Anything that needs more than these shapes (e.g. login.ts's idempotent-login
# race-condition handling) is kept as a hand-written builtin under
# templates/web-demo/src/autorun/_builtin/ and referenced via depends_on.


class HookBinding(BaseModel):
    """Aliased hook binding. ``rs: { from: 'room', call: 'useRoomState' }``
    becomes ``const rs = (room as any).useRoomState();`` in generated code."""

    model_config = ConfigDict(extra="forbid")

    # Module alias declared in AutoRunFlow.imports
    from_: str = Field(alias="from")
    # Hook function name on that module (e.g. ``useRoomState``)
    call: str


class VarBinding(BaseModel):
    """A runtime-evaluated variable. Emitted as ``const <name> = (<expr>);``
    in the generated TypeScript. Use ``env.userId`` / ``Date.now()`` /
    ``Math.floor(...)`` etc. inside ``expr``; the codegen does not parse
    or sanitise — keep expressions short and side-effect-free."""

    model_config = ConfigDict(extra="forbid")

    expr: str


class CallStep(BaseModel):
    """``await <alias>.<method>(...args)``. ``call`` MUST be ``alias.method``
    where alias is registered in AutoRunFlow.hooks."""

    model_config = ConfigDict(extra="forbid")

    call: str
    args: list[object] = Field(default_factory=list)
    timeout_ms: int | None = None
    # ``continue`` (default): swallow rejection, log warning, run next step.
    # ``abort``: log error, return from run() — subsequent steps skipped.
    # ``throw``: rethrow so autoRunCoordinator's outer catch records it.
    on_error: Literal["continue", "abort", "throw"] | None = None
    # Optional override for the auto-emitted log line. If unset the codegen
    # writes ``console.log(`[autorun:<test_id>] <method>`)`` before the call.
    log: str | None = None
    # Optional: maps this step to a ui_interactions entry for hybrid mode.
    # When set, flow_codegen wraps the call with tryClickUI using the
    # matching UIInteraction's keywords/element. If unset, the codegen
    # uses heuristic method-name matching against the ui_map.
    ui_action: str | None = None


class SleepStep(BaseModel):
    model_config = ConfigDict(extra="forbid")

    sleep: int  # milliseconds


class LogStep(BaseModel):
    model_config = ConfigDict(extra="forbid")

    log: str


class SubscribeStep(BaseModel):
    """Register a console.log handler for a hook event.
    Expands to ``<hook>.subscribeEvent(<event>, () => console.log(<log>))``."""

    model_config = ConfigDict(extra="forbid")

    subscribe: str  # alias.method, e.g. "loginApi.subscribeEvent"
    event: str  # raw TS expression, e.g. "LoginEvent.onLoginExpired"
    log: str


class WaitForStep(BaseModel):
    """Poll a hook property until truthy or timeout.
    Expands to a 200ms-interval loop reading ``<hook>.<prop>``."""

    model_config = ConfigDict(extra="forbid")

    wait_for: str  # alias.path, e.g. "loginApi.loginUserInfo.value.userId"
    timeout_ms: int = 10_000


AutoRunStep = Union[CallStep, SleepStep, LogStep, SubscribeStep, WaitForStep]


class AutoRunDefaults(BaseModel):
    model_config = ConfigDict(extra="forbid")

    timeout_ms: int = 10_000
    on_error: Literal["continue", "abort", "throw"] = "continue"


class AutoRunFlow(BaseModel):
    """Declarative auto-run flow. Compiled to TS by scripts/lib/flow_codegen.py."""

    model_config = ConfigDict(extra="forbid")

    # Builtin flow ids to await before running this flow's steps. Each id
    # MUST have a matching .ts under templates/web-demo/src/autorun/_builtin/.
    depends_on: list[str] = Field(default_factory=list)
    # Module alias → npm package import path.
    imports: dict[str, str] = Field(default_factory=dict)
    # Hook alias → ``HookBinding``.
    hooks: dict[str, HookBinding] = Field(default_factory=dict)
    # Var name → ``VarBinding`` (string expression evaluated at flow start).
    vars: dict[str, VarBinding] = Field(default_factory=dict)
    steps: list[AutoRunStep] = Field(default_factory=list)
    defaults: AutoRunDefaults = Field(default_factory=AutoRunDefaults)

    @model_validator(mode="after")
    def _validate_call_aliases(self) -> "AutoRunFlow":
        """Catch typos at parse time: every step's first identifier must
        resolve to a hook registered in ``hooks``. We only inspect the
        leading identifier (``[A-Za-z_]\\w*``) so expressions like
        ``alias.foo.value.bar`` and ``(alias as any).x`` both parse — the
        TS compiler catches deeper mistakes."""
        import re as _re
        head = _re.compile(r"[A-Za-z_]\w*")
        for i, step in enumerate(self.steps):
            target: str | None = None
            if isinstance(step, CallStep):
                target = step.call
            elif isinstance(step, SubscribeStep):
                target = step.subscribe
            elif isinstance(step, WaitForStep):
                target = step.wait_for
            if target is None:
                continue
            m = head.search(target)
            if m is None:
                raise ValueError(f"step[{i}] target '{target}' has no identifier")
            alias = m.group(0)
            if alias not in self.hooks:
                raise ValueError(
                    f"step[{i}] references undefined hook alias '{alias}' "
                    f"(registered: {sorted(self.hooks)})"
                )
        for alias, hook in self.hooks.items():
            if hook.from_ not in self.imports:
                raise ValueError(
                    f"hook '{alias}' references undeclared import alias "
                    f"'{hook.from_}' (registered: {sorted(self.imports)})"
                )
        return self


class Case(BaseModel):
    """A single eval case from cases.json."""

    test_id: str
    ability: str
    product: Literal["chat", "call", "rtc-engine", "live", "room", "conference"]
    platform: Literal["ios", "android", "web", "flutter", "electron", "unity"]
    scenario: str | None = None
    user_prompt: str
    expected_slice_ids: list[str]
    constraints: Constraints
    expected_events: list[str]
    acceptance: Acceptance
    weights: Weights = Field(default_factory=Weights)
    # --- DEPRECATED (optimizer v2 Phase 4 — will be removed) ---
    # When empty ({}) or missing, the eval tool uses AI filepath declarations
    # and content-feature detection to auto-route files.  Non-empty maps are
    # still honoured for backward compatibility with existing cases.
    demo_injection_map: dict[str, InjectionPoint] = Field(default_factory=dict)
    # --- DEPRECATED (optimizer v2 Phase 4 — will be removed) ---
    # When empty ([]) or missing, the AI is expected to generate an
    # eval-autorun.ts that self-drives the test.  The DSL AutoRunFlow form
    # is still compiled for existing cases; new cases should omit this field.
    # Two accepted shapes:
    #   1. ``list[str]`` — legacy. Each string is a builtin flow id registered
    #      in templates/web-demo/src/autorun/_builtin/. autoRunCoordinator
    #      imports the matching .ts file directly.
    #   2. ``AutoRunFlow`` — declarative DSL. flow_codegen renders a fresh
    #      ``<test_id>.ts`` plus a thin autoRunCoordinator that registers it
    #      alongside any ``depends_on`` builtins. Authoring new cases should
    #      always use this form; the list form remains so the rare polling
    #      / event-driven flows (login, anchor_start_then_end) can keep
    #      hand-written .ts.
    auto_run_flow: Union[AutoRunFlow, list[str]] = Field(default_factory=list)
    # UI interaction points for hybrid UI-driven eval mode.
    # When defined, the autorun flow attempts to click UI elements before
    # falling back to direct API calls. Enables ui_driven_ratio scoring.
    ui_interactions: list[UIInteraction] = Field(default_factory=list)
    tags: list[str]
    status: Literal["active", "draft"]

    def autorun_flow_ids(self) -> list[str]:
        """Flow ids to pass to the in-browser autoRunCoordinator via
        ``EVAL_AUTO_RUN_FLOW``. Hides the list-vs-DSL union from callers.

        - Legacy ``list[str]`` form: ids forwarded verbatim (run sequentially).
        - DSL ``AutoRunFlow`` form: a single entry equal to ``test_id`` —
          the codegen registers ``test_id`` as the dispatch key.
        """
        if isinstance(self.auto_run_flow, AutoRunFlow):
            return [self.test_id]
        return list(self.auto_run_flow)


class StaticResult(BaseModel):
    """Output of evaluator.py."""

    test_id: str
    must_include_hit: float
    must_not_include_clean: float
    hits: list[str]
    misses: list[str]
    dirty: list[str]
    score: float


class DynamicResult(BaseModel):
    """Output of runtime_monitor.py."""

    test_id: str
    compile_ok: bool
    compile_exit_code: int
    events_captured: list[str]
    events_missing: list[str]
    events_hit_ratio: float
    nonce_seen: bool = False
    score: float
    # Runtime-health probes (web only, populated by log-bridge __probe lines).
    # All four counters default to 0 so older case results deserialize cleanly.
    page_errors: int = 0
    unhandled_rejections: int = 0
    vue_warnings: int = 0
    request_failures: int = 0
    # Total amount subtracted from base dynamic_score by the health rubric.
    # Recorded explicitly for audit so reviewers can tell "score=0.4 from
    # compile_bonus alone" from "score=0.4 after a 0.3 health penalty".
    health_penalty: float = 0.0
    # DOM snapshot probe (web only): whether the rendered DOM has substantive
    # content beyond the eval-skeleton placeholder. Used to gate the 0/0 =
    # full-score loophole when expected_events is empty.
    dom_has_content: bool = False
    # --- v2 fields (P0 scoring improvements) ---
    # Number of unique errors after fingerprint deduplication.
    unique_error_count: int = 0
    # Deduped error signatures: "message|source_location" for audit trail.
    error_fingerprints: list[str] = Field(default_factory=list)
    # Visible text length (innerText.length) from DOM snapshot probe.
    dom_text_length: int = 0
    # Count of interactive elements (buttons, inputs, selects) in rendered DOM.
    dom_interactive_elements: int = 0
    # UI interaction metrics (hybrid UI-driven mode).
    ui_interaction_count: int = 0
    ui_interaction_success: int = 0
    ui_driven_ratio: float = 0.0


class CaseSummary(BaseModel):
    """Per-case summary written by orchestrator."""

    test_id: str
    ability: str
    platform: str
    static_result: StaticResult | None
    dynamic_result: DynamicResult | None
    final_score: float
    passed: bool
    failure_reason: str | None = None
    artifacts_dir: str
    duration_sec: float
    # Transparent scoring breakdown so reviewers can trace exactly how
    # final_score was computed. Includes raw scores, weights, and formula.
    score_breakdown: dict | None = None
