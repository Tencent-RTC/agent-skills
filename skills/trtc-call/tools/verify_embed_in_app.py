#!/usr/bin/env python3
"""Verify embed-in-app playbook apply output.

Invoked by `flows/basic-call.md` Phase 6 after Phase 5 落盘完成. Checks whether
the user project has been correctly modified per the chosen playbook variant.

Checks (grouped):
  1. Installed files exist (INSTALL 目标)
  2. Key API presence via literal grep (SDK types, entry points, Builder injection)
  3. pubspec.yaml dependency lines
  4. main.dart Builder injection anchors
  5. local-dev credentials use --dart-define instead of source literals
  6. flutter analyze (no errors)
  7. Platform config skip WARN (from session.skipped_platform_configs)

Usage:
    python3 verify_embed_in_app.py --project-root PATH
                                   [--variant local-dev|backend]
                                   [--session PATH]
                                   [--format json|user]
                                   [--skip-analyze]

    --variant  未指定时从 --session 或 <project-root>/.trtc-session.yaml
               的 q1_usersig_source 自动推断。
    --format   json (default) 供 AI 消费；user 供直接展示给用户（自然语言）。
    --skip-analyze  跳过 flutter analyze（离线 / CI 场景）。

Exit codes:
    0 — all checks PASS (WARN 允许)
    1 — 至少一项 FAIL
    2 — 脚本自身错误（参数错、找不到项目根、找不到 session 等）
"""
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Literal


Status = Literal["PASS", "FAIL", "WARN"]


@dataclass
class CheckResult:
    check_id: str
    status: Status
    title: str
    detail: str = ""
    file: str = ""


@dataclass
class Report:
    variant: str
    project_root: str
    results: list[CheckResult] = field(default_factory=list)

    def add(self, r: CheckResult) -> None:
        self.results.append(r)

    def has_fail(self) -> bool:
        return any(r.status == "FAIL" for r in self.results)


# ---------------------------------------------------------------------------
# session parsing (minimal YAML — avoid external dep)
# ---------------------------------------------------------------------------

def _read_session_variant(session_path: Path) -> str | None:
    """Read q1_usersig_source from .trtc-session.yaml without importing yaml."""
    if not session_path.is_file():
        return None
    try:
        text = session_path.read_text(encoding="utf-8")
    except OSError:
        return None
    match = re.search(r"^\s*q1_usersig_source\s*:\s*(\S+)", text, re.MULTILINE)
    if not match:
        return None
    val = match.group(1).strip().strip('"\'')
    return val if val in {"local-dev", "backend"} else None


def _read_phase_a_state(session_path: Path) -> str | None:
    if not session_path.is_file():
        return None
    try:
        text = session_path.read_text(encoding="utf-8")
    except OSError:
        return None
    match = re.search(r"^\s*phase_a_state\s*:\s*(\S+)", text, re.MULTILINE)
    if not match:
        return None
    return match.group(1).strip().strip('"\'')


def _read_skipped_platform_configs(session_path: Path) -> list[str]:
    if not session_path.is_file():
        return []
    try:
        text = session_path.read_text(encoding="utf-8")
    except OSError:
        return []
    # match either flow-style `skipped_platform_configs: [a, b]`
    # or block-style list.
    inline = re.search(
        r"^\s*skipped_platform_configs\s*:\s*\[([^\]]*)\]",
        text,
        re.MULTILINE,
    )
    if inline:
        raw = inline.group(1)
        return [p.strip().strip('"\'') for p in raw.split(",") if p.strip()]
    # block form:
    #   skipped_platform_configs:
    #     - foo
    #     - bar
    block = re.search(
        r"^\s*skipped_platform_configs\s*:\s*\n((?:\s+-\s+\S+.*\n?)+)",
        text,
        re.MULTILINE,
    )
    if not block:
        return []
    items: list[str] = []
    for line in block.group(1).splitlines():
        m = re.match(r"\s+-\s+(\S.*)", line)
        if m:
            items.append(m.group(1).strip().strip('"\''))
    return items


# ---------------------------------------------------------------------------
# grep helpers
# ---------------------------------------------------------------------------

def _read_text(path: Path) -> str | None:
    if not path.is_file():
        return None
    try:
        return path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return None


def _contains(path: Path, needle: str) -> bool:
    text = _read_text(path)
    return text is not None and needle in text


def _not_contains(path: Path, needle: str) -> bool:
    text = _read_text(path)
    return text is not None and needle not in text


# ---------------------------------------------------------------------------
# check catalog
# ---------------------------------------------------------------------------

_INSTALLED_FILES_COMMON = [
    "lib/trtc_call/trtc_call_bootstrap.dart",
    "lib/trtc_call/call_service.dart",
    "lib/trtc_call/call_button.dart",
]
_INSTALLED_FILES_LOCAL_DEV = ["lib/debug/generate_test_user_sig.dart"]

_MAIN_DART = "lib/main.dart"
_PUBSPEC = "pubspec.yaml"

_MAIN_DART_ANCHORS = [
    ("main-import", "import 'trtc_call/trtc_call_bootstrap.dart';", "顶部 import 未插入"),
    ("main-runapp", "TrtcCallBootstrap.run(", "runApp 未替换为 TrtcCallBootstrap.run"),
    ("main-delegates", "trtcDelegates", "MyApp / MaterialApp 未接入 trtcDelegates"),
]

_LOCAL_DEV_MAIN_ANCHORS = [
    ("local-dev-signer-import", "import 'debug/generate_test_user_sig.dart';",
     "main.dart 缺本地测试签名 import"),
    ("local-dev-sdk-app-id", "GenerateTestUserSig.sdkAppId =",
     "main.dart 未给本地测试签名器设置 SDKAppID"),
    ("local-dev-secret-key", "GenerateTestUserSig.secretKey =",
     "main.dart 未给本地测试签名器设置 SecretKey"),
    ("local-dev-sdk-app-id-env", "int.fromEnvironment('TRTC_SDK_APP_ID')",
     "main.dart 未通过 --dart-define 读取 SDKAppID"),
    ("local-dev-secret-key-env", "String.fromEnvironment('TRTC_SECRET_KEY')",
     "main.dart 未通过 --dart-define 读取 SecretKey"),
]

_BOOTSTRAP_APIS = [
    ("bootstrap-localizations", "AtomicLocalizations.delegate",
     "trtc_call_bootstrap.dart 缺 AtomicLocalizations（TUICallKit UI 文案会缺失）"),
    ("bootstrap-observer", "TUICallKit.navigatorObserver",
     "trtc_call_bootstrap.dart 缺 navigatorObserver（来电界面弹不出）"),
]

_SERVICE_APIS = [
    ("service-loginstore", "LoginStore.shared.loginEventStream",
     "call_service.dart 缺 loginEventStream 订阅（login 前必须先订阅）"),
    ("service-adapter-interface", "abstract interface class CallSdkAdapter",
     "call_service.dart 缺可替换 SDK adapter"),
    ("service-adapter-injection", "CallService({CallSdkAdapter? adapter})",
     "CallService 不支持测试注入 Fake adapter"),
]

_BUTTON_APIS = [
    ("button-custom-child", "final Widget? child",
     "call_button.dart 不支持复用业务 child"),
    ("button-custom-style", "final ButtonStyle? style",
     "call_button.dart 不支持复用业务按钮 style"),
    ("button-error-handler", "final CallButtonErrorHandler? onError",
     "call_button.dart 缺业务错误回调"),
    ("button-service-injection", "final CallService? service",
     "call_button.dart 不支持注入可测试 CallService"),
    ("button-stable-key", "trtc-call-button-${widget.mediaType.name}",
     "call_button.dart 缺稳定按钮 Key"),
]

_PUBSPEC_COMMON_DEPS = [
    ("pubspec-callkit", "tencent_calls_uikit:", "pubspec.yaml 缺 tencent_calls_uikit 依赖"),
    ("pubspec-l10n", "flutter_localizations:", "pubspec.yaml 缺 flutter_localizations 依赖"),
]

_PLACEHOLDERS = [
    ("placeholder-sdk-app-id", "__SDK_APP_ID__",
     "main.dart 里 SDKAppID 占位未替换 —— 跑通话前需回填"),
    ("placeholder-secret-key", "__SECRET_KEY__",
     "main.dart 里 SecretKey 占位未替换 —— 跑本地调试前需回填"),
]

_BACKEND_FORBIDDEN_TOKENS = [
    "GenerateTestUserSig",
    "generate_test_user_sig.dart",
    "secretKey",
    "SecretKey",
    "SDKSecretKey",
]


# ---------------------------------------------------------------------------
# per-check implementations
# ---------------------------------------------------------------------------

def _check_installed_files(root: Path, variant: str, report: Report) -> None:
    files = list(_INSTALLED_FILES_COMMON)
    if variant == "local-dev":
        files.extend(_INSTALLED_FILES_LOCAL_DEV)
    for rel in files:
        p = root / rel
        if p.is_file():
            report.add(CheckResult(f"file-exists:{rel}", "PASS",
                                   f"{rel} 已生成", file=rel))
        else:
            report.add(CheckResult(f"file-exists:{rel}", "FAIL",
                                   f"{rel} 未生成", file=rel,
                                   detail="文件未写入项目（Write 步骤失败或被跳过）"))

    if variant == "backend":
        rel = "lib/debug/generate_test_user_sig.dart"
        p = root / rel
        if p.is_file():
            report.add(CheckResult(
                f"file-not-exists:{rel}", "FAIL",
                f"{rel} 不该出现在 backend 场景",
                file=rel,
                detail="backend 场景 UserSig 由后端签发，不应生成本地签名文件",
            ))


def _check_main_dart_anchors(root: Path, variant: str, report: Report) -> None:
    p = root / _MAIN_DART
    if not p.is_file():
        report.add(CheckResult("main-dart-exists", "FAIL",
                               f"{_MAIN_DART} 不存在",
                               file=_MAIN_DART,
                               detail="main.dart 应该已经被 PATCH，但文件不存在"))
        return
    text = _read_text(p) or ""
    for check_id, needle, err_msg in _MAIN_DART_ANCHORS:
        if needle in text:
            report.add(CheckResult(check_id, "PASS",
                                   f"main.dart 含 `{needle}`",
                                   file=_MAIN_DART))
        else:
            report.add(CheckResult(check_id, "FAIL", err_msg,
                                   file=_MAIN_DART,
                                   detail=f"grep 未命中 `{needle}`"))
    if variant == "local-dev":
        for check_id, needle, err_msg in _LOCAL_DEV_MAIN_ANCHORS:
            if needle in text:
                report.add(CheckResult(check_id, "PASS",
                                       f"main.dart 含 `{needle}`",
                                       file=_MAIN_DART))
            else:
                report.add(CheckResult(check_id, "FAIL", err_msg,
                                       file=_MAIN_DART,
                                       detail=f"grep 未命中 `{needle}`"))


def _check_app_entry(root: Path, report: Report) -> None:
    main_path = root / _MAIN_DART
    main_text = _read_text(main_path)
    if main_text is None:
        return

    if re.search(r"\bCupertinoApp\.router\s*\(", main_text):
        report.add(CheckResult(
            "app-entry-unsupported", "FAIL",
            "CupertinoApp.router 当前不支持自动 observer 注入",
            file=_MAIN_DART,
        ))
        return

    if re.search(r"\bMaterialApp\.router\s*\(", main_text):
        if "navigatorObservers:" in main_text:
            report.add(CheckResult(
                "router-no-material-observers", "FAIL",
                "MaterialApp.router 不支持 navigatorObservers 参数",
                file=_MAIN_DART,
            ))
        else:
            report.add(CheckResult(
                "router-no-material-observers", "PASS",
                "MaterialApp.router 未写入错误的 navigatorObservers 参数",
                file=_MAIN_DART,
            ))

        router_files = [
            path
            for path in (root / "lib").rglob("*.dart")
            if re.search(r"\bGoRouter\s*\(", _read_text(path) or "")
        ]
        if len(router_files) != 1:
            report.add(CheckResult(
                "go-router-definition", "FAIL",
                "无法唯一定位 GoRouter 配置，不能确认来电 observer 已接入",
                detail=f"命中 {len(router_files)} 个 GoRouter 定义",
            ))
            return

        router_path = router_files[0]
        relative_path = str(router_path.relative_to(root))
        router_text = _read_text(router_path) or ""
        if "package:tencent_calls_uikit/tencent_calls_uikit.dart" not in router_text:
            report.add(CheckResult(
                "go-router-import", "FAIL",
                "GoRouter 配置文件缺 TUICallKit import",
                file=relative_path,
            ))
        else:
            report.add(CheckResult(
                "go-router-import", "PASS",
                "GoRouter 配置文件已导入 TUICallKit",
                file=relative_path,
            ))
        if "observers:" not in router_text:
            report.add(CheckResult(
                "go-router-observers", "FAIL",
                "GoRouter 缺 observers 参数",
                file=relative_path,
            ))
        elif router_text.count("TUICallKit.navigatorObserver") != 1:
            report.add(CheckResult(
                "go-router-observers", "FAIL",
                "GoRouter 必须且只能接入一次 TUICallKit.navigatorObserver",
                file=relative_path,
            ))
        else:
            report.add(CheckResult(
                "go-router-observers", "PASS",
                "GoRouter 已接入来电 navigatorObserver",
                file=relative_path,
            ))
        return

    if (
        re.search(r"\bMaterialApp\s*\(", main_text)
        or re.search(r"\bCupertinoApp\s*\(", main_text)
    ):
        if "trtcObservers" not in main_text:
            report.add(CheckResult(
                "direct-app-observers", "FAIL",
                "标准 App 未接入 trtcObservers",
                file=_MAIN_DART,
            ))
        elif main_text.count("navigatorObservers:") != 1:
            report.add(CheckResult(
                "direct-app-observers", "FAIL",
                "标准 App 必须且只能包含一个 navigatorObservers 参数",
                file=_MAIN_DART,
            ))
        elif main_text.count("...trtcObservers") != 1:
            report.add(CheckResult(
                "direct-app-observers", "FAIL",
                "标准 App 必须且只能合并一次 trtcObservers",
                file=_MAIN_DART,
            ))
        else:
            report.add(CheckResult(
                "direct-app-observers", "PASS",
                "标准 App 已接入 navigatorObservers",
                file=_MAIN_DART,
            ))
        return

    report.add(CheckResult(
        "app-entry-unsupported", "FAIL",
        "无法识别受支持的 MaterialApp / CupertinoApp 入口",
        file=_MAIN_DART,
    ))


def _check_bootstrap_apis(root: Path, report: Report) -> None:
    rel = "lib/trtc_call/trtc_call_bootstrap.dart"
    p = root / rel
    if not p.is_file():
        return  # already flagged by installed-files check
    for check_id, needle, err_msg in _BOOTSTRAP_APIS:
        if _contains(p, needle):
            report.add(CheckResult(check_id, "PASS", f"含 `{needle}`", file=rel))
        else:
            report.add(CheckResult(check_id, "FAIL", err_msg, file=rel,
                                   detail=f"grep 未命中 `{needle}`"))


def _check_service_apis(root: Path, report: Report) -> None:
    rel = "lib/trtc_call/call_service.dart"
    p = root / rel
    if not p.is_file():
        return
    for check_id, needle, err_msg in _SERVICE_APIS:
        if _contains(p, needle):
            report.add(CheckResult(check_id, "PASS", f"含 `{needle}`", file=rel))
        else:
            report.add(CheckResult(check_id, "FAIL", err_msg, file=rel,
                                   detail=f"grep 未命中 `{needle}`"))


def _check_button_apis(root: Path, report: Report) -> None:
    rel = "lib/trtc_call/call_button.dart"
    p = root / rel
    if not p.is_file():
        return
    for check_id, needle, err_msg in _BUTTON_APIS:
        if _contains(p, needle):
            report.add(CheckResult(check_id, "PASS", f"含 `{needle}`", file=rel))
        else:
            report.add(CheckResult(check_id, "FAIL", err_msg, file=rel,
                                   detail=f"grep 未命中 `{needle}`"))


def _check_pubspec(root: Path, variant: str, report: Report) -> None:
    p = root / _PUBSPEC
    if not p.is_file():
        report.add(CheckResult("pubspec-exists", "FAIL",
                               "pubspec.yaml 不存在", file=_PUBSPEC))
        return
    for check_id, needle, err_msg in _PUBSPEC_COMMON_DEPS:
        if _contains(p, needle):
            report.add(CheckResult(check_id, "PASS", f"依赖已加：{needle}", file=_PUBSPEC))
        else:
            report.add(CheckResult(check_id, "FAIL", err_msg, file=_PUBSPEC,
                                   detail=f"grep 未命中 `{needle}`"))
    # F5 fix: enforce tencent_calls_uikit major version 5.x.
    # Wrong version (e.g. ^3.x) compiles past verifier but breaks flutter build.
    import re as _re
    pubspec_text = p.read_text(encoding="utf-8")
    if _re.search(r"tencent_calls_uikit\s*:\s*[\^~]?\s*5\.", pubspec_text):
        report.add(CheckResult("pubspec-callkit-version", "PASS",
                               "tencent_calls_uikit 版本约束为 5.x", file=_PUBSPEC))
    else:
        report.add(CheckResult(
            "pubspec-callkit-version", "FAIL",
            "tencent_calls_uikit 版本必须为 ^5.0.0（当前 Skill 模板仅兼容 5.x API）",
            file=_PUBSPEC,
            detail="错误版本（如 ^3.x / ^4.x）可通过依赖存在检查但 flutter build 会因 API 缺失失败",
        ))
    if variant == "local-dev":
        if _contains(p, "crypto:"):
            report.add(CheckResult("pubspec-crypto", "PASS",
                                   "依赖已加：crypto", file=_PUBSPEC))
        else:
            report.add(CheckResult("pubspec-crypto", "FAIL",
                                   "pubspec.yaml 缺 crypto 依赖（local-dev 签名需要）",
                                   file=_PUBSPEC))
    else:  # backend
        if _contains(p, "crypto:"):
            report.add(CheckResult(
                "pubspec-crypto-forbidden", "FAIL",
                "pubspec.yaml 不该有 crypto 依赖（backend 场景由后端签发 UserSig）",
                file=_PUBSPEC,
            ))


def _check_placeholders(root: Path, variant: str, report: Report,
                        session_path: Path | None = None) -> None:
    """Unreplaced placeholders: WARN if placeholder-only path, FAIL otherwise."""
    p = root / _MAIN_DART
    if not p.is_file():
        return
    text = _read_text(p) or ""
    phase_a_state = _read_phase_a_state(session_path) if session_path else None
    is_placeholder_only = phase_a_state == "placeholder-only"
    for check_id, needle, err_msg in _PLACEHOLDERS:
        if needle == "__SECRET_KEY__" and variant == "backend":
            continue  # backend 场景 secretKey 从来不出现
        if needle in text:
            severity = "WARN" if is_placeholder_only else "FAIL"
            report.add(CheckResult(check_id, severity, err_msg, file=_MAIN_DART,
                                   detail=f"占位符 `{needle}` 仍在文件中"))


def _check_variant_boundaries(root: Path, variant: str, report: Report) -> None:
    if variant == "local-dev":
        main_text = _read_text(root / _MAIN_DART) or ""
        if re.search(r"""GenerateTestUserSig\.secretKey\s*=\s*['"]""", main_text):
            report.add(CheckResult(
                "local-dev-secret-literal", "FAIL",
                "main.dart 把 SecretKey 明文写入了源码",
                file=_MAIN_DART,
                detail="请改用 String.fromEnvironment('TRTC_SECRET_KEY')",
            ))
        else:
            report.add(CheckResult(
                "local-dev-secret-literal", "PASS",
                "main.dart 未硬编码 SecretKey",
                file=_MAIN_DART,
            ))
        return

    if variant != "backend":
        return
    generated_files = [
        _MAIN_DART,
        *_INSTALLED_FILES_COMMON,
    ]
    for rel in generated_files:
        path = root / rel
        text = _read_text(path)
        if text is None:
            continue
        matched = [token for token in _BACKEND_FORBIDDEN_TOKENS if token in text]
        if matched:
            report.add(CheckResult(
                f"backend-boundary:{rel}", "FAIL",
                f"{rel} 混入了 local-dev 测试签名逻辑",
                file=rel,
                detail=f"backend 生成物禁止出现：{', '.join(matched)}",
            ))
        else:
            report.add(CheckResult(
                f"backend-boundary:{rel}", "PASS",
                f"{rel} 未混入本地签名逻辑",
                file=rel,
            ))


def _ios_version_tuple(value: str) -> tuple[int, ...]:
    return tuple(int(part) for part in value.split("."))


def _check_ios_deployment_target(
    root: Path,
    session_path: Path,
    report: Report,
) -> None:
    ios_root = root / "ios"
    if not ios_root.is_dir():
        return

    skipped = set(_read_skipped_platform_configs(session_path))
    podfile_rel = "ios/Podfile"
    podfile = root / podfile_rel
    if podfile_rel not in skipped:
        podfile_text = _read_text(podfile)
        if podfile_text is None:
            report.add(CheckResult(
                "ios-podfile-target",
                "WARN",
                "未找到 ios/Podfile，无法确认 iOS 最低版本",
                file=podfile_rel,
            ))
        else:
            platform_match = re.search(
                r"^\s*platform\s+:ios\s*,\s*['\"](\d+(?:\.\d+)*)['\"]",
                podfile_text,
                re.MULTILINE,
            )
            if platform_match is None:
                report.add(CheckResult(
                    "ios-podfile-target",
                    "FAIL",
                    "Podfile 必须显式设置 iOS platform 至少为 14.0",
                    file=podfile_rel,
                ))
            elif _ios_version_tuple(platform_match.group(1)) < (14, 0):
                report.add(CheckResult(
                    "ios-podfile-target",
                    "FAIL",
                    "Podfile 的 iOS platform 低于 14.0",
                    file=podfile_rel,
                    detail=f"当前为 {platform_match.group(1)}",
                ))
            else:
                report.add(CheckResult(
                    "ios-podfile-target",
                    "PASS",
                    "Podfile 的 iOS platform 至少为 14.0",
                    file=podfile_rel,
                ))

            forced_override = re.search(
                r"config\.build_settings\s*\[\s*['\"]"
                r"IPHONEOS_DEPLOYMENT_TARGET['\"]\s*\]\s*=",
                podfile_text,
            )
            if forced_override:
                report.add(CheckResult(
                    "ios-pod-target-override",
                    "FAIL",
                    "Podfile 不应强制覆盖所有 Pods 的 deployment target",
                    file=podfile_rel,
                ))
            else:
                report.add(CheckResult(
                    "ios-pod-target-override",
                    "PASS",
                    "Podfile 未强制覆盖所有 Pods 的 deployment target",
                    file=podfile_rel,
                ))

    project_rel = "ios/Runner.xcodeproj/project.pbxproj"
    project_file = root / project_rel
    if project_rel not in skipped:
        project_text = _read_text(project_file)
        if project_text is None:
            report.add(CheckResult(
                "ios-runner-target",
                "WARN",
                "未找到 Runner project.pbxproj，无法确认 App 最低版本",
                file=project_rel,
            ))
        else:
            targets = re.findall(
                r"IPHONEOS_DEPLOYMENT_TARGET\s*=\s*(\d+(?:\.\d+)*)\s*;",
                project_text,
            )
            if not targets:
                report.add(CheckResult(
                    "ios-runner-target",
                    "FAIL",
                    "Runner 工程未显式设置 iOS deployment target",
                    file=project_rel,
                ))
            elif any(_ios_version_tuple(value) < (14, 0) for value in targets):
                report.add(CheckResult(
                    "ios-runner-target",
                    "FAIL",
                    "Runner 工程存在低于 14.0 的 deployment target",
                    file=project_rel,
                    detail=f"检测值：{', '.join(targets)}",
                ))
            else:
                report.add(CheckResult(
                    "ios-runner-target",
                    "PASS",
                    "Runner 工程 deployment target 均至少为 14.0",
                    file=project_rel,
                ))


def _check_flutter_analyze(root: Path, report: Report) -> None:
    """Run `flutter analyze` and surface errors."""
    try:
        proc = subprocess.run(
            ["flutter", "analyze", "--no-pub"],
            cwd=root,
            capture_output=True,
            text=True,
            timeout=180,
        )
    except FileNotFoundError:
        report.add(CheckResult(
            "flutter-analyze", "WARN",
            "flutter 命令未找到，跳过 analyze",
            detail="用户环境缺 flutter CLI；请手动跑 `flutter analyze` 补校验",
        ))
        return
    except subprocess.TimeoutExpired:
        report.add(CheckResult(
            "flutter-analyze", "WARN",
            "flutter analyze 超时（3 分钟）",
            detail="用户项目过大或初次分析；建议手动重跑",
        ))
        return

    output = (proc.stdout or "") + (proc.stderr or "")
    lines = output.splitlines()
    error_lines = [line for line in lines if "error •" in line.lower()]
    warning_lines = [line for line in lines if "warning •" in line.lower()]
    info_lines = [line for line in lines if "info •" in line.lower()]

    if error_lines:
        report.add(CheckResult(
            "flutter-analyze", "FAIL",
            "flutter analyze 有 error",
            detail="\n".join(error_lines[:10]),
        ))
    elif proc.returncode == 0 or warning_lines or info_lines:
        levels: list[str] = []
        if warning_lines:
            levels.append("warning")
        if info_lines:
            levels.append("info")
        detail = f"只有 {' / '.join(levels)} 级别提示" if levels else ""
        report.add(CheckResult("flutter-analyze", "PASS",
                               "flutter analyze 通过", detail=detail))
    else:
        report.add(CheckResult(
            "flutter-analyze", "FAIL",
            "flutter analyze 执行失败",
            detail=output[-800:].strip() or "命令失败，且没有输出可解析的诊断信息",
        ))


def _check_platform_skips(session_path: Path, report: Report) -> None:
    skipped = _read_skipped_platform_configs(session_path)
    if not skipped:
        return
    report.add(CheckResult(
        "platform-skipped", "WARN",
        "以下平台文件用户 Phase 2 跳过了，跑起来前需自己配好",
        detail=", ".join(skipped),
    ))


# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------

def _run_all_checks(root: Path, variant: str, session_path: Path,
                    skip_analyze: bool) -> Report:
    report = Report(variant=variant, project_root=str(root))
    if variant == "backend":
        report.add(CheckResult(
            "backend-integration-deferred",
            "FAIL",
            "当前版本暂不支持生产 UserSig 自动接入",
            detail=(
                "请先按官方文档完成服务端 UserSig；当前版本不会生成或验证生产客户端代码"
            ),
        ))
        return report
    _check_installed_files(root, variant, report)
    _check_main_dart_anchors(root, variant, report)
    _check_app_entry(root, report)
    _check_bootstrap_apis(root, report)
    _check_service_apis(root, report)
    _check_button_apis(root, report)
    _check_pubspec(root, variant, report)
    _check_placeholders(root, variant, report, session_path=session_path)
    _check_variant_boundaries(root, variant, report)
    _check_ios_deployment_target(root, session_path, report)
    if not skip_analyze:
        _check_flutter_analyze(root, report)
    _check_platform_skips(session_path, report)
    return report


# --------------------------- output formats --------------------------------

def _emit_json(report: Report) -> str:
    return json.dumps({
        "variant": report.variant,
        "project_root": report.project_root,
        "summary": {
            "pass": sum(1 for r in report.results if r.status == "PASS"),
            "fail": sum(1 for r in report.results if r.status == "FAIL"),
            "warn": sum(1 for r in report.results if r.status == "WARN"),
        },
        "results": [
            {
                "check_id": r.check_id,
                "status": r.status,
                "title": r.title,
                "detail": r.detail,
                "file": r.file,
            }
            for r in report.results
        ],
    }, ensure_ascii=False, indent=2)


def _emit_user(report: Report) -> str:
    """自然语言汇报，供 AI 转述给用户（不含内部 check_id / grep 表达式）。

    过滤规则（对齐 SKILL.md 硬规则 6 / R9）：detail 里以 "grep 未命中" 开头的行不
    向用户暴露；其它 detail（如 flutter analyze error 行）保留。
    """
    fails = [r for r in report.results if r.status == "FAIL"]
    warns = [r for r in report.results if r.status == "WARN"]
    passes = [r for r in report.results if r.status == "PASS"]

    def _user_safe_detail(d: str) -> str:
        if d.startswith("grep 未命中"):
            return ""
        # 不向用户暴露内部占位符字面量（如 __SDK_APP_ID__）
        import re as _re
        if _re.search(r"占位符\s*`__\w+__`", d):
            return ""
        return d

    lines: list[str] = []
    if not fails and not warns:
        lines.append(f"基础通话代码已就绪，跑了一遍检查（共 {len(passes)} 项）没问题。")
        return "\n".join(lines)

    if not fails and warns:
        lines.append(f"检查通过（共 {len(passes)} 项），但有 {len(warns)} 处需要留意：")
        for r in warns:
            lines.append(f"  · {r.title}")
        return "\n".join(lines)

    lines.append(f"检查完成：{len(passes)} 项通过，{len(fails)} 项需要修一下：")
    for r in fails:
        lines.append(f"  ✗ {r.title}")
        safe = _user_safe_detail(r.detail)
        if safe and len(safe) < 300:
            lines.append(f"      —— {safe}")
    if warns:
        lines.append(f"另外 {len(warns)} 处提醒：")
        for r in warns:
            lines.append(f"  · {r.title}")
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.strip().splitlines()[0])
    parser.add_argument("--project-root", required=True,
                        help="Flutter 项目根目录（含 pubspec.yaml）")
    parser.add_argument("--variant", choices=["local-dev", "backend"], default=None,
                        help="不指定则从 session 推断")
    parser.add_argument("--session", default=None,
                        help="session 文件路径；不指定则默认 <project-root>/.trtc-session.yaml")
    parser.add_argument("--format", choices=["json", "user"], default="json")
    parser.add_argument("--skip-analyze", action="store_true",
                        help="跳过 flutter analyze")
    args = parser.parse_args()

    root = Path(args.project_root).resolve()
    if not root.is_dir():
        print(f"[verify] project root 不是目录：{root}", file=sys.stderr)
        return 2
    if not (root / "pubspec.yaml").is_file():
        print(f"[verify] 未找到 pubspec.yaml：{root}", file=sys.stderr)
        return 2

    session_path = Path(args.session).resolve() if args.session else root / ".trtc-session.yaml"

    variant = args.variant or _read_session_variant(session_path)
    if variant is None:
        print(f"[verify] 无法确定 variant：--variant 未指定，session 也未含 q1_usersig_source",
              file=sys.stderr)
        return 2

    report = _run_all_checks(root, variant, session_path, args.skip_analyze)

    if args.format == "json":
        print(_emit_json(report))
    else:
        print(_emit_user(report))

    return 1 if report.has_fail() else 0


if __name__ == "__main__":
    sys.exit(main())
