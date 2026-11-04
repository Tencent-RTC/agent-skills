#!/usr/bin/env python3
"""Deterministically inspect an iOS (Swift / CocoaPods) project before TRTC Call integration.

Read-only. Never prints the content of Debug/TRTCDebugConfig.swift.
"""

from __future__ import annotations

import argparse
import json
import re
import shutil
from pathlib import Path
from typing import Any, Optional

SCHEMA_VERSION = 1
MIN_IOS = (14, 0)
SKIP_DIRS = {"Pods", "build", "DerivedData", ".git", "node_modules", "Carthage", ".build",
             # AI 助手把 skill 装进用户工程时的目录；里面带有 templates/*.swift，
             # 不是用户代码，必须排除，否则会被误判为"已有 TRTCDebugConfig.swift"、影响语言/UI 判断。
             ".claude", ".codex", ".cursor", ".codebuddy", ".agents", ".trtc-call", ".trtc-skill-state"}

_BLOCK_RE = re.compile(r"^\t\t([0-9A-Fa-f]{24})(?: /\*.*?\*/)? = \{\n(.*?)^\t\t\};", re.M | re.S)
_SETTING_RE = r"^\s*{key}\s*=\s*(.+?);\s*$"


def parse_version(text: Optional[str]) -> Optional[tuple]:
    if not text:
        return None
    m = re.match(r"^\s*(\d+)(?:\.(\d+))?", text.strip().strip("\"'"))
    if not m:
        return None
    return (int(m.group(1)), int(m.group(2) or 0))


def _walk(root: Path, suffixes: tuple) -> list:
    out = []
    for p in sorted(root.rglob("*")):
        if any(part in SKIP_DIRS for part in p.relative_to(root).parts):
            continue
        if p.is_file() and p.suffix in suffixes:
            out.append(p)
    return out


def _blocks(pbx_text: str) -> dict:
    return {m.group(1): m.group(2) for m in _BLOCK_RE.finditer(pbx_text)}


def _isa(body: str) -> Optional[str]:
    m = re.search(r"^\s*isa = (\w+);", body, re.M)
    return m.group(1) if m else None


def _setting(body: str, key: str) -> Optional[str]:
    m = re.search(_SETTING_RE.format(key=re.escape(key)), body, re.M)
    if not m:
        return None
    return m.group(1).strip().strip('"')


def _config_ids(blocks: dict, list_id: str) -> list:
    body = blocks.get(list_id, "")
    m = re.search(r"buildConfigurations = \((.*?)\);", body, re.S)
    if not m:
        return []
    return re.findall(r"([0-9A-Fa-f]{24})", m.group(1))


def parse_pbxproj(pbx_text: str) -> dict:
    """Return app targets with their per-configuration build settings."""
    blocks = _blocks(pbx_text)
    project_cfgs: list = []
    order: list = []
    for body in blocks.values():
        if _isa(body) == "PBXProject":
            m = re.search(r"buildConfigurationList = ([0-9A-Fa-f]{24})", body)
            if m:
                project_cfgs = _config_ids(blocks, m.group(1))
            tm = re.search(r"\btargets = \((.*?)\);", body, re.S)
            if tm:
                order = re.findall(r"([0-9A-Fa-f]{24})", tm.group(1))
    # 按 PBXProject.targets 的声明顺序遍历（"默认第一个"才稳定）；没有该列表时退回文本顺序。
    ordered = [(i, blocks[i]) for i in order if i in blocks] or list(blocks.items())
    targets = []
    for _id, body in ordered:
        if _isa(body) != "PBXNativeTarget":
            continue
        # 只认主 App：精确匹配 productType，避免把 watchOS App、App Clip 当成 App target。
        if not re.search(r'productType = "?com\.apple\.product-type\.application"?;', body):
            continue
        name_m = re.search(r"^\s*name = (.+?);", body, re.M)
        name = name_m.group(1).strip().strip('"') if name_m else None
        lm = re.search(r"buildConfigurationList = ([0-9A-Fa-f]{24})", body)
        cfgs = _config_ids(blocks, lm.group(1)) if lm else []
        targets.append({"name": name, "configs": [blocks[c] for c in cfgs if c in blocks]})
    return {
        "targets": targets,
        "project_configs": [blocks[c] for c in project_cfgs if c in blocks],
        "file_system_synchronized": "PBXFileSystemSynchronizedRootGroup" in pbx_text,
    }


def _collect(configs: list, key: str) -> list:
    return [v for v in (_setting(c, key) for c in configs) if v is not None]


def _podfile_info(root: Path) -> dict:
    info: dict[str, Any] = {
        "exists": False, "platform_version": None, "has_use_frameworks": False,
        "has_post_install": False, "has_sandbox_fix": False, "has_force_deployment_override": False,
        "tuicallkit_line": None, "tuicallkit_version": None, "locked_version": None, "lock_exists": False,
    }
    pf = root / "Podfile"
    if pf.is_file():
        text = pf.read_text(encoding="utf-8", errors="replace")
        code = "\n".join(l for l in text.splitlines() if not l.strip().startswith("#"))
        info["exists"] = True
        m = re.search(r"^\s*platform\s+:ios\s*,\s*['\"]([\d.]+)['\"]", code, re.M)
        info["platform_version"] = m.group(1) if m else None
        info["has_use_frameworks"] = bool(re.search(r"^\s*use_frameworks!", code, re.M))
        info["has_post_install"] = bool(re.search(r"^\s*post_install\s+do\b", code, re.M))
        info["has_sandbox_fix"] = "ENABLE_USER_SCRIPT_SANDBOXING" in code
        info["has_force_deployment_override"] = ("pods_project" in code and "IPHONEOS_DEPLOYMENT_TARGET" in code)
        pm = re.search(r"^\s*pod\s+['\"]TUICallKit_Swift['\"](?:\s*,\s*['\"]([^'\"]+)['\"])?", code, re.M)
        if pm:
            info["tuicallkit_line"] = pm.group(0).strip()
            info["tuicallkit_version"] = pm.group(1)
    lock = root / "Podfile.lock"
    if lock.is_file():
        info["lock_exists"] = True
        lm = re.search(r"^\s+- TUICallKit_Swift \(([\d.]+)\)", lock.read_text(encoding="utf-8", errors="replace"), re.M)
        info["locked_version"] = lm.group(1) if lm else None
    return info


def _gitignore_has(root: Path, entry: str) -> bool:
    gi = root / ".gitignore"
    if not gi.is_file():
        return False
    return any(entry in line for line in gi.read_text(encoding="utf-8", errors="replace").splitlines()
               if not line.strip().startswith("#"))


def _flutter_ios_markers(root: Path) -> list:
    """Flutter 项目的 `ios/` 子目录（flutter create 生成的 Runner）的稳定特征。

    只认 Flutter 自己生成的两样东西：`Flutter/Generated.xcconfig`，以及 Podfile 里的
    `flutter_install_all_ios_pods`。Add-to-App 的原生宿主工程用的是 `install_all_flutter_pods`，
    不会命中，仍按原生工程处理。
    """
    found = []
    if (root / "Flutter" / "Generated.xcconfig").is_file():
        found.append("Flutter/Generated.xcconfig")
    pf = root / "Podfile"
    if pf.is_file():
        code = "\n".join(l for l in pf.read_text(encoding="utf-8", errors="replace").splitlines()
                         if not l.strip().startswith("#"))
        if "flutter_install_all_ios_pods" in code:
            found.append("Podfile 里的 flutter_install_all_ios_pods")
    return found


def probe(root: Path, xcodeproj: Optional[str] = None, app_target: Optional[str] = None) -> dict:
    root = root.resolve()
    blockers: list = []
    warnings: list = []

    projects = [p for p in sorted(root.glob("*.xcodeproj")) if p.is_dir()]
    workspaces = [p for p in sorted(root.glob("*.xcworkspace")) if p.is_dir()]
    profile: dict[str, Any] = {
        "schema_version": SCHEMA_VERSION, "platform": "ios", "project_root": str(root),
        "xcodeproj": projects[0].name if projects else None,
        "xcworkspace": workspaces[0].name if workspaces else None,
        "app_target": None, "app_targets": [], "deployment_target": None,
        "deployment_ok": None, "info_plist_form": "unknown", "info_plist_path": None,
        "app_source_dir": None, "file_system_synchronized": False,
        "ui_framework": "unknown", "language": "unknown",
        "podfile": {}, "existing": {}, "blockers": blockers, "warnings": warnings,
    }

    flutter_markers = _flutter_ios_markers(root)
    if flutter_markers:
        blockers.append({
            "code": "flutter-host",
            "message": ("当前目录是 Flutter 项目的 ios 子目录（检测到 " + "、".join(flutter_markers) + "）。"
                        "Flutter 项目的通话集成要把项目路径切换到 Flutter 项目根目录（含 pubspec.yaml 的那一层），"
                        "不能在 ios 子目录里按原生 iOS 接入。请切换后重新发起。"),
        })
        return profile

    if not projects:
        blockers.append({"code": "no-xcodeproj", "message": "项目根目录下没有 .xcodeproj，不是 iOS 原生工程，或路径不对。"})
        return profile
    chosen = projects[0]
    if xcodeproj:
        match = [p for p in projects if p.name == xcodeproj]
        if not match:
            blockers.append({"code": "xcodeproj-not-found",
                             "message": f"指定的 {xcodeproj} 不在项目根目录下，可选：{[p.name for p in projects]}。"})
            return profile
        chosen = match[0]
    elif len(projects) > 1:
        warnings.append({"code": "multiple-xcodeproj",
                         "message": f"存在多个 .xcodeproj：{[p.name for p in projects]}，默认取 {projects[0].name}，"
                                    "请向用户确认要接入哪一个，再带 --xcodeproj 重跑。"})
    profile["xcodeproj"] = chosen.name

    pbx_path = chosen / "project.pbxproj"
    if not pbx_path.is_file():
        blockers.append({"code": "no-pbxproj", "message": "找不到 project.pbxproj。"})
        return profile
    parsed = parse_pbxproj(pbx_path.read_text(encoding="utf-8", errors="replace"))
    profile["file_system_synchronized"] = parsed["file_system_synchronized"]
    names = [t["name"] for t in parsed["targets"] if t["name"]]
    profile["app_targets"] = names
    if not parsed["targets"]:
        blockers.append({"code": "no-app-target", "message": "没有找到 application target。"})
        return profile
    target = parsed["targets"][0]
    if app_target:
        match_t = [t for t in parsed["targets"] if t["name"] == app_target]
        if not match_t:
            blockers.append({"code": "target-not-found",
                             "message": f"指定的 App target {app_target} 不存在，可选：{names}。"})
            return profile
        target = match_t[0]
    elif len(names) > 1:
        warnings.append({"code": "multiple-app-targets",
                         "message": f"有多个 App target：{names}，默认取第一个 {names[0]}，"
                                    "请向用户确认要接入哪一个，再带 --target 重跑（部署版本、Info.plist、源码目录都按所选 target 计算）。"})
    profile["app_target"] = target["name"]
    cfgs = target["configs"]

    # 部署版本：先看 target，再回退到工程级；取各配置里最小值。
    dts = _collect(cfgs, "IPHONEOS_DEPLOYMENT_TARGET") or _collect(parsed["project_configs"], "IPHONEOS_DEPLOYMENT_TARGET")
    versions = [v for v in (parse_version(x) for x in dts) if v]
    if versions:
        low = min(versions)
        profile["deployment_target"] = f"{low[0]}.{low[1]}"
        profile["deployment_ok"] = low >= MIN_IOS
        if not profile["deployment_ok"]:
            warnings.append({"code": "deployment-too-low",
                             "message": f"主 App 部署版本 {profile['deployment_target']} 低于 14.0，需用户在 Xcode 里调高。"})

    # Info.plist 形态
    plist_files = _collect(cfgs, "INFOPLIST_FILE")
    generated = [g.upper() == "YES" for g in _collect(cfgs, "GENERATE_INFOPLIST_FILE")]
    if plist_files:
        profile["info_plist_form"] = "file"
        rel = plist_files[0].replace("$(SRCROOT)/", "").replace("${SRCROOT}/", "")
        profile["info_plist_path"] = rel
        if not (root / rel).is_file():
            warnings.append({"code": "info-plist-missing", "message": f"INFOPLIST_FILE 指向的 {rel} 不存在。"})
    elif generated and all(generated):
        profile["info_plist_form"] = "generated"

    # 源码目录
    src = None
    if profile["info_plist_path"]:
        d = (root / profile["info_plist_path"]).parent
        if d.is_dir() and d != root:
            src = d
    if src is None and target["name"] and (root / target["name"]).is_dir():
        src = root / target["name"]
    profile["app_source_dir"] = str(src.relative_to(root)) if src else None

    # 语言与 UI 框架
    swift = _walk(root, (".swift",))
    objc = _walk(root, (".m", ".mm"))
    if swift and objc:
        profile["language"] = "mixed"
    elif swift:
        profile["language"] = "swift"
    elif objc:
        profile["language"] = "objc"
        blockers.append({"code": "objc-only", "message": "纯 Objective-C 工程：TUICallKit_Swift 的核心方法没有 @objc，无法直接调用。"})
    swiftui = uikit = False
    profile["app_entry_file"] = None
    for f in swift[:300]:
        try:
            text = f.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        if re.search(r"\bstruct\s+\w+\s*:\s*App\b", text):
            swiftui = True
            if profile["app_entry_file"] is None and "@main" in text and "WindowGroup" in text:
                profile["app_entry_file"] = str(f.relative_to(root))
        if re.search(r"\bUIApplicationDelegate\b|\bUIWindowSceneDelegate\b|\bUIViewController\b", text):
            uikit = True
    if swiftui and uikit:
        profile["ui_framework"] = "mixed"
    elif swiftui:
        profile["ui_framework"] = "swiftui"
    elif uikit:
        profile["ui_framework"] = "uikit"

    profile["podfile"] = _podfile_info(root)
    if not profile["podfile"]["exists"]:
        warnings.append({"code": "no-podfile", "message": "没有 Podfile（TUICallKit_Swift 仅支持 CocoaPods）。可征得用户同意后，在工程目录用 pod init 创建。"})
        if shutil.which("pod") is None:
            warnings.append({"code": "no-cocoapods", "message": "本机没有找到 pod 命令（CocoaPods 未安装），无法自动创建 Podfile，也无法执行 pod install。"})
    tk = profile["podfile"].get("tuicallkit_version")
    if profile["podfile"].get("tuicallkit_line") and tk != "4.2.1":
        warnings.append({"code": "tuicallkit-version-mismatch",
                         "message": f"Podfile 里已有 TUICallKit_Swift，版本为 {tk!r}，不是固定的 4.2.1，需向用户确认。"})
    if profile["podfile"].get("has_force_deployment_override"):
        warnings.append({"code": "force-deployment-override",
                         "message": "Podfile 里有强制覆盖 Pods 部署版本的写法，会引发崩溃，建议用户移除。"})

    dbg = [p for p in _walk(root, (".swift",)) if p.name == "TRTCDebugConfig.swift"]
    qt = [p for p in _walk(root, (".swift",)) if p.name == "TRTCQuickTestView.swift"]
    profile["existing"] = {
        "debug_config_path": str(dbg[0].relative_to(root)) if dbg else None,
        "quick_test_path": str(qt[0].relative_to(root)) if qt else None,
        "gitignore_has_debug_config": _gitignore_has(root, "Debug/TRTCDebugConfig.swift"),
        "is_git_repo": (root / ".git").exists(),
    }
    return profile


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project-root", type=Path, required=True)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--xcodeproj", help="目录下有多个 .xcodeproj 时，用户选定的那个（文件名，如 App.xcodeproj）")
    parser.add_argument("--target", help="有多个 App target 时，用户选定的 target 名")
    return parser


def main() -> int:
    args = _build_parser().parse_args()
    profile = probe(args.project_root, xcodeproj=args.xcodeproj, app_target=args.target)
    out = json.dumps(profile, ensure_ascii=False, indent=2, sort_keys=True)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(out + "\n", encoding="utf-8")
    print(out)
    return 0 if not profile["blockers"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
