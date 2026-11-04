#!/usr/bin/env python3
"""Verify an iOS TRTC Call local-dev integration.

Safety: this tool may read Debug/TRTCDebugConfig.swift to check structure, but it NEVER prints
any line that mentions secretKey, and never prints matched secret-like literals (only file:line).
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
from pathlib import Path
from typing import Optional

try:  # 允许作为脚本或模块使用
    from ios_probe import parse_version, probe, _walk
except ImportError:  # pragma: no cover
    from .ios_probe import parse_version, probe, _walk  # type: ignore

DEBUG_CONFIG_REL = "Debug/TRTCDebugConfig.swift"
SECRET_LITERAL_RE = re.compile(r"secret\w*\s*[:=][^\n]*[\"'][0-9a-fA-F]{32,}[\"']", re.I)


def _check(cid: str, ok: bool, message: str, level: str = "error") -> dict:
    return {"id": cid, "ok": bool(ok), "level": level, "message": message}


def _find_debug_config(root: Path) -> Optional[Path]:
    hits = [p for p in _walk(root, (".swift",)) if p.name == "TRTCDebugConfig.swift"]
    return hits[0] if hits else None


def _analyze_debug_config(path: Path) -> dict:
    """Structure-only analysis. Returns no secret content."""
    lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
    depth = 0
    secret_outside_debug = False
    secret_filled = False
    wrapped_in_debug = False
    first_code = None
    last_code = None
    sdk_app_id: Optional[int] = None
    in_debug = False
    for raw in lines:
        s = raw.strip()
        if not s or s.startswith("//"):
            continue
        if first_code is None:
            first_code = s
        last_code = s
        if re.match(r"^#if\s+DEBUG\s*$", s):
            depth += 1
            in_debug = True
            continue
        if s.startswith("#if"):
            depth += 1
            continue
        if s.startswith("#endif"):
            depth = max(0, depth - 1)
            if depth == 0:
                in_debug = False
            continue
        if "secretKey" in s:
            m = re.search(r"secretKey\s*:\s*String\s*=\s*\"(.*)\"", s)
            if m and m.group(1) != "":
                secret_filled = True
                if not in_debug:
                    secret_outside_debug = True
        m = re.search(r"sdkAppID\s*:\s*Int\s*=\s*(\d+)", s)
        if m:
            sdk_app_id = int(m.group(1))
    wrapped_in_debug = bool(first_code and re.match(r"^#if\s+DEBUG\s*$", first_code) and last_code == "#endif")
    return {"wrapped_in_debug": wrapped_in_debug, "sdk_app_id": sdk_app_id,
            "secret_filled": secret_filled, "secret_outside_debug": secret_outside_debug}


def _git_tracked(root: Path, rel: str) -> Optional[bool]:
    if not (root / ".git").exists():
        return None
    try:
        r = subprocess.run(["git", "-C", str(root), "ls-files", "--", rel],
                           capture_output=True, text=True, timeout=10, check=False)
    except (OSError, subprocess.SubprocessError):
        return None
    if r.returncode != 0:
        return None
    return bool(r.stdout.strip())


def verify(root: Path, sdkappid: Optional[int], media_type: str, variant: str = "local-dev",
           xcodeproj: Optional[str] = None, app_target: Optional[str] = None) -> dict:
    root = root.resolve()
    prof = probe(root, xcodeproj=xcodeproj, app_target=app_target)
    checks: list = []
    pf = prof.get("podfile", {})

    if prof["blockers"]:
        for b in prof["blockers"]:
            checks.append(_check(f"blocker:{b['code']}", False, b["message"]))
        return _summarize(checks)

    # Podfile
    checks.append(_check("podfile_exists", pf.get("exists"), "存在 Podfile" if pf.get("exists") else "没有 Podfile"))
    checks.append(_check("podfile_pod_line", pf.get("tuicallkit_version") == "4.2.1",
                         "Podfile 含 pod 'TUICallKit_Swift', '4.2.1'" if pf.get("tuicallkit_version") == "4.2.1"
                         else f"Podfile 里 TUICallKit_Swift 版本为 {pf.get('tuicallkit_version')!r}，应固定为 4.2.1"))
    pv = parse_version(pf.get("platform_version"))
    checks.append(_check("podfile_platform", bool(pv and pv >= (14, 0)),
                         f"Podfile platform :ios 为 {pf.get('platform_version')}，需 ≥ 14.0"))
    checks.append(_check("podfile_use_frameworks", pf.get("has_use_frameworks"),
                         "Podfile 含 use_frameworks!" if pf.get("has_use_frameworks") else "Podfile 缺少 use_frameworks!"))
    checks.append(_check("podfile_sandbox", pf.get("has_sandbox_fix"),
                         "Podfile 已处理 ENABLE_USER_SCRIPT_SANDBOXING" if pf.get("has_sandbox_fix")
                         else "Podfile 缺少 ENABLE_USER_SCRIPT_SANDBOXING 处理，Xcode 15+ 可能 Embed Pods Frameworks 失败"))
    checks.append(_check("podfile_no_force_deployment", not pf.get("has_force_deployment_override"),
                         "Podfile 没有强制覆盖 Pods 部署版本" if not pf.get("has_force_deployment_override")
                         else "Podfile 有强制覆盖 Pods 部署版本的写法，会引发崩溃"))
    installed = (pf.get("locked_version") or "").startswith("4.")
    checks.append(_check("pods_installed", installed,
                         f"已 pod install（Podfile.lock 里 TUICallKit_Swift {pf.get('locked_version')}）" if installed
                         else "Podfile.lock 里还没有 TUICallKit_Swift，需要执行 pod install", level="warn"))

    # 部署版本
    checks.append(_check("deployment_target", prof.get("deployment_ok") is not False,
                         f"主 App 部署版本 {prof.get('deployment_target')}" +
                         ("" if prof.get("deployment_ok") is not False else "，低于 14.0，需在 Xcode 里调高")))

    # Info.plist 权限
    need_camera = media_type in ("video", "both")
    if prof["info_plist_form"] == "file" and prof["info_plist_path"]:
        text = (root / prof["info_plist_path"]).read_text(encoding="utf-8", errors="replace") \
            if (root / prof["info_plist_path"]).is_file() else ""
        checks.append(_check("plist_microphone", "NSMicrophoneUsageDescription" in text,
                             "Info.plist 含 NSMicrophoneUsageDescription" if "NSMicrophoneUsageDescription" in text
                             else "Info.plist 缺少 NSMicrophoneUsageDescription，首次用麦克风会被系统终止"))
        if need_camera:
            checks.append(_check("plist_camera", "NSCameraUsageDescription" in text,
                                 "Info.plist 含 NSCameraUsageDescription" if "NSCameraUsageDescription" in text
                                 else "Info.plist 缺少 NSCameraUsageDescription，视频通话首次用摄像头会被系统终止"))
    elif prof["info_plist_form"] == "generated":
        pbx = (root / prof["xcodeproj"] / "project.pbxproj").read_text(encoding="utf-8", errors="replace")
        mic = "INFOPLIST_KEY_NSMicrophoneUsageDescription" in pbx
        checks.append(_check("plist_microphone", mic,
                             "Build Settings 含 INFOPLIST_KEY_NSMicrophoneUsageDescription" if mic
                             else "无独立 Info.plist 的工程：请在 Xcode Target -> Info 页添加 NSMicrophoneUsageDescription",
                             level="warn"))
        if need_camera:
            cam = "INFOPLIST_KEY_NSCameraUsageDescription" in pbx
            checks.append(_check("plist_camera", cam,
                                 "Build Settings 含 INFOPLIST_KEY_NSCameraUsageDescription" if cam
                                 else "无独立 Info.plist 的工程：请在 Xcode Target -> Info 页添加 NSCameraUsageDescription",
                                 level="warn"))
    else:
        checks.append(_check("plist_form_unknown", False, "无法判断 Info.plist 形态，请用户自查麦克风/摄像头权限声明", level="warn"))

    if variant == "local-dev":
        dbg = _find_debug_config(root)
        checks.append(_check("debug_config_exists", dbg is not None,
                             "存在 Debug/TRTCDebugConfig.swift" if dbg else "缺少 Debug/TRTCDebugConfig.swift"))
        if dbg is not None:
            a = _analyze_debug_config(dbg)
            checks.append(_check("debug_config_wrapped", a["wrapped_in_debug"],
                                 "TRTCDebugConfig.swift 整个文件在 #if DEBUG 内" if a["wrapped_in_debug"]
                                 else "TRTCDebugConfig.swift 没有整体包在 #if DEBUG 内，Release 可能带入 SecretKey"))
            checks.append(_check("debug_config_no_secret_outside_debug", not a["secret_outside_debug"],
                                 "SecretKey 不在 #if DEBUG 之外" if not a["secret_outside_debug"]
                                 else "有非空 secretKey 写在 #if DEBUG 之外"))
            if sdkappid is not None:
                ok = a["sdk_app_id"] == sdkappid
                checks.append(_check("debug_config_sdkappid", ok,
                                     "TRTCDebugConfig.sdkAppID 与已确认的 SDKAppID 一致" if ok
                                     else "TRTCDebugConfig.sdkAppID 与已确认的 SDKAppID 不一致"))
            if prof.get("file_system_synchronized"):
                in_target = True
            else:
                pbx_path = root / prof["xcodeproj"] / "project.pbxproj"
                pbx_text = pbx_path.read_text(encoding="utf-8", errors="replace") if pbx_path.is_file() else ""
                in_target = "TRTCDebugConfig.swift" in pbx_text
            checks.append(_check("debug_config_in_target", in_target,
                                 "TRTCDebugConfig.swift 会参与编译" if in_target
                                 else "TRTCDebugConfig.swift 还没加入 Target，不加入会编译失败（cannot find 'TRTCDebugConfig'）："
                                      "请在 Xcode 里把它拖进 Target 并勾选 Add to targets",
                                 level="warn"))
            checks.append(_check("secret_key_filled", a["secret_filled"],
                                 "secretKey 已填写（内容未读取、未显示）" if a["secret_filled"]
                                 else "secretKey 还是空的，运行前你需要自己在该文件里填写", level="warn"))
            rel = str(dbg.relative_to(root))
            checks.append(_check("gitignore_debug_config", bool(prof["existing"]["gitignore_has_debug_config"]),
                                 ".gitignore 已忽略 Debug/TRTCDebugConfig.swift" if prof["existing"]["gitignore_has_debug_config"]
                                 else ".gitignore 缺少 Debug/TRTCDebugConfig.swift，SecretKey 可能被提交"))
            tracked = _git_tracked(root, rel)
            if tracked is not None:
                checks.append(_check("debug_config_not_tracked", not tracked,
                                     "TRTCDebugConfig.swift 未被 git 跟踪" if not tracked
                                     else "TRTCDebugConfig.swift 已被 git 跟踪，需要 git rm --cached 并重置 SecretKey"))

        qt = prof["existing"].get("quick_test_path")
        if qt:
            if prof.get("file_system_synchronized"):
                qt_in_target = True
            else:
                pbx_p = root / prof["xcodeproj"] / "project.pbxproj"
                qt_in_target = "TRTCQuickTestView.swift" in (
                    pbx_p.read_text(encoding="utf-8", errors="replace") if pbx_p.is_file() else "")
            checks.append(_check("quick_test_in_target", qt_in_target,
                                 "TRTCQuickTestView.swift 会参与编译" if qt_in_target
                                 else "TRTCQuickTestView.swift 还没加入 Target，请在 Xcode 里把它拖进 Target 并勾选 Add to targets",
                                 level="warn"))
            checks.append(_check("quick_test_remove_before_release", False,
                                 f"{qt} 是本地联调用的验证页：上线前请删除它，并把 App 入口还原成你自己的根视图",
                                 level="warn"))

        leaks = []
        for f in _walk(root, (".swift",)):
            if f.name == "TRTCDebugConfig.swift":
                continue
            try:
                for i, line in enumerate(f.read_text(encoding="utf-8", errors="replace").splitlines(), 1):
                    if SECRET_LITERAL_RE.search(line):
                        leaks.append(f"{f.relative_to(root)}:{i}")
            except OSError:
                continue
        checks.append(_check("no_secret_literal_in_source", not leaks,
                             "源码里没有疑似 SecretKey 的字面量" if not leaks
                             else "以下位置疑似写了 SecretKey 字面量（内容未显示）：" + ", ".join(leaks[:10])))
    return _summarize(checks)


def _summarize(checks: list) -> dict:
    failed = [c for c in checks if not c["ok"] and c["level"] == "error"]
    warned = [c for c in checks if not c["ok"] and c["level"] == "warn"]
    return {"ok": not failed, "failed": len(failed), "warnings": len(warned), "checks": checks}


def _build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--project-root", type=Path, required=True)
    p.add_argument("--sdkappid", type=int)
    p.add_argument("--media-type", choices=["audio", "video", "both"], default="both")
    p.add_argument("--variant", choices=["local-dev"], default="local-dev")
    p.add_argument("--xcodeproj", help="多个 .xcodeproj 时指定要检查的那个（文件名，如 App.xcodeproj）")
    p.add_argument("--target", help="多个 App target 时指定要检查的那个")
    return p


def main() -> int:
    a = _build_parser().parse_args()
    result = verify(a.project_root, a.sdkappid, a.media_type, a.variant, a.xcodeproj, a.target)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
