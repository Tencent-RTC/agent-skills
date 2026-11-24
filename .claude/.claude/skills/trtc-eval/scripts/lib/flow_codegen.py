"""flow_codegen.py — DSL → TypeScript renderer for autorun flows.

Reads ``case.auto_run_flow`` (an :class:`AutoRunFlow`) and writes:

  workspace/src/autorun/_runtime.ts                — shared helpers, copied verbatim
  workspace/src/autorun/<builtin>.ts               — for each id in depends_on
  workspace/src/autorun/<test_id>.ts               — generated from the DSL
  workspace/src/autorun/autoRunCoordinator.ts      — registers test_id + builtins

The legacy ``list[str]`` form is also supported: it just copies the named
builtin .ts files and registers them under their own ids.

Why a code generator and not a runtime interpreter?
  - HeadlessChrome already runs a Vite-bundled tsc'd app; emitting raw TS
    keeps build/lint/sourcemap behavior identical to hand-written flows.
  - puppeteer_parser.expected_event_hit matches on console output verbatim,
    so what the runtime sees IS what we emit. A static .ts is the simplest
    way to keep that contract auditable.
  - Same DSL interpreter would otherwise need to live in the browser bundle,
    growing the test-only surface that ships into ``workspace/`` and risking
    drift with the cases.json schema.
"""
from __future__ import annotations

import json
import shutil
from pathlib import Path
from typing import Any

from scripts.lib.schemas import (
    AutoRunDefaults,
    AutoRunFlow,
    Case,
    CallStep,
    LogStep,
    SleepStep,
    SubscribeStep,
    UIInteraction,
    WaitForStep,
)


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------

def generate(case: Case, workspace: Path, builtin_root: Path) -> None:
    """Write the autorun .ts files for ``case`` into ``workspace/src/autorun/``.

    ``builtin_root`` points at ``templates/web-demo/src/autorun/_builtin/``;
    every id referenced via ``depends_on`` (or the legacy ``list[str]`` form)
    must have a matching ``<id>.ts`` directly under that directory.

    Idempotent: re-running on the same workspace overwrites generated files
    and does not delete unrelated content. The caller (demo_runner) is
    responsible for ensuring code_injector.inject() ran first so that any
    AI-supplied generated/*.ts that an autorun flow imports already exists.
    """
    autorun_dir = workspace / "src" / "autorun"
    autorun_dir.mkdir(parents=True, exist_ok=True)

    # 1) _runtime.ts — copied verbatim from the builtin pool's parent.
    _copy_runtime(builtin_root, autorun_dir)

    # 2) Resolve the flow shape and the set of (id, source_path) builtins
    #    we need to materialise alongside the generated <test_id>.ts.
    flow = case.auto_run_flow
    builtin_ids: list[str]
    test_id_registered: bool
    if isinstance(flow, AutoRunFlow):
        builtin_ids = list(flow.depends_on)
        test_id_registered = True
        case_ts = _render_dsl(case.test_id, flow, case.ui_interactions)
        (autorun_dir / f"{case.test_id}.ts").write_text(case_ts, encoding="utf-8")
    else:
        # Legacy list[str] form: each id IS a builtin file. We do not emit a
        # case-specific .ts; the coordinator dispatches directly to the
        # builtin's exported run().
        builtin_ids = list(flow)
        test_id_registered = False

    for bid in builtin_ids:
        _copy_builtin(builtin_root, autorun_dir, bid)

    # 3) autoRunCoordinator — registers test_id (if DSL form) plus every builtin.
    coordinator = _render_coordinator(
        case_id=case.test_id if test_id_registered else None,
        builtin_ids=builtin_ids,
    )
    (autorun_dir / "autoRunCoordinator.ts").write_text(coordinator, encoding="utf-8")


# ---------------------------------------------------------------------------
# File copy helpers
# ---------------------------------------------------------------------------

def _copy_runtime(builtin_root: Path, autorun_dir: Path) -> None:
    """Copy ``_runtime.ts`` from the template into ``autorun_dir``.

    ``_runtime.ts`` lives one level above ``_builtin/`` (i.e. as a sibling of
    the builtin directory) so the filesystem layout in the template matches
    the layout in workspace.
    """
    src = builtin_root.parent / "_runtime.ts"
    if not src.exists():
        raise FileNotFoundError(
            f"flow_codegen: missing _runtime.ts at {src}. The template needs "
            f"_runtime.ts as a sibling of _builtin/."
        )
    shutil.copyfile(src, autorun_dir / "_runtime.ts")


def _copy_builtin(builtin_root: Path, autorun_dir: Path, builtin_id: str) -> None:
    """Copy a builtin .ts into the workspace, rewriting source-relative
    imports to deployed-relative ones.

    The source layout puts builtins one level deeper than ``_runtime.ts`` and
    ``../generated/`` (i.e. ``_builtin/login.ts`` ⟶ ``../_runtime`` and
    ``../../generated/anchorView``). In the workspace, both ``_runtime.ts``
    and the generated AI code are siblings of the builtin under
    ``src/autorun/`` and ``src/`` respectively — so we drop one ``../`` from
    each import path. Rewriting here keeps the source readable (relative
    paths reflect file layout) without forcing flow_codegen to rebuild the
    entire workspace tree.
    """
    src = builtin_root / f"{builtin_id}.ts"
    if not src.exists():
        raise FileNotFoundError(
            f"flow_codegen: builtin '{builtin_id}' referenced by case but "
            f"{src} does not exist. Add the .ts under _builtin/ or remove "
            f"the depends_on entry."
        )
    body = src.read_text(encoding="utf-8")
    # _runtime: ../_runtime  →  ./_runtime
    body = body.replace('"../_runtime"', '"./_runtime"').replace(
        "'../_runtime'", "'./_runtime'"
    )
    # generated/: ../../generated/  →  ../generated/
    body = body.replace('"../../generated/', '"../generated/').replace(
        "'../../generated/", "'../generated/"
    )
    (autorun_dir / f"{builtin_id}.ts").write_text(body, encoding="utf-8")


# ---------------------------------------------------------------------------
# Coordinator template
# ---------------------------------------------------------------------------

_COORDINATOR_HEADER = """// AUTO-GENERATED by scripts/lib/flow_codegen.py — do not edit by hand.
// Source of truth: cases.json :: <test_id>.auto_run_flow
type FlowModule = { run: () => Promise<void> };

const FLOWS: Record<string, () => Promise<FlowModule>> = {
"""

_COORDINATOR_BODY = '''};

export async function runAutoFlow(flowIds: string): Promise<void> {
  const ids = flowIds.split(",").map((s) => s.trim()).filter(Boolean);

  for (const flowId of ids) {
    const loader = FLOWS[flowId];
    if (!loader) {
      console.error(
        `[MyApplication] auto-run flow failed: Unknown EVAL_AUTO_RUN_FLOW: ${flowId}. ` +
          `Known: ${Object.keys(FLOWS).join(", ")}`,
      );
      continue;
    }

    // 60s 全局超时 —— 与 INJECTION.json.auto_run_flows[*].timeout_sec 对齐
    const timeoutMs = 60_000;
    const timer = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Auto-run flow "${flowId}" timeout after ${timeoutMs}ms`)), timeoutMs),
    );

    try {
      const mod = await loader();
      await Promise.race([mod.run(), timer]);
      console.log(`[MyApplication] auto-run flow done: ${flowId}`);
    } catch (e) {
      console.error(`[MyApplication] auto-run flow failed: ${flowId}: ${(e as Error).message}`);
      // Continue to next flow — we want maximum event coverage.
    }
  }

  console.log(`[MyApplication] all auto-run flows completed`);
  try {
    window.close();
  } catch {
    /* ignored — non-window contexts (jsdom etc.) */
  }
}
'''


def _render_coordinator(case_id: str | None, builtin_ids: list[str]) -> str:
    entries: list[str] = []
    seen: set[str] = set()
    if case_id is not None:
        entries.append(f'  "{case_id}": () => import("./{case_id}"),')
        seen.add(case_id)
    for bid in builtin_ids:
        if bid in seen:
            continue
        entries.append(f'  "{bid}": () => import("./{bid}"),')
        seen.add(bid)
    return _COORDINATOR_HEADER + "\n".join(entries) + "\n" + _COORDINATOR_BODY


# ---------------------------------------------------------------------------
# DSL → TS renderer
# ---------------------------------------------------------------------------

def _render_dsl(test_id: str, flow: AutoRunFlow, ui_interactions: list[UIInteraction] | None = None) -> str:
    """Render an AutoRunFlow into a single TS module exporting ``run()``."""
    ui_map: dict[str, UIInteraction] = {}
    if ui_interactions:
        for ui in ui_interactions:
            ui_map[ui.action] = ui

    log_tag = f"autorun:{test_id}"
    # Import tryClickUI only when ui_interactions are defined
    runtime_imports = "withTimeout, getEnv"
    if ui_map:
        runtime_imports += ", tryClickUI"
    out: list[str] = [
        f"// AUTO-GENERATED from cases.json :: {test_id}.auto_run_flow",
        '// Edit the DSL in cases.json instead of touching this file directly.',
        f'import {{ {runtime_imports} }} from "./_runtime";',
        "",
        "export async function run(): Promise<void> {",
    ]

    # depends_on — sequential await of each builtin's run().
    for dep in flow.depends_on:
        out.append(f'  await (await import("./{dep}")).run();')
    if flow.depends_on:
        out.append("")

    # env — only emit if any var/log/arg actually references it. Cheap to
    # always emit; flow_codegen output is short-lived and tsc is OK with
    # unused-but-prefixed variables when noUnused* is off (template default).
    out.append("  const env = getEnv();")
    out.append("")

    # imports — `const room = await import(...)` per registered alias.
    for alias, path in flow.imports.items():
        out.append(f'  const {alias} = await import("{path}");')
    if flow.imports:
        out.append("")

    # hooks — `const rs = (room as any).useRoomState();`
    for alias, hook in flow.hooks.items():
        out.append(
            f"  const {alias} = ({hook.from_} as any).{hook.call}();"
        )
    if flow.hooks:
        out.append("")

    # vars — `const roomId = (`eval_${env.userId}_${Date.now()}`);`
    # Wrapping in parens keeps template literals / arithmetic / etc. all
    # safely terminated by the const's `;`.
    for name, vbind in flow.vars.items():
        out.append(f"  const {name} = ({vbind.expr});")
    if flow.vars:
        out.append("")

    # steps
    var_names = set(flow.vars.keys())
    for step in flow.steps:
        out.extend(_render_step(step, log_tag=log_tag, defaults=flow.defaults, var_names=var_names, ui_map=ui_map))

    out.append("}")
    out.append("")  # trailing newline
    return "\n".join(out)


def _render_step(
    step: Any, *, log_tag: str, defaults: AutoRunDefaults, var_names: set[str],
    ui_map: dict[str, UIInteraction] | None = None,
) -> list[str]:
    if isinstance(step, LogStep):
        return [f"  console.log(`[{log_tag}] {_interp_template(step.log, var_names)}`);"]

    if isinstance(step, SleepStep):
        return [f"  await new Promise((r) => setTimeout(r, {step.sleep}));"]

    if isinstance(step, CallStep):
        return _render_call(step, log_tag=log_tag, defaults=defaults, var_names=var_names, ui_map=ui_map)

    if isinstance(step, SubscribeStep):
        # `<hook>.subscribeEvent(<event>, () => console.log(<log>))`
        return [
            f"  ({step.subscribe})({step.event}, () => "
            f"console.log(`[{log_tag}] {_interp_template(step.log, var_names)}`));"
        ]

    if isinstance(step, WaitForStep):
        # Polling: 200ms tick, ``timeout_ms`` budget. Logs a warning on timeout
        # (mirrors login.ts's waitForLoggedIn behavior) so flows can decide
        # to abort vs press on; we press on by default.
        target = step.wait_for
        return [
            f"  // wait_for {target}",
            f"  {{",
            f"    const _t0 = Date.now();",
            f"    while (Date.now() - _t0 < {step.timeout_ms}) {{",
            f"      if ({target}) break;",
            f"      await new Promise((r) => setTimeout(r, 200));",
            f"    }}",
            f"    if (!({target})) {{",
            f'      console.warn(`[{log_tag}] wait_for timeout: {target}`);',
            f"    }}",
            f"  }}",
        ]

    raise TypeError(f"flow_codegen: unhandled step type {type(step).__name__}")


def _render_call(
    step: CallStep, *, log_tag: str, defaults: AutoRunDefaults, var_names: set[str],
    ui_map: dict[str, UIInteraction] | None = None,
) -> list[str]:
    method_label = step.call.split(".", 1)[1] if "." in step.call else step.call
    log_text = step.log or method_label
    timeout_ms = step.timeout_ms if step.timeout_ms is not None else defaults.timeout_ms
    on_error = step.on_error or defaults.on_error
    args_src = _format_args(step.args, var_names)

    # Check if this call step has a matching UI interaction defined.
    # UI action matching uses the step's ``ui_action`` hint (if set), or falls
    # back to matching the method label against the ui_map keys.
    ui_action = step.ui_action if hasattr(step, "ui_action") and step.ui_action else None
    ui: UIInteraction | None = None
    if ui_map and not ui_action:
        # Heuristic: try to match method_label against ui_map keys
        for action_key, ui_def in ui_map.items():
            action_norm = action_key.replace("-", "").lower()
            label_norm = method_label.lower()
            if action_norm in label_norm or label_norm in action_norm:
                ui = ui_def
                ui_action = action_key
                break
    elif ui_map and ui_action:
        ui = ui_map.get(ui_action)

    # If a UI interaction is matched, wrap the call with tryClickUI
    if ui:
        keywords_json = json.dumps(ui.keywords, ensure_ascii=False)
        lines: list[str] = [
            f"  console.log(`[{log_tag}] {_interp_template(log_text, var_names)}`);",
            f"  await tryClickUI(",
            f"    {json.dumps(ui.action)},",
            f"    {keywords_json},",
            f"    {json.dumps(ui.element)},",
            f"    async () => {{",
        ]
        # Fallback body: the original API call
        if on_error == "abort":
            lines.append(f"      try {{")
            lines.append(
                f"        await withTimeout({step.call}({args_src}), {timeout_ms}, "
                f'"{method_label}");'
            )
            lines.append("      } catch (e) {")
            lines.append(
                f'        console.error(`[{log_tag}] {method_label} failed: '
                f"${{(e as Error).message}}`);",
            )
            lines.append("        throw e;")
            lines.append("      }")
        elif on_error == "throw":
            lines.append(
                f"      await withTimeout({step.call}({args_src}), {timeout_ms}, "
                f'"{method_label}");'
            )
        else:
            lines.append(
                f"      await withTimeout("
                f"{step.call}({args_src}).catch((e: unknown) => "
                f'console.warn(`[{log_tag}] {method_label} rejected: '
                f"${{(e as Error).message}}`)), {timeout_ms}, "
                f'"{method_label}");'
            )
        lines.append(f"    }},")
        lines.append(f"  );")
        return lines

    lines: list[str] = [
        f"  console.log(`[{log_tag}] {_interp_template(log_text, var_names)}`);"
    ]

    # Promise expression: `<call>(...args).catch(...)` so a rejection becomes
    # `undefined`; on_error decides what to do with the caught error.
    if on_error == "abort":
        # Wrap the call so we can return after logging. We deliberately do
        # NOT swallow the rejection here — caller wants to halt the flow,
        # so a try/await/return is clearer than catch+flag.
        lines.append(f"  try {{")
        lines.append(
            f"    await withTimeout({step.call}({args_src}), {timeout_ms}, "
            f'"{method_label}");'
        )
        lines.append("  } catch (e) {")
        lines.append(
            f'    console.error(`[{log_tag}] {method_label} failed: '
            f"${{(e as Error).message}}`);"
        )
        lines.append("    return;")
        lines.append("  }")
        return lines

    if on_error == "throw":
        lines.append(
            f"  await withTimeout({step.call}({args_src}), {timeout_ms}, "
            f'"{method_label}");'
        )
        return lines

    # on_error == "continue" (default): swallow rejections, log a warning,
    # let subsequent steps run. Mirrors the .catch(()=>undefined) pattern in
    # the legacy hand-written flows.
    lines.append(
        f"  await withTimeout("
        f"{step.call}({args_src}).catch((e: unknown) => "
        f'console.warn(`[{log_tag}] {method_label} rejected: '
        f"${{(e as Error).message}}`)), {timeout_ms}, "
        f'"{method_label}");'
    )
    return lines


# ---------------------------------------------------------------------------
# Argument & template-literal interpolation
# ---------------------------------------------------------------------------

# Strings inside DSL args/log/etc. may reference declared vars via ``{{name}}``.
# Replacement strategy:
#
#   - In a log/template string ("createRoom roomId={{roomId}}"):
#     ``{{name}}`` becomes ``${name}`` so the template literal runtime
#     interpolates it. Sanity: name MUST be a declared var; everything else
#     stays literal.
#
#   - In a JSON-style arg value ({ "roomId": "{{roomId}}" }):
#     We post-process the JSON string to drop the surrounding quotes around
#     a sole-occupant ``"{{roomId}}"``. The result is the bareword ``roomId``,
#     which is a valid JS object-literal value that the TS compiler resolves
#     to the ``const`` we emitted earlier.

import re

_VAR_RE = re.compile(r"\{\{([A-Za-z_]\w*)\}\}")


def _interp_template(text: str, var_names: set[str]) -> str:
    """Replace ``{{name}}`` with ``${name}`` for use inside backtick strings."""
    def sub(m: re.Match[str]) -> str:
        name = m.group(1)
        if name not in var_names:
            raise ValueError(
                f"flow_codegen: template references unknown var '{name}' "
                f"(declared: {sorted(var_names)})"
            )
        return f"${{{name}}}"
    return _VAR_RE.sub(sub, text)


# Sentinel that JSON.dumps will emit as a unique string we can later
# substring-replace to a bareword. Using a non-identifier prefix and suffix
# means it can't accidentally collide with anything inside legitimate strings.
_VAR_SENTINEL_PREFIX = "@@VAR@@"
_VAR_SENTINEL_SUFFIX = "@@/VAR@@"


def _format_args(args: list[Any], var_names: set[str]) -> str:
    r"""Render ``args`` as a comma-separated list of JS expressions.

    Each arg is JSON-dumped, then any ``"{{name}}"`` (a string literal that
    is *exactly* one var reference) is rewritten to the bareword ``name``,
    referencing the local ``const`` declared earlier. Strings containing
    additional content alongside ``{{name}}`` (e.g. ``"prefix-{{id}}"``) are
    rewritten to a template literal ``\`prefix-${id}\``.
    """
    if not args:
        return ""

    rendered: list[str] = []
    for arg in args:
        rendered.append(_format_one_arg(arg, var_names))
    return ", ".join(rendered)


def _format_one_arg(arg: Any, var_names: set[str]) -> str:
    if isinstance(arg, str):
        return _string_arg_to_js(arg, var_names)
    if isinstance(arg, (dict, list)):
        return _container_arg_to_js(arg, var_names)
    # Numbers / bools / None — JSON.dumps produces valid JS literals
    # (true/false/null) for all of these.
    return json.dumps(arg)


def _string_arg_to_js(s: str, var_names: set[str]) -> str:
    """A standalone string arg may be a pure var reference, a template, or
    a literal."""
    m = _VAR_RE.fullmatch(s)
    if m:
        name = m.group(1)
        if name not in var_names:
            raise ValueError(f"flow_codegen: arg references unknown var '{name}'")
        return name  # bareword — references the const
    if _VAR_RE.search(s):
        # Mixed literal + var: emit as a template literal.
        return "`" + _interp_template(s, var_names) + "`"
    return json.dumps(s)


def _container_arg_to_js(container: Any, var_names: set[str]) -> str:
    """Render dict/list (recursively) by JSON-dumping with sentinel placeholders
    and post-processing them into TS expressions."""
    encoded = json.dumps(_substitute_sentinels(container, var_names), ensure_ascii=False)

    # 1) Pure-var occupant: "@@VAR@@name@@/VAR@@" → name (drop surrounding quotes).
    encoded = re.sub(
        rf'"{re.escape(_VAR_SENTINEL_PREFIX)}([A-Za-z_]\w*){re.escape(_VAR_SENTINEL_SUFFIX)}"',
        r"\1",
        encoded,
    )

    # 2) Template-literal occupant: a sentinel still embedded inside a larger
    #    string. We re-escape the surrounding quotes into backticks. Doing this
    #    correctly for arbitrary strings (with embedded quotes) is fiddly, so
    #    we forbid it for now and surface a clear error instead.
    if _VAR_SENTINEL_PREFIX in encoded:
        raise ValueError(
            "flow_codegen: mixed literal+{{var}} inside a nested arg is not "
            "supported. Hoist the value into vars: instead."
        )
    return encoded


def _substitute_sentinels(node: Any, var_names: set[str]) -> Any:
    """Walk a JSON-able tree, replacing ``{{name}}`` strings with sentinel
    markers that survive json.dumps() unchanged."""
    if isinstance(node, str):
        m = _VAR_RE.fullmatch(node)
        if m:
            name = m.group(1)
            if name not in var_names:
                raise ValueError(f"flow_codegen: arg references unknown var '{name}'")
            return f"{_VAR_SENTINEL_PREFIX}{name}{_VAR_SENTINEL_SUFFIX}"
        # If the string contains var references mixed with literal text, leave
        # the marker for _container_arg_to_js to reject — keeping the failure
        # mode loud rather than silently emitting a half-broken template.
        return node
    if isinstance(node, dict):
        return {k: _substitute_sentinels(v, var_names) for k, v in node.items()}
    if isinstance(node, list):
        return [_substitute_sentinels(v, var_names) for v in node]
    return node


__all__ = ["generate"]
