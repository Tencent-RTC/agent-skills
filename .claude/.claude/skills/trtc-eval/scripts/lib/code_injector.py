"""Code injector — overwrites placeholder files in workspace with AI-generated code.

Responsibilities:
1. Auto-register injection points not yet declared in INJECTION.json (template only ships one example).
2. Copy AI-generated code files into workspace at declared targets.
3. **Entry Bridge Generation** (三端统一): After injection, scan injected files for entry-point
   classes/functions and auto-generate platform-specific bridge code so the App loads the injected
   code on startup.
   - iOS: detect UIViewController subclass → overwrite SceneDelegate.swift
   - Android: detect Activity subclass or @Composable entry → overwrite MainActivity.kt
   - Web: detect exported entry (default export / named export) → patch main.ts to import & mount
   (Rule: "Injected code must be reachable from the application entry point.")
4. **Default routing (web-only, v1)**: When ``demo_injection_map`` does not cover some files in
   ``ai_extracted_code/``, call ``scripts.lib.file_naming.resolve_ai_filenames`` to assign logical
   names based on header-comment hints, relative-import reverse-inference, and framework default
   entry convention. Unroutable non-code blocks (.xml/.plist/.json/...) are parked in
   ``case_dir/ai_unrouted/`` so they remain auditable without polluting workspace.
5. **Filepath extraction (v2 — optimizer)**: AI code blocks may declare their
   intended destination via ``<!-- filepath: src/views/Foo.vue -->`` (for
   .vue files) or ``// filepath: src/composables/bar.ts`` (for .ts/.js).
   When present these take highest priority, above ``demo_injection_map`` and
   content-feature detection. This is part of the "remove technical barriers"
   initiative so non-engineers can write test cases without knowing template
   project structure.
"""
import json
import re
import shutil
import subprocess
from pathlib import Path

from scripts.lib.file_naming import resolve_ai_filenames


class InjectError(Exception):
    pass


# ---------------------------------------------------------------------------
# Filepath extraction from AI code (v2 — optimizer)
# ---------------------------------------------------------------------------
# Regexes to extract `filepath` declarations from the first few lines of a
# code block. Both HTML-comment and line-comment styles are supported so the
# convention works across .vue, .ts, .js, .swift, .kt, etc.
#
# Examples matched:
#   <!-- filepath: src/views/ConferenceRoom.vue -->
#   // filepath: src/composables/useConference.ts
#   # filepath: scripts/helper.py

_FILEPATH_HTML_RE = re.compile(
    r"<!--\s*filepath:\s*(.+?)\s*-->", re.IGNORECASE
)
_FILEPATH_LINE_RE = re.compile(
    r"^(?://|#)\s*filepath:\s*(.+?)\s*$", re.MULTILINE | re.IGNORECASE
)


def _extract_filepath_declaration(content: str) -> str | None:
    """Extract a filepath declaration from the first ~5 lines of AI output.

    Returns the declared path (relative to ``src/``) or ``None`` if no
    declaration is found.  Paths starting with ``src/`` are used as-is;
    otherwise ``src/`` is prepended to keep files inside the Vite source tree.
    """
    # Only scan the first ~500 chars to avoid matching comments deep in the file
    head = content[:500]
    m = _FILEPATH_HTML_RE.search(head) or _FILEPATH_LINE_RE.search(head)
    if not m:
        return None
    raw_path = m.group(1).strip()
    if not raw_path:
        return None
    # Normalise: ensure path starts with src/ for Vite compatibility
    if not raw_path.startswith("src/"):
        raw_path = f"src/{raw_path}"
    return raw_path


def _filepath_injection_map(
    ai_code_dir: Path,
    platform: str,
) -> dict[str, dict]:
    """Build an injection map from filepath declarations in AI code files.

    Scans each file in ``ai_code_dir`` for a ``filepath:`` declaration.  Files
    that declare a path are returned as ``{filename: {target_file, replace_mode}}``.
    Files WITHOUT declarations are omitted — they will be handled by the
    existing ``_default_injection_map`` or ``demo_injection_map`` fallback.
    """
    result: dict[str, dict] = {}
    if not ai_code_dir.is_dir():
        return result
    for f in sorted(ai_code_dir.iterdir()):
        if not f.is_file():
            continue
        content = f.read_text(errors="replace")
        declared = _extract_filepath_declaration(content)
        if declared:
            result[f.name] = {
                "target_file": declared,
                "replace_mode": "overwrite",
            }
    return result


def _load_injection_config(workspace: Path) -> dict:
    """Load INJECTION.json from workspace."""
    return json.loads((workspace / "INJECTION.json").read_text())


def _allowed_targets(cfg: dict) -> set[str]:
    return {p["path"] for p in cfg["injection_points"]}


def _ensure_injection_points(workspace: Path, injection_map: dict) -> None:
    """Auto-register injection targets from case's demo_injection_map into INJECTION.json.

    The template project only ships a single example injection point (GeneratedView.swift).
    The eval tool is responsible for supplementing additional injection points declared by
    each test case's demo_injection_map before performing the actual code injection.
    """
    cfg = _load_injection_config(workspace)
    existing_paths = {p["path"] for p in cfg["injection_points"]}

    modified = False
    for ai_file, point in injection_map.items():
        target_rel = point.target_file if hasattr(point, "target_file") else point.get("target_file", "")
        if not target_rel:
            continue
        if target_rel not in existing_paths:
            # Derive a human-readable name from the filename
            name = Path(target_rel).name
            replace_mode = (
                point.replace_mode if hasattr(point, "replace_mode")
                else point.get("replace_mode", "overwrite")
            )
            cfg["injection_points"].append({
                "name": name,
                "path": target_rel,
                "placeholder": True,
                "replace_mode": replace_mode,
            })
            existing_paths.add(target_rel)
            modified = True

    if modified:
        (workspace / "INJECTION.json").write_text(
            json.dumps(cfg, indent=2, ensure_ascii=False) + "\n"
        )


# ---------------------------------------------------------------------------
# Entry Bridge: ensure injected code is loaded at app startup (三端统一)
# ---------------------------------------------------------------------------

# --- iOS ---
# Matches: class Foo: UIViewController, final class Bar : UIViewController, etc.
_IOS_VC_CLASS_RE = re.compile(
    r"(?:final\s+)?class\s+(\w+)\s*:\s*(?:\w+,\s*)*UIViewController"
)

# Matches custom init (not required init?(coder:)) to extract parameter list.
# Examples:
#   init(liveID: String, liveName: String) {
#   init(roomID: String) {
#   convenience init(config: Config = .default) {
_IOS_CUSTOM_INIT_RE = re.compile(
    r"(?:convenience\s+)?init\s*\(([^)]*)\)\s*\{",
    re.MULTILINE,
)

# Default value generators for common Swift types
_SWIFT_TYPE_DEFAULTS: dict[str, str] = {
    "String": '""',
    "Int": "0",
    "UInt": "0",
    "Double": "0.0",
    "Float": "0.0",
    "Bool": "false",
    "CGFloat": "0.0",
    "CGRect": ".zero",
    "CGSize": ".zero",
    "CGPoint": ".zero",
}


def _parse_swift_init_params(param_str: str) -> list[tuple[str, str, str | None]]:
    """Parse Swift init parameter string into list of (label, type, default_or_None).

    Examples:
        "liveID: String, liveName: String" -> [("liveID", "String", None), ("liveName", "String", None)]
        "_ id: String, name: String = \"\"" -> [("_", "String", "\"\""), ("name", "String", "\"\"")]
    """
    params = []
    if not param_str.strip():
        return params

    # Split by comma, but respect nested generics/closures
    depth = 0
    current = []
    for ch in param_str:
        if ch in "(<[":
            depth += 1
            current.append(ch)
        elif ch in ")>]":
            depth -= 1
            current.append(ch)
        elif ch == "," and depth == 0:
            params.append("".join(current).strip())
            current = []
        else:
            current.append(ch)
    if current:
        params.append("".join(current).strip())

    result = []
    for p in params:
        # Strip attributes like @escaping, @autoclosure
        p = re.sub(r"@\w+\s*", "", p).strip()
        # Check for default value
        default_val = None
        if "=" in p:
            parts = p.split("=", 1)
            p = parts[0].strip()
            default_val = parts[1].strip()
        # Parse "label: Type" or "_ label: Type" or "externalLabel internalLabel: Type"
        colon_idx = p.find(":")
        if colon_idx == -1:
            continue
        label_part = p[:colon_idx].strip()
        type_part = p[colon_idx + 1:].strip()
        # Handle "external internal" or just "label"
        label_tokens = label_part.split()
        if len(label_tokens) >= 2:
            external_label = label_tokens[0]  # _ or named
        else:
            external_label = label_tokens[0]
        result.append((external_label, type_part, default_val))
    return result


def _generate_init_call(class_name: str, params: list[tuple[str, str, str | None]]) -> str:
    """Generate a Swift initializer call with default values for parameters without defaults.

    Returns e.g.: 'AnchorLiveViewController(liveID: "", liveName: "")'
    """
    if not params:
        return f"{class_name}()"

    args = []
    for label, type_name, default_val in params:
        if default_val is not None:
            # Has default value, can omit
            continue
        # Generate a sensible default based on type
        # Strip optionals
        base_type = type_name.rstrip("?").strip()
        if type_name.endswith("?"):
            val = "nil"
        elif base_type in _SWIFT_TYPE_DEFAULTS:
            val = _SWIFT_TYPE_DEFAULTS[base_type]
        else:
            # Unknown type: try nil if optional, otherwise use .init() or empty string
            val = '""'  # Safest fallback for demo purposes

        if label == "_":
            args.append(val)
        else:
            args.append(f"{label}: {val}")

    if not args:
        return f"{class_name}()"
    return f"{class_name}({', '.join(args)})"

# --- Android ---
# Matches: class Foo : ComponentActivity, class Bar : AppCompatActivity, class Baz : FragmentActivity
_ANDROID_ACTIVITY_RE = re.compile(
    r"(?:abstract\s+)?class\s+(\w+)\s*(?:\(.*?\))?\s*:\s*(?:\w+,\s*)*"
    r"(?:ComponentActivity|AppCompatActivity|FragmentActivity|Activity)"
)
# Matches: class Foo : Fragment (for Fragment-based injection)
_ANDROID_FRAGMENT_RE = re.compile(
    r"(?:abstract\s+)?class\s+(\w+)\s*(?:\(.*?\))?\s*:\s*(?:\w+,\s*)*Fragment\b"
)

# --- Web ---
# Matches: export default function xxx, export default class xxx, export default { ... }
_WEB_DEFAULT_EXPORT_RE = re.compile(
    r"export\s+default\s+(?:(?:function|class)\s+(\w+)|(\{))"
)
# Matches: export function mount/render/init/bootstrap/setup/start/run/main
_WEB_NAMED_ENTRY_RE = re.compile(
    r"export\s+(?:async\s+)?function\s+(mount|render|init|bootstrap|setup|start|run|main)\b"
)
# Matches: export class XxxView / XxxApp / XxxComponent
_WEB_CLASS_EXPORT_RE = re.compile(
    r"export\s+class\s+(\w+(?:View|App|Component|Page|Panel))"
)


# ---------------------------------------------------------------------------
# iOS Entry Bridge
# ---------------------------------------------------------------------------

def _extract_entry_viewcontroller(injected_files: list[Path]) -> tuple[str, str] | None:
    """Scan injected Swift files and return the VC class name + init call expression.

    Returns:
        ("ClassName", "ClassName(param: defaultVal, ...)") or None.
        If the VC has a parameterless init, returns ("ClassName", "ClassName()").
    """
    for f in injected_files:
        if f.suffix != ".swift":
            continue
        content = f.read_text(errors="replace")
        m = _IOS_VC_CLASS_RE.search(content)
        if m:
            class_name = m.group(1)
            # Find all non-required inits in this class
            # We want to detect if there's a parameterless init or if all inits need params
            has_parameterless_init = False
            custom_init_params: list[tuple[str, str, str | None]] | None = None

            for init_match in _IOS_CUSTOM_INIT_RE.finditer(content):
                param_str = init_match.group(1).strip()
                # Skip required init?(coder:)
                if "coder" in param_str and "NSCoder" in param_str:
                    continue
                if not param_str:
                    has_parameterless_init = True
                    break
                # Parse params; if all have defaults, it's effectively parameterless
                params = _parse_swift_init_params(param_str)
                all_have_defaults = all(p[2] is not None for p in params)
                if all_have_defaults:
                    has_parameterless_init = True
                    break
                if custom_init_params is None:
                    # Use the first custom init found
                    custom_init_params = params

            if has_parameterless_init or custom_init_params is None:
                return (class_name, f"{class_name}()")
            else:
                init_call = _generate_init_call(class_name, custom_init_params)
                return (class_name, init_call)
    return None


def _generate_entry_bridge_ios(workspace: Path, _entry_vc_class: str, init_call: str) -> None:
    """Overwrite SceneDelegate.swift to set the injected VC as rootViewController.

    When EVAL_AUTO_RUN_FLOW is set at runtime, delegates to AutoRunCoordinator instead
    of showing the injected VC directly — this enables automated evaluation flows.
    """
    scene_delegate_path = workspace / "MyApplication" / "SceneDelegate.swift"
    if not scene_delegate_path.exists():
        return

    bridge_code = f'''\
//
//  SceneDelegate.swift
//  MyApplication
//
//  Auto-generated by eval tool: entry bridge for injected view.
//

import UIKit
import os.log

private let evalLog = OSLog(subsystem: "com.template.myapplication", category: "eval")

class SceneDelegate: UIResponder, UIWindowSceneDelegate {{

    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {{
        guard let windowScene = (scene as? UIWindowScene) else {{ return }}
        let window = UIWindow(windowScene: windowScene)

        // If EVAL_AUTO_RUN_FLOW is set, use AutoRunCoordinator for automated evaluation
        if let autoRunFlow = ProcessInfo.processInfo.environment["EVAL_AUTO_RUN_FLOW"],
           !autoRunFlow.isEmpty {{
            os_log("Entry bridge: EVAL_AUTO_RUN_FLOW=%{{public}}@, delegating to AutoRunCoordinator", log: evalLog, type: .info, autoRunFlow)
            let rootVC = {init_call}
            window.rootViewController = rootVC
            window.makeKeyAndVisible()
            self.window = window
            // Trigger AutoRun after window is visible
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {{
                AutoRunCoordinator.runIfNeeded {{ _ in }}
            }}
        }} else {{
            window.rootViewController = {init_call}
            window.makeKeyAndVisible()
            self.window = window
        }}
    }}

    func sceneDidDisconnect(_ scene: UIScene) {{}}
    func sceneDidBecomeActive(_ scene: UIScene) {{}}
    func sceneWillResignActive(_ scene: UIScene) {{}}
    func sceneWillEnterForeground(_ scene: UIScene) {{}}
    func sceneDidEnterBackground(_ scene: UIScene) {{}}
}}
'''
    scene_delegate_path.write_text(bridge_code)


# ---------------------------------------------------------------------------
# Android Entry Bridge
# ---------------------------------------------------------------------------

def _extract_entry_android(injected_files: list[Path]) -> tuple[str, str] | None:
    """Scan injected Kotlin files for Activity or Fragment subclass.

    Returns:
        ("activity", "ClassName") or ("fragment", "ClassName") or None.
    """
    for f in injected_files:
        if f.suffix != ".kt":
            continue
        content = f.read_text(errors="replace")
        # Prefer Activity match (it can be launched directly)
        m = _ANDROID_ACTIVITY_RE.search(content)
        if m:
            return ("activity", m.group(1))
    # Second pass: look for Fragment
    for f in injected_files:
        if f.suffix != ".kt":
            continue
        content = f.read_text(errors="replace")
        m = _ANDROID_FRAGMENT_RE.search(content)
        if m:
            return ("fragment", m.group(1))
    return None


def _detect_android_package(injected_files: list[Path]) -> str:
    """Extract the package declaration from the first injected .kt file."""
    for f in injected_files:
        if f.suffix != ".kt":
            continue
        content = f.read_text(errors="replace")
        m = re.search(r"^package\s+([\w.]+)", content, re.MULTILINE)
        if m:
            return m.group(1)
    return "com.template.myapplication.generated"


def _generate_entry_bridge_android(workspace: Path, entry_type: str, entry_class: str, entry_package: str) -> None:
    """Overwrite MainActivity.kt to launch the injected Activity or load the injected Fragment."""
    main_activity_path = workspace / "app" / "src" / "main" / "java" / "com" / "template" / "myapplication" / "MainActivity.kt"
    if not main_activity_path.exists():
        return

    if entry_type == "activity":
        bridge_code = f'''\
package com.template.myapplication

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import {entry_package}.{entry_class}

/**
 * Auto-generated by eval tool: entry bridge for injected Activity.
 * Launches [{entry_class}] immediately on startup.
 */
class MainActivity : ComponentActivity() {{
    override fun onCreate(savedInstanceState: Bundle?) {{
        super.onCreate(savedInstanceState)
        // Entry Bridge: launch the injected Activity
        startActivity(Intent(this, {entry_class}::class.java))
        finish()
    }}
}}
'''
    else:
        # Fragment-based: embed in a FrameLayout
        bridge_code = f'''\
package com.template.myapplication

import android.os.Bundle
import androidx.activity.ComponentActivity
import {entry_package}.{entry_class}

/**
 * Auto-generated by eval tool: entry bridge for injected Fragment.
 * Loads [{entry_class}] as the main content.
 */
class MainActivity : ComponentActivity() {{
    override fun onCreate(savedInstanceState: Bundle?) {{
        super.onCreate(savedInstanceState)
        setContentView(android.R.layout.activity_list_item)
        if (savedInstanceState == null) {{
            supportFragmentManager.beginTransaction()
                .replace(android.R.id.content, {entry_class}())
                .commit()
        }}
    }}
}}
'''
    main_activity_path.write_text(bridge_code)


# ---------------------------------------------------------------------------
# Web Entry Bridge
# ---------------------------------------------------------------------------

def _extract_entry_web(injected_files: list[Path]) -> tuple[str, str, Path] | None:
    """Scan injected TS/JS files for an exportable entry point.

    Returns:
        ("default", name_or_empty, file_path) — has a default export
        ("named", function_name, file_path) — has a named entry function (mount/render/init/etc.)
        ("class", class_name, file_path) — has an exported class with View/App/Component suffix
        None — no recognizable entry found.
    """
    for f in injected_files:
        if f.suffix not in (".ts", ".tsx", ".js", ".jsx", ".mjs"):
            continue
        content = f.read_text(errors="replace")

        # Check for default export
        m = _WEB_DEFAULT_EXPORT_RE.search(content)
        if m:
            name = m.group(1) or ""
            return ("default", name, f)

        # Check for named entry functions
        m = _WEB_NAMED_ENTRY_RE.search(content)
        if m:
            return ("named", m.group(1), f)

        # Check for exported class
        m = _WEB_CLASS_EXPORT_RE.search(content)
        if m:
            return ("class", m.group(1), f)

    return None


def _compute_web_import_path(workspace: Path, target_file: Path) -> str:
    """Compute the relative import path from src/main.ts to the injected file.

    E.g., if target is at workspace/src/generated/anchorView.ts,
    returns "./generated/anchorView" (without extension).
    """
    src_dir = workspace / "src"
    try:
        rel = target_file.relative_to(src_dir)
    except ValueError:
        # Fallback: relative to workspace
        rel = target_file.relative_to(workspace)
    # Remove extension for import
    import_path = "./" + str(rel.with_suffix("")).replace("\\", "/")
    return import_path


def _generate_entry_bridge_web(workspace: Path, entry_type: str, entry_name: str, entry_file: Path) -> None:
    """Patch main.ts to import and mount the injected module in non-auto-run mode."""
    main_ts_path = workspace / "src" / "main.ts"
    if not main_ts_path.exists():
        return

    import_path = _compute_web_import_path(workspace, entry_file)

    if entry_type == "default":
        # Default export: import and call it (assume it's a function or class with mount/render)
        mount_logic = f'''\
    // Entry Bridge: load injected module (default export)
    const mod = await import("{import_path}");
    const entry = mod.default;
    if (typeof entry === "function") {{
      // Could be a class or a function — try calling it
      const result = entry(root);
      if (result && typeof result.then === "function") await result;
    }}'''
    elif entry_type == "named":
        # Named entry function (mount/render/init/etc.)
        mount_logic = f'''\
    // Entry Bridge: load injected module (named export: {entry_name})
    const mod = await import("{import_path}");
    if (typeof mod.{entry_name} === "function") {{
      const result = mod.{entry_name}(root);
      if (result && typeof result.then === "function") await result;
    }}'''
    else:
        # Class export (e.g., AnchorView)
        mount_logic = f'''\
    // Entry Bridge: load injected module (class export: {entry_name})
    const mod = await import("{import_path}");
    const instance = new mod.{entry_name}(root);
    if (typeof instance.mount === "function") {{
      const result = instance.mount();
      if (result && typeof result.then === "function") await result;
    }} else if (typeof instance.render === "function") {{
      const result = instance.render();
      if (result && typeof result.then === "function") await result;
    }}'''

    bridge_code = f'''\
import {{ loadEnv }} from "./env";
import {{ runAutoFlow }} from "./autorun/autoRunCoordinator";

async function bootstrap(): Promise<void> {{
  const env = loadEnv();

  // Expose env globally for injected code to use
  (globalThis as unknown as {{ __trtcEnv: typeof env }}).__trtcEnv = env;

  if (env.autoRunFlow) {{
    await runAutoFlow(env.autoRunFlow);
    return;
  }}

  // Entry Bridge mode: load and mount injected module
  const root = document.getElementById("app");
  if (root) {{
{mount_logic}
  }}
}}

bootstrap().catch((err) => {{
  console.error("[MyApplication] bootstrap failed:", err);
}});
'''
    main_ts_path.write_text(bridge_code)


# ---------------------------------------------------------------------------
# Platform dispatcher
# ---------------------------------------------------------------------------

def _apply_entry_bridge(
    workspace: Path,
    injected_dst_files: list[Path],
    platform: str,
    framework: str | None = None,
) -> None:
    """Apply entry bridge generation based on platform.

    Rule: "Injected code must be reachable from the application entry point."

    Supports: ios, android, web.

    For web, the behavior splits:
      - framework="vanilla" (or None): keep the legacy behavior of rewriting
        src/main.ts to import and invoke the injected module. Back-compat for
        any case that does not opt into a framework profile.
      - framework in {vue3, vue2, react}: the profile's main.ts is authoritative
        and imports a fixed entry filename. Just assert the entry exists.
    """
    if platform == "ios":
        result = _extract_entry_viewcontroller(injected_dst_files)
        if result:
            entry_vc_class, init_call = result
            _generate_entry_bridge_ios(workspace, entry_vc_class, init_call)

    elif platform == "android":
        result = _extract_entry_android(injected_dst_files)
        if result:
            entry_type, entry_class = result
            entry_package = _detect_android_package(injected_dst_files)
            _generate_entry_bridge_android(workspace, entry_type, entry_class, entry_package)

    elif platform == "web":
        fw = framework or "vanilla"
        if fw == "vanilla":
            result = _extract_entry_web(injected_dst_files)
            if result:
                entry_type, entry_name, entry_file = result
                _generate_entry_bridge_web(workspace, entry_type, entry_name, entry_file)
        else:
            _assert_web_entry_present(workspace, fw, injected_dst_files)


# ---------------------------------------------------------------------------
# Default routing helpers (v1: web-only)
# ---------------------------------------------------------------------------

def _default_injection_map(
    ai_code_dir: Path,
    platform: str,
    framework: str | None,
) -> dict[str, dict]:
    """Build a best-effort injection_map for files not covered by cases.json.

    Web: every resolved "code" file lands in ``src/generated/<logical_name>``.
    Other platforms: v1 does not emit a default map (existing explicit maps
    continue to work unchanged).
    """
    if platform != "web":
        return {}
    resolved = resolve_ai_filenames(ai_code_dir, platform, framework)
    out: dict[str, dict] = {}
    for original, rn in resolved.items():
        if rn.kind != "code":
            continue
        out[original] = {
            "target_file": f"src/generated/{rn.logical_name}",
            "replace_mode": "overwrite",
        }
    return out


def _park_unrouted_files(
    ai_code_dir: Path,
    case_dir: Path,
    platform: str,
    framework: str | None,
) -> list[str]:
    """Copy config/unknown-kind AI blocks to ``case_dir/ai_unrouted/`` so they
    remain auditable without polluting the demo workspace. Returns the list of
    original filenames that were parked.
    """
    resolved = resolve_ai_filenames(ai_code_dir, platform, framework)
    parked: list[str] = []
    dst_dir = case_dir / "ai_unrouted"
    for original, rn in resolved.items():
        if rn.kind == "code":
            continue
        src = ai_code_dir / original
        if not src.exists():
            continue
        dst_dir.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(src, dst_dir / original)
        parked.append(original)
    return parked


def _to_pascal_case(filename_stem: str) -> str:
    """Convert a filename stem to PascalCase for Vue component names.

    Examples: 'ConferenceRoom' -> 'ConferenceRoom',
              'conference-room' -> 'ConferenceRoom',
              'my_component' -> 'MyComponent'
    """
    # If no separators, assume already PascalCase or single word
    if "-" not in filename_stem and "_" not in filename_stem:
        return filename_stem[0].upper() + filename_stem[1:] if filename_stem else ""
    # Split on hyphens and underscores
    parts = re.split(r"[-_]", filename_stem)
    return "".join(p.capitalize() for p in parts if p)


def _assert_web_entry_present(
    workspace: Path,
    framework: str,
    injected_dst_files: list[Path],
) -> None:
    """For profile-based web runs, verify the profile's expected entry file
    actually exists in ``src/generated/``. If the default-routed files do
    not include one (common when AI only returns composables / helpers),
    synthesize a minimal skeleton that imports them — this keeps the demo
    compilable and lets the injected code be evaluated for runtime signals.

    For Vue3 frameworks, ``.vue`` files injected anywhere under ``src/`` are
    imported as named components and mounted in the ``<template>`` so the
    AI-generated UI is actually rendered in the DOM (not just side-effect
    imported).
    """
    expected = {
        "vue3": "src/generated/App.vue",
        "vue2": "src/generated/App.vue",
        "react": "src/generated/App.tsx",
        "vanilla": "src/generated/index.ts",
    }.get(framework)
    if not expected:
        return
    entry_path = workspace / expected
    if entry_path.exists():
        return

    # Collect sibling files in src/generated/ (side-effect imports for .ts/.js)
    generated_dir = workspace / "src" / "generated"
    sibling_imports: list[str] = []
    if generated_dir.is_dir():
        for f in sorted(generated_dir.iterdir()):
            if f.name == entry_path.name:
                continue
            if f.suffix.lower() in (".ts", ".tsx", ".js", ".jsx", ".mjs", ".vue"):
                # Strip extensions Vite resolves automatically to keep imports clean
                stem = f.stem if f.suffix != ".vue" else f.name
                sibling_imports.append(stem)

    # Collect .vue components from ALL injected files (not just src/generated/).
    # These need to be imported as named components and mounted in <template>.
    vue_components: list[tuple[str, str]] = []  # (component_name, import_path)
    src_dir = workspace / "src"
    if framework in ("vue3", "vue2"):
        for dst in injected_dst_files:
            if dst.suffix.lower() != ".vue":
                continue
            # Skip the entry file itself
            try:
                rel_to_workspace = dst.relative_to(workspace)
            except ValueError:
                continue
            if str(rel_to_workspace) == expected:
                continue
            # Skip files already in src/generated/ (handled as sibling_imports)
            try:
                dst.relative_to(generated_dir)
                continue  # Already covered by sibling_imports scan
            except ValueError:
                pass
            # Compute import path relative to src/generated/ (where App.vue lives)
            try:
                rel_to_src = dst.relative_to(src_dir)
            except ValueError:
                continue
            import_path = "../" + str(rel_to_src).replace("\\", "/")
            component_name = _to_pascal_case(dst.stem)
            vue_components.append((component_name, import_path))

    if not sibling_imports and not vue_components:
        # Nothing to wire up — fail loudly rather than generate a blank shell.
        raise InjectError(
            f"web framework '{framework}' profile expects {expected} but no "
            f"injected code was produced. AI output may have been empty or "
            f"fully non-code. Injected files: "
            f"{[str(p.relative_to(workspace)) for p in injected_dst_files]}"
        )

    entry_path.parent.mkdir(parents=True, exist_ok=True)
    if framework in ("vue3", "vue2"):
        # Build imports: named imports for .vue components, side-effect for .ts/.js
        import_lines: list[str] = []
        for comp_name, imp_path in vue_components:
            import_lines.append(f'import {comp_name} from "{imp_path}";')
        for name in sibling_imports:
            import_lines.append(f'import "./{name}";')
        imports = "\n".join(import_lines)

        # Build template: mount Vue components, show skeleton text as fallback
        if vue_components:
            component_tags = "\n".join(
                f"    <{comp_name} />" for comp_name, _ in vue_components
            )
            all_names = [c[0] for c in vue_components] + sibling_imports
            skel = (
                f"<!-- auto-generated skeleton with mounted components -->\n"
                f"<script setup lang=\"ts\">\n"
                f"{imports}\n"
                f"</script>\n"
                f"<template>\n"
                f"  <div class=\"eval-app\">\n"
                f"    <!-- mounted components: {', '.join(c[0] for c in vue_components)} -->\n"
                f"{component_tags}\n"
                f"  </div>\n"
                f"</template>\n"
            )
        else:
            skel = (
                f"<!-- auto-generated skeleton (no AI-provided entry) -->\n"
                f"<script setup lang=\"ts\">\n"
                f"{imports}\n"
                f"</script>\n"
                f"<template>\n"
                f"  <div class=\"eval-skeleton\">\n"
                f"    <!-- generated shells: {', '.join(sibling_imports)} -->\n"
                f"    MyApplication (eval skeleton)\n"
                f"  </div>\n"
                f"</template>\n"
            )
    elif framework == "react":
        imports = "\n".join(f'import "./{name}";' for name in sibling_imports)
        skel = (
            f"// auto-generated skeleton (no AI-provided entry)\n"
            f"import React from \"react\";\n"
            f"{imports}\n"
            f"export default function App(): React.ReactElement {{\n"
            f"  return React.createElement(\"div\", null, \"MyApplication (eval skeleton)\");\n"
            f"}}\n"
        )
    else:  # vanilla
        imports = "\n".join(f'import "./{name}";' for name in sibling_imports)
        skel = (
            f"// auto-generated skeleton (no AI-provided entry)\n"
            f"{imports}\n"
            f"export function run(): void {{\n"
            f"  console.log(\"[vanilla] eval skeleton loaded siblings:\", "
            f"{sibling_imports!r});\n"
            f"}}\n"
        )
    entry_path.write_text(skel)


# ---------------------------------------------------------------------------
# Main injection logic
# ---------------------------------------------------------------------------

def inject(
    workspace: Path,
    ai_code_dir: Path,
    injection_map: dict,
    platform: str = "ios",
    framework: str | None = None,
    case_dir: Path | None = None,
) -> None:
    """Inject AI-generated code into workspace.

    injection_map: dict mapping ai_filename -> InjectionPoint model or dict
    with target_file. Targets not yet in INJECTION.json are auto-registered.

    **Priority chain** (highest → lowest):

    1. Non-empty ``injection_map`` from cases.json (backward compat)
    2. Filepath declarations in AI code (``<!-- filepath: ... -->`` /
       ``// filepath: ...``) — v2 optimizer
    3. Content-feature detection via ``_default_injection_map`` (web only)
    4. Fallback naming (block_NN → src/generated/)

    For web, any AI files not covered by ``injection_map`` are routed via
    ``_default_injection_map`` (header-comment hints → import reverse-inference
    → framework entry → block_NN fallback). Non-code blocks are parked in
    ``case_dir/ai_unrouted/`` to avoid workspace pollution.

    After injection, an entry bridge is generated to ensure the injected code
    is loaded at application startup (required for dynamic evaluation).
    """
    injection_map = dict(injection_map or {})

    parked: list[str] = []
    if platform == "web":
        # v2 optimizer: filepath declarations take priority over content-
        # feature detection, but are overridden by explicit injection_map
        # entries from cases.json (backward compat).
        filepath_map = _filepath_injection_map(ai_code_dir, platform)
        defaults = _default_injection_map(ai_code_dir, platform, framework)
        # Merge order: defaults < filepath declarations < explicit map
        merged = {**defaults, **filepath_map, **injection_map}
        injection_map = merged
        if case_dir is not None:
            parked = _park_unrouted_files(ai_code_dir, case_dir, platform, framework)

    # Auto-supplement injection points declared by the case or defaults.
    _ensure_injection_points(workspace, injection_map)

    cfg = _load_injection_config(workspace)
    allowed = _allowed_targets(cfg)

    injected_dst_files: list[Path] = []
    for ai_file, point in injection_map.items():
        # Support both InjectionPoint model and raw dict
        target_rel = point.target_file if hasattr(point, "target_file") else point.get("target_file", "")
        if target_rel not in allowed:
            raise InjectError(f"target '{target_rel}' not in INJECTION.json.injection_points")
        src = ai_code_dir / ai_file
        if not src.exists():
            raise InjectError(f"AI did not produce expected file: {ai_file}")
        dst = workspace / target_rel
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(src, dst)
        injected_dst_files.append(dst)

    # Entry Bridge: ensure injected code is loaded at app startup
    _apply_entry_bridge(workspace, injected_dst_files, platform, framework=framework)

    # Audit trail: record what the injector decided + the final diff
    _write_resolved_map(workspace, injection_map, parked, framework)
    _record_diff(workspace, injected_dst_files)


def _write_resolved_map(
    workspace: Path,
    injection_map: dict,
    parked: list[str],
    framework: str | None,
) -> None:
    """Persist the final merged injection_map + parked files to
    ``workspace/.eval-meta/resolved_injection_map.json`` for debugging."""
    meta = workspace / ".eval-meta"
    meta.mkdir(exist_ok=True)
    out_map: dict[str, dict] = {}
    for ai_file, point in injection_map.items():
        target = point.target_file if hasattr(point, "target_file") else point.get("target_file", "")
        mode = (
            point.replace_mode if hasattr(point, "replace_mode")
            else point.get("replace_mode", "overwrite")
        )
        out_map[ai_file] = {"target_file": target, "replace_mode": mode}
    payload = {
        "framework": framework,
        "map": out_map,
        "unrouted": parked,
    }
    (meta / "resolved_injection_map.json").write_text(
        json.dumps(payload, indent=2, ensure_ascii=False) + "\n"
    )


def _record_diff(workspace: Path, injected_dst_files: list[Path] | None = None) -> None:
    """Record which files the injector touched, for Gate D + audit.

    Writes one line per injected file relative to workspace, with size in bytes.
    If git is available inside workspace, we also append the ``git diff --stat``
    output for extra context, but git is NOT required — the injected-file
    listing is the authoritative source.

    Example contents:
        # injected files (3)
        src/generated/App.vue  1843 bytes
        src/generated/auth.ts   612 bytes
        src/generated/block_00.ts  120 bytes
    """
    meta = workspace / ".eval-meta"
    meta.mkdir(exist_ok=True)

    lines: list[str] = []
    files = injected_dst_files or []
    lines.append(f"# injected files ({len(files)})")
    for f in files:
        try:
            rel = f.relative_to(workspace)
        except ValueError:
            rel = f
        size = f.stat().st_size if f.exists() else 0
        lines.append(f"{rel}\t{size} bytes")

    # Best-effort git diff — only emit if it actually returns something useful.
    git_out = subprocess.run(
        ["git", "-C", str(workspace), "diff", "--stat", "."],
        capture_output=True, text=True, check=False,
    )
    if git_out.returncode == 0 and git_out.stdout.strip():
        lines.append("")
        lines.append("# git diff --stat")
        lines.append(git_out.stdout.rstrip())

    (meta / "injection_diff.txt").write_text("\n".join(lines) + "\n")
