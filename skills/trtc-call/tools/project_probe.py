#!/usr/bin/env python3
"""Deterministically inspect a Flutter project before TRTC Call integration."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
from pathlib import Path
from typing import Any


SCHEMA_VERSION = 1
STATE_MANAGEMENT_DEPENDENCIES = {
    "provider": "provider",
    "flutter_riverpod": "riverpod",
    "hooks_riverpod": "riverpod",
    "riverpod": "riverpod",
    "flutter_bloc": "bloc",
    "bloc": "bloc",
    "get": "getx",
    "get_it": "get_it",
    "mobx": "mobx",
    "flutter_mobx": "mobx",
    "redux": "redux",
}
SERVICE_DIRECTORY_NAMES = {
    "api",
    "apis",
    "data",
    "repository",
    "repositories",
    "service",
    "services",
}
CALL_ENTRY_KEYWORDS = {
    "chat": 8,
    "conversation": 8,
    "message": 7,
    "contact": 6,
    "user": 4,
    "profile": 3,
    "home": 2,
}
CALL_ENTRY_EXCLUDES = {
    "auth",
    "login",
    "onboard",
    "register",
    "signin",
    "signup",
    "splash",
}


def _read_text(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError):
        return ""


def _without_comments(text: str) -> str:
    without_blocks = re.sub(r"/\*.*?\*/", "", text, flags=re.DOTALL)
    return re.sub(r"(?m)^\s*//.*$", "", without_blocks)


def _sha256_bytes(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


def _sha256_file(path: Path) -> str:
    return _sha256_bytes(path.read_bytes())


def _canonical_digest(payload: dict[str, Any]) -> str:
    encoded = json.dumps(
        payload,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return _sha256_bytes(encoded)


def _relative(path: Path, root: Path) -> str:
    return path.resolve().relative_to(root.resolve()).as_posix()


def _rel_parts(path: Path, root: Path) -> tuple[str, ...]:
    return path.resolve().relative_to(root.resolve()).parts


def _dart_files(root: Path) -> list[Path]:
    lib = root / "lib"
    if not lib.is_dir():
        return []
    return sorted(
        path
        for path in lib.rglob("*.dart")
        if not any(
            part in {".dart_tool", "build"} for part in _rel_parts(path, root)
        )
    )


def _pubspec_sections(text: str) -> dict[str, list[str]]:
    sections: dict[str, list[str]] = {
        "dependencies": [],
        "dev_dependencies": [],
    }
    current: str | None = None
    for line in text.splitlines():
        if re.fullmatch(r"(dependencies|dev_dependencies):\s*", line):
            current = line.split(":", 1)[0]
            continue
        if current and line and not line.startswith((" ", "\t")):
            current = None
        if current:
            match = re.match(r"^  ([A-Za-z0-9_-]+):", line)
            if match:
                sections[current].append(match.group(1))
    for values in sections.values():
        values.sort()
    return sections


def _package_name(pubspec: str) -> str | None:
    match = re.search(r"(?m)^name:\s*([A-Za-z0-9_-]+)\s*$", pubspec)
    return match.group(1) if match else None


def _constructor_style(class_name: str | None, class_text: str) -> str:
    if not class_name:
        return "unknown"
    declaration = re.search(
        rf"class\s+{re.escape(class_name)}\b[^{{]*{{",
        class_text,
    )
    if not declaration:
        return "unknown"
    constructor_scope = class_text[declaration.end() :]
    build_boundary = re.search(
        r"@override|\bWidget\s+build\s*\(",
        constructor_scope,
    )
    if build_boundary:
        constructor_scope = constructor_scope[: build_boundary.start()]
    match = re.search(
        rf"(?:const\s+)?{re.escape(class_name)}\s*\(([^)]*)\)",
        constructor_scope,
        re.DOTALL,
    )
    if not match:
        return "implicit"
    parameters = match.group(1).strip()
    if not parameters:
        return "empty"
    if "{" in parameters:
        return "named"
    return "positional"


def _extract_app_entry(
    root: Path,
    files: list[Path],
    texts: dict[Path, str],
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    main_candidates = [
        path
        for path in files
        if "trtc_call" not in _rel_parts(path, root)
        and "debug" not in _rel_parts(path, root)
        if re.search(
            r"(?:Future\s*<\s*void\s*>|void)\s+main\s*\(",
            _without_comments(texts[path]),
        )
    ]
    main_file = main_candidates[0] if len(main_candidates) == 1 else None
    main_text = texts.get(main_file, "") if main_file else ""
    run_app_match = re.search(
        r"runApp\s*\(\s*(?:const\s+)?([A-Z][A-Za-z0-9_]*)\s*\(",
        _without_comments(main_text),
    )
    bootstrap_builder_match = re.search(
        r"builder\s*:\s*\([^)]*\)\s*=>\s*([A-Z][A-Za-z0-9_]*)\s*\(",
        _without_comments(main_text),
    )
    class_name = (
        run_app_match.group(1)
        if run_app_match
        else (
            bootstrap_builder_match.group(1)
            if bootstrap_builder_match
            else None
        )
    )

    class_matches: list[tuple[Path, str]] = []
    if class_name:
        class_pattern = re.compile(
            rf"class\s+{re.escape(class_name)}\s+extends\s+"
            r"(StatelessWidget|StatefulWidget)"
        )
        for path in files:
            match = class_pattern.search(texts[path])
            if match:
                class_matches.append((path, match.group(1)))

    class_file = class_matches[0][0] if len(class_matches) == 1 else None
    widget_type = class_matches[0][1] if len(class_matches) == 1 else None
    class_text = texts.get(class_file, "") if class_file else ""

    app_calls: list[str] = []
    class_code = _without_comments(class_text)
    for token in (
        "MaterialApp.router",
        "CupertinoApp.router",
        "MaterialApp",
        "CupertinoApp",
    ):
        pattern = rf"\b{re.escape(token)}\s*\("
        if re.search(pattern, class_code):
            app_calls.append(token)
    variant = app_calls[0] if len(app_calls) == 1 else "unknown"

    go_router_files = sorted(
        path for path in files if re.search(r"\bGoRouter\s*\(", texts[path])
    )
    has_auto_route = any(
        token in "\n".join(_without_comments(text) for text in texts.values())
        for token in ("AutoRouter", "AutoRoute", "RootStackRouter")
    )
    if variant == "MaterialApp.router" and len(go_router_files) == 1:
        app_entry_variant = "material-router-go-router"
    elif variant == "MaterialApp.router":
        app_entry_variant = "unsupported-router"
    elif variant == "CupertinoApp.router":
        app_entry_variant = "unsupported-router"
    elif variant == "MaterialApp":
        app_entry_variant = "material-app"
    elif variant == "CupertinoApp":
        app_entry_variant = "cupertino-app"
    else:
        app_entry_variant = "unknown-app-entry"

    if len(go_router_files) == 1:
        router_scheme = "go-router"
    elif has_auto_route:
        router_scheme = "auto-route"
    elif re.search(r"\broutes\s*:", class_code):
        router_scheme = "navigator-named-routes"
    elif variant.endswith(".router"):
        router_scheme = "custom-router"
    else:
        router_scheme = "navigator"

    named_routes = sorted(
        set(
            re.findall(
                r"['\"](/[^'\"]*)['\"]\s*:",
                class_code,
            )
        )
    )
    login_routes = [
        route
        for route in named_routes
        if any(token in route.lower() for token in ("login", "auth", "signin"))
    ]

    blockers: list[dict[str, Any]] = []
    if len(main_candidates) != 1:
        blockers.append(
            {
                "code": "main-entry-not-unique",
                "message": "无法唯一定位包含 runApp 的 main 入口",
                "paths": [_relative(path, root) for path in main_candidates],
            }
        )
    if not class_name:
        blockers.append(
            {
                "code": "app-class-not-extracted",
                "message": "runApp 没有使用可识别的 App class",
                "paths": [_relative(main_file, root)] if main_file else [],
            }
        )
    if class_name and len(class_matches) != 1:
        blockers.append(
            {
                "code": "app-class-not-unique",
                "message": "无法唯一定位 App class 定义",
                "paths": [_relative(path, root) for path, _ in class_matches],
            }
        )
    constructor_style = _constructor_style(class_name, class_text)
    if constructor_style == "positional":
        blockers.append(
            {
                "code": "positional-app-constructor",
                "message": "App class 使用位置参数构造函数，禁止自动 patch",
                "paths": [_relative(class_file, root)] if class_file else [],
            }
        )
    if app_entry_variant in {"unsupported-router", "unknown-app-entry"}:
        blockers.append(
            {
                "code": app_entry_variant,
                "message": "当前 App/Router 入口不支持确定性自动 patch",
                "paths": (
                    [_relative(class_file, root)] if class_file else []
                ),
            }
        )

    return (
        {
            "main_candidates": [_relative(path, root) for path in main_candidates],
            "main_file": _relative(main_file, root) if main_file else None,
            "class_name": class_name,
            "class_file": _relative(class_file, root) if class_file else None,
            "widget_type": widget_type,
            "constructor_style": constructor_style,
            "app_widget": variant,
            "app_entry_variant": app_entry_variant,
            "router": {
                "scheme": router_scheme,
                "go_router_files": [
                    _relative(path, root) for path in go_router_files
                ],
                "config_file": (
                    _relative(go_router_files[0], root)
                    if len(go_router_files) == 1
                    else None
                ),
                "named_routes": named_routes,
                "login_route_candidates": login_routes,
            },
            "existing_parameters": {
                "localizations_delegates": "localizationsDelegates:" in class_code,
                "supported_locales": "supportedLocales:" in class_code,
                "navigator_observers": "navigatorObservers:" in class_code,
                "go_router_observers": (
                    len(go_router_files) == 1
                    and "observers:" in texts[go_router_files[0]]
                ),
            },
        },
        blockers,
    )


def _state_management(
    dependencies: list[str],
    files: list[Path],
    texts: dict[Path, str],
    root: Path,
) -> dict[str, Any]:
    detected = sorted(
        {
            STATE_MANAGEMENT_DEPENDENCIES[dependency]
            for dependency in dependencies
            if dependency in STATE_MANAGEMENT_DEPENDENCIES
        }
    )
    usage_files: list[str] = []
    for path in files:
        text = texts[path]
        if any(
            re.search(rf"package:{re.escape(dependency)}/", text)
            for dependency in STATE_MANAGEMENT_DEPENDENCIES
        ):
            usage_files.append(_relative(path, root))
    return {
        "detected": detected,
        "usage_files": sorted(usage_files),
    }


def _service_directories(root: Path) -> list[str]:
    lib = root / "lib"
    if not lib.is_dir():
        return []
    return sorted(
        _relative(path, root)
        for path in lib.rglob("*")
        if path.is_dir() and path.name.lower() in SERVICE_DIRECTORY_NAMES
    )


def _call_entry_candidates(
    root: Path,
    files: list[Path],
    texts: dict[Path, str],
) -> list[dict[str, Any]]:
    candidates: list[dict[str, Any]] = []
    for path in files:
        relative = _relative(path, root)
        lowered = relative.lower()
        if "/trtc_call/" in f"/{lowered}" or lowered.endswith("_test.dart"):
            continue
        if any(token in lowered for token in CALL_ENTRY_EXCLUDES):
            continue
        score = 0
        signals: list[str] = []
        for keyword, weight in CALL_ENTRY_KEYWORDS.items():
            if keyword in lowered:
                score += weight
                signals.append(f"path:{keyword}")
        text = texts[path]
        if not any(token in text for token in ("Scaffold(", "AppBar(", "ListTile(")):
            continue
        for token, weight in (("Scaffold(", 3), ("AppBar(", 2), ("ListTile(", 1)):
            if token in text:
                score += weight
                signals.append(f"widget:{token[:-1]}")
        if score == 0:
            continue
        candidates.append(
            {
                "path": relative,
                "score": score,
                "signals": sorted(signals),
                "already_has_call_button": "CallButton(" in text,
            }
        )
    return sorted(candidates, key=lambda item: (-item["score"], item["path"]))[:5]


def _platform_config(root: Path) -> dict[str, Any]:
    info_plist = root / "ios/Runner/Info.plist"
    manifest = root / "android/app/src/main/AndroidManifest.xml"
    android_build_candidates = [
        root / "android/app/build.gradle",
        root / "android/app/build.gradle.kts",
    ]
    android_build = next(
        (path for path in android_build_candidates if path.is_file()),
        None,
    )
    info_text = _read_text(info_plist)
    manifest_text = _read_text(manifest)
    android_build_text = _read_text(android_build) if android_build else ""
    min_sdk_match = re.search(
        r"\bminSdk(?:Version)?\s*(?:=)?\s*(\d+)",
        android_build_text,
    )
    return {
        "ios": {
            "present": (root / "ios").is_dir(),
            "info_plist": _relative(info_plist, root) if info_plist.is_file() else None,
            "microphone_usage": "NSMicrophoneUsageDescription" in info_text,
            "camera_usage": "NSCameraUsageDescription" in info_text,
            "podfile": "ios/Podfile" if (root / "ios/Podfile").is_file() else None,
        },
        "android": {
            "present": (root / "android").is_dir(),
            "manifest": _relative(manifest, root) if manifest.is_file() else None,
            "record_audio_permission": "android.permission.RECORD_AUDIO" in manifest_text,
            "internet_permission": "android.permission.INTERNET" in manifest_text,
            "camera_permission": "android.permission.CAMERA" in manifest_text,
            "build_file": _relative(android_build, root) if android_build else None,
            "min_sdk": int(min_sdk_match.group(1)) if min_sdk_match else None,
            "multidex_enabled": bool(
                re.search(
                    r"\bmultiDexEnabled\s*(?:=)?\s*true\b",
                    android_build_text,
                )
            ),
        },
    }


def _existing_call(
    root: Path,
    dependencies: list[str],
    files: list[Path],
    texts: dict[Path, str],
) -> dict[str, Any]:
    trtc_files = sorted(
        _relative(path, root)
        for path in files
        if "trtc_call" in _rel_parts(path, root)
    )
    all_text = "\n".join(texts.values())
    business_text = "\n".join(
        text
        for path, text in texts.items()
        if "trtc_call" not in _rel_parts(path, root)
        and "debug" not in _rel_parts(path, root)
    )
    anchors = {
        "bootstrap": "TrtcCallBootstrap.run(" in business_text,
        "call_button": "CallButton(" in business_text,
        "auth_lifecycle": "CallAuthLifecycle(" in business_text,
        "navigator_observer": "TUICallKit.navigatorObserver" in business_text,
        "delegates": "trtcDelegates" in business_text,
        "observers": "trtcObservers" in business_text,
    }
    contracts = {
        "lib/trtc_call/trtc_call_bootstrap.dart": all(
            token
            in _read_text(root / "lib/trtc_call/trtc_call_bootstrap.dart")
            for token in ("class TrtcCallBootstrap", "AtomicLocalizations.delegate")
        ),
        "lib/trtc_call/call_service.dart": all(
            token in _read_text(root / "lib/trtc_call/call_service.dart")
            for token in (
                "class CallService",
                "abstract interface class CallSdkAdapter",
                "LoginStore.shared.loginEventStream",
            )
        ),
        "lib/trtc_call/call_button.dart": all(
            token in _read_text(root / "lib/trtc_call/call_button.dart")
            for token in ("class CallButton", "onError", "buttonKey")
        ),
        "lib/debug/generate_test_user_sig.dart": all(
            token in _read_text(root / "lib/debug/generate_test_user_sig.dart")
            for token in ("class GenerateTestUserSig", "secretKey")
        ),
    }
    detected = (
        "tencent_calls_uikit" in dependencies
        or bool(trtc_files)
        or any(anchors.values())
    )
    return {
        "status": "detected" if detected else "none",
        "dependency_present": "tencent_calls_uikit" in dependencies,
        "files": trtc_files,
        "anchors": anchors,
        "file_contracts": contracts,
    }


def snapshot_project(root: Path) -> dict[str, Any]:
    paths = set(_dart_files(root))
    for relative in (
        "pubspec.yaml",
        "android/app/src/main/AndroidManifest.xml",
        "android/app/build.gradle",
        "android/app/build.gradle.kts",
        "ios/Runner/Info.plist",
        "ios/Podfile",
    ):
        path = root / relative
        if path.is_file():
            paths.add(path)
    files = {
        _relative(path, root): _sha256_file(path)
        for path in sorted(paths)
        if path.is_file()
    }
    return {
        "algorithm": "sha256",
        "files": files,
    }


def probe_project(project_root: Path) -> dict[str, Any]:
    root = project_root.resolve()
    pubspec_path = root / "pubspec.yaml"
    pubspec = _read_text(pubspec_path)
    sections = _pubspec_sections(pubspec)
    dependencies = sections["dependencies"]
    files = _dart_files(root)
    texts = {path: _read_text(path) for path in files}
    app_entry, blockers = _extract_app_entry(root, files, texts)

    if not pubspec_path.is_file():
        blockers.insert(
            0,
            {
                "code": "pubspec-missing",
                "message": "项目根目录缺少 pubspec.yaml",
                "paths": [],
            },
        )
    elif "flutter:" not in pubspec:
        blockers.insert(
            0,
            {
                "code": "not-flutter-project",
                "message": "pubspec.yaml 未检测到 Flutter 配置",
                "paths": ["pubspec.yaml"],
            },
        )

    _COMPETING_RTC_PACKAGES = (
        "agora_rtc_engine",
        "livekit_client",
        "zego_express_engine",
        "flutter_webrtc",
    )
    competing = [pkg for pkg in _COMPETING_RTC_PACKAGES if pkg in dependencies]
    if competing:
        blockers.insert(
            0,
            {
                "code": "competing-rtc-sdk",
                "message": (
                    "项目已包含其他 RTC SDK，与 tencent_calls_uikit 可能冲突，"
                    "接入前需先评估兼容性或移除冲突依赖"
                ),
                "paths": ["pubspec.yaml"],
                "detail": competing,
            },
        )

    payload: dict[str, Any] = {
        "schema_version": SCHEMA_VERSION,
        "project": {
            "root": str(root),
            "package_name": _package_name(pubspec),
            "platform": "flutter" if "flutter:" in pubspec else "unknown",
            "targets": [
                target
                for target in ("android", "ios", "web", "macos", "windows", "linux")
                if (root / target).is_dir()
            ],
        },
        "dependencies": sections,
        "app_entry": app_entry,
        "state_management": _state_management(
            dependencies,
            files,
            texts,
            root,
        ),
        "service_directories": _service_directories(root),
        "platform_config": _platform_config(root),
        "call_entry_candidates": _call_entry_candidates(root, files, texts),
        "existing_call": _existing_call(
            root,
            dependencies,
            files,
            texts,
        ),
        "blockers": blockers,
        "snapshot": snapshot_project(root),
    }
    payload["profile_id"] = _canonical_digest(payload)
    return payload


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project-root", type=Path, required=True)
    parser.add_argument("--output", type=Path)
    return parser


def main() -> int:
    args = _build_parser().parse_args()
    profile = probe_project(args.project_root)
    output = json.dumps(
        profile,
        ensure_ascii=False,
        indent=2,
        sort_keys=True,
    ) + "\n"
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(output, encoding="utf-8")
    print(output, end="")
    return 0 if not profile["blockers"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
