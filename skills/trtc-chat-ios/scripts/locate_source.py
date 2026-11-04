#!/usr/bin/env python3
"""Return one task's bounded source entry points. No network or source mutation."""

import argparse
import json
import re
import sys
from pathlib import Path, PurePosixPath

SKILL_ROOT = Path(__file__).resolve().parents[1]
MANIFEST = SKILL_ROOT / "references/source/tasks.json"
MAX_PRIMARY_FILES = 4
MAX_FILE_BYTES = 2 * 1024 * 1024


class LocatorError(ValueError):
    pass


def safe_path(root, relative):
    if not isinstance(relative, str) or not relative or "\\" in relative:
        raise LocatorError("Invalid relative path")
    path = PurePosixPath(relative)
    if path.is_absolute() or ".." in path.parts:
        raise LocatorError("Path must remain within the supplied root")
    result = root.joinpath(*path.parts).resolve()
    try:
        result.relative_to(root.resolve())
    except ValueError as exc:
        raise LocatorError("Path or symlink escapes the supplied root") from exc
    return result


def read_bounded(path):
    with path.open("rb") as stream:
        data = stream.read(MAX_FILE_BYTES + 1)
    if len(data) > MAX_FILE_BYTES:
        raise LocatorError("File exceeds the source inspection limit")
    return data.decode("utf-8", errors="replace")


def swift_code(text):
    parts = []
    i = 0
    while i < len(text):
        if text.startswith("//", i):
            end = text.find("\n", i)
            i = len(text) if end < 0 else end
            parts.append(" ")
        elif text.startswith("/*", i):
            depth = 1
            i += 2
            while i < len(text) and depth:
                if text.startswith("/*", i):
                    depth += 1
                    i += 2
                elif text.startswith("*/", i):
                    depth -= 1
                    i += 2
                else:
                    if text[i] == "\n":
                        parts.append("\n")
                    i += 1
            parts.append(" ")
        else:
            match = re.match(r'(#{0,16})("{3}|")', text[i:]) if text[i] in '#"' else None
            if match:
                hashes, quote = match.groups()
                i += len(match.group())
                closing = quote + hashes
                while i < len(text):
                    if text.startswith("\\" + hashes, i):
                        i += len(hashes) + 2
                    elif text.startswith(closing, i):
                        i += len(closing)
                        break
                    else:
                        if text[i] == "\n":
                            parts.append("\n")
                        i += 1
                parts.append(" ")
            else:
                parts.append(text[i])
                i += 1
    return "".join(parts)


def load_manifest(path=MANIFEST):
    manifest = json.loads(read_bounded(path))
    if manifest.get("schema_version") != 1 or not isinstance(manifest.get("tasks"), dict):
        raise LocatorError("Unsupported source index schema")
    for name, task in manifest["tasks"].items():
        if not re.fullmatch(r"[a-z]+(?:-[a-z]+)*", name):
            raise LocatorError("Invalid task identifier")
        guide = safe_path(SKILL_ROOT, task["guide"])
        if not guide.is_file():
            raise LocatorError("Source guide is missing: " + task["guide"])
        entries = task.get("primary", [])
        choices = task.get("choose_modules", [])
        if choices:
            if entries or not all(choice in manifest["tasks"] and choice != name for choice in choices):
                raise LocatorError("Module-selection tasks must reference other tasks without entry points")
        elif not 1 <= len(entries) <= MAX_PRIMARY_FILES:
            raise LocatorError("Each task needs one to four entry points")
        if task.get("scope", "ui") not in ("ui", "host"):
            raise LocatorError("Unknown root scope")
        paths = []
        for entry in entries:
            safe_path(SKILL_ROOT, entry["path"])
            paths.append(entry["path"])
            symbols = entry.get("symbols", [])
            if not symbols or not all(isinstance(symbol, str) and symbol for symbol in symbols):
                raise LocatorError("Each entry requires symbol hints")
            if not entry.get("reason"):
                raise LocatorError("Each entry requires a reason")
        if len(set(paths)) != len(paths):
            raise LocatorError("Duplicate entry point")
    return manifest


def chat_page_bodies(code):
    bodies = []
    for match in re.finditer(r"\b(?:class|extension)\s+ChatPage\b[^{}]*\{", code):
        depth = 1
        index = match.end()
        while index < len(code) and depth:
            depth += (code[index] == "{") - (code[index] == "}")
            index += 1
        if depth == 0:
            bodies.append(code[match.end():index - 1])
    return bodies


def public_initializers(code):
    results = []
    for match in re.finditer(r"\bpublic\s+(?:convenience\s+)?init\s*\(", code):
        prefix = code[:match.start()]
        if prefix.count("{") != prefix.count("}"):
            continue
        depth = 1
        index = match.end()
        while index < len(code) and depth:
            depth += (code[index] == "(") - (code[index] == ")")
            index += 1
        if depth == 0:
            results.append(code[match.end():index - 1])
    return results


def parameter_names(parameters):
    segments = []
    start = 0
    depth = 0
    for index, char in enumerate(parameters):
        if char in "([{":
            depth += 1
        elif char in ")]}":
            depth -= 1
        elif char == "," and depth == 0:
            segments.append(parameters[start:index])
            start = index + 1
    segments.append(parameters[start:])
    names = []
    for segment in segments:
        match = re.match(r"\s*(\w+)(?:\s+(\w+))?\s*:", segment)
        if match:
            names.append(match.group(1))
    return names


def inspect_ui_root(supplied):
    supplied = Path(supplied).expanduser().resolve()
    if not supplied.is_dir():
        raise LocatorError("Supplied root is not a directory")
    candidates = [supplied, supplied / "chat/uikit", supplied / "ios/chat/uikit",
                  supplied / "TUIChatKit", supplied / "Pods/TUIChatKit/TUIChatKit"]
    matches = {}
    for candidate in candidates:
        if not candidate.is_dir():
            continue
        candidate = candidate.resolve()
        try:
            candidate.relative_to(supplied)
        except ValueError:
            continue
        spec = safe_path(candidate, "TUIChatKit.podspec")
        spec_ok = spec.is_file() and bool(re.search(
            r"^\s*s\.name\s*=\s*['\"]TUIChatKit['\"]", read_bounded(spec), re.M
        ))
        for relative in ("page/ChatPage.swift", "ChatPage.swift"):
            page = safe_path(candidate, relative)
            if not page.is_file():
                continue
            code = swift_code(read_bounded(page))
            if not re.search(r"\bclass\s+ChatPage\s*:\s*UIViewController\b", code):
                continue
            imports_ok = all(re.search(r"\bimport\s+" + module + r"\b", code)
                             for module in ("UIKit", "AtomicXCore"))
            if not spec_ok and not imports_ok:
                continue
            initializers = [value for body in chat_page_bodies(code) for value in public_initializers(body)]
            conditional = bool(re.search(r"^\s*#(?:if|elseif|else|endif)\b", code, re.M))
            matches[(candidate, relative)] = {
                "root": candidate, "layout": "refactored" if relative.startswith("page/") else "flat",
                "chat_page": relative,
                "supports_shows_navigation_bar": None if conditional else any(
                    "showsNavigationBar" in parameter_names(value) for value in initializers),
                "has_conditional_compilation": conditional,
                "initializer_parameters": [parameter_names(value) for value in initializers],
            }
    if len(matches) != 1:
        raise LocatorError(
            "Expected one imperative UIKit root; found " + str(len(matches))
            + ". Supply the exact UI directory; no recursive discovery is performed."
        )
    return next(iter(matches.values()))


def resolve_ui_root(supplied):
    return inspect_ui_root(supplied)["root"]


def locate(supplied, task_name, check_symbols=False, manifest=None):
    manifest = load_manifest() if manifest is None else manifest
    if task_name not in manifest["tasks"]:
        raise LocatorError("Unknown task: " + task_name)
    task = manifest["tasks"][task_name]
    if task.get("choose_modules"):
        return {"status": "select-module", "task": task_name, "guide": task["guide"],
                "files": [], "choices": task["choose_modules"], "next": task["next"]}
    profile = None
    if task.get("scope") == "host":
        root = Path(supplied).expanduser().resolve()
        marker = safe_path(root, "Pages/Home/HomePage.swift")
        if not marker.is_file() or not re.search(
            r"\bclass\s+HomeTabBarController\s*:\s*UITabBarController\b", swift_code(read_bounded(marker))
        ):
            raise LocatorError("Expected an explicitly supplied Demo Sources root; for another host follow the navigation guide.")
    else:
        profile = inspect_ui_root(supplied)
        root = profile["root"]
    entries = task["primary"]
    if profile and profile["layout"] == "flat" and task_name == "navigation":
        entries = [{"path": profile["chat_page"], "symbols": ["ChatPage"],
                    "reason": "平铺版本页面自身承担导航/布局；先核对当前构造器与生命周期，不寻找不存在的PageImpl"}]
    files = []
    for entry in entries:
        relative = entry["path"]
        if profile and profile["layout"] == "flat" and relative.startswith("page/") and not relative.startswith("page/impl/"):
            relative = PurePosixPath(relative).name
        path = safe_path(root, relative)
        item = {
            "path": relative, "reason": entry["reason"],
            "symbols": entry["symbols"], "status": "present" if path.is_file() else "missing",
        }
        if check_symbols and path.is_file():
            content = swift_code(read_bounded(path))
            missing = [symbol for symbol in entry["symbols"]
                       if not re.search(r"(?<!\w)" + re.escape(symbol) + r"(?!\w)", content)]
            item["missing_symbols"] = missing
            item["status"] = "symbol-missing" if missing else "hints-found"
        files.append(item)
    partial = any(item["status"] in ("missing", "symbol-missing") for item in files)
    return {
        "status": "partial" if partial else "ok", "root": str(root), "task": task_name,
        "guide": task["guide"], "files": files,
        "source_profile": {key: value for key, value in profile.items() if key != "root"} if profile else None,
        "compatibility_guide": "references/shared/versions.md" if profile else None,
        "next": task.get("next", "Read the selected guide before expanding the search."),
        "note": "Paths and symbol hints are navigation evidence, not API compatibility or behavior verification.",
    }


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", help="Existing UI root or repository root; no clone or recursive scan")
    parser.add_argument("--task", help="Exact task identifier from --list")
    parser.add_argument("--check-symbols", action="store_true", help="Read only primary files for literal symbol hints")
    parser.add_argument("--list", action="store_true", help="List task names without reading customer source")
    args = parser.parse_args(argv)
    try:
        manifest = load_manifest()
        if args.list:
            print(json.dumps({"tasks": {key: value["guide"] for key, value in manifest["tasks"].items()}}, ensure_ascii=False, indent=2))
            return 0
        if not args.root or not args.task:
            parser.error("--root and --task are required unless using --list")
        result = locate(args.root, args.task, args.check_symbols, manifest)
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 1 if result["status"] == "partial" else 0
    except (LocatorError, OSError, ValueError, KeyError, TypeError) as exc:
        print(json.dumps({"status": "error", "message": str(exc)}, ensure_ascii=False), file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
