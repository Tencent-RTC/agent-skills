#!/usr/bin/env python3
"""Validate this skill locally without network, credentials or project mutations."""

import argparse
import ast
import json
import re
import sys
from pathlib import Path
from urllib.parse import unquote, urlsplit

sys.dont_write_bytecode = True


def validate(root, acceptance_file=None):
    errors = []
    paths = list(root.rglob("*"))
    links = [path for path in paths if path.is_symlink()]
    if root.is_symlink() or links:
        return ["Symlinks are not allowed; validation stopped before reading file contents"]
    if any(not path.resolve().is_relative_to(root.resolve()) for path in paths):
        return ["Resolved path escapes the skill root; validation stopped"]
    files = [path for path in paths if path.is_file() and path.name != ".DS_Store"]
    skill = root / "SKILL.md"
    if not skill.is_file():
        return ["Missing SKILL.md"]
    text = skill.read_text(encoding="utf-8")
    frontmatter = re.match(r"\A---\n(.*?)\n---\n", text, re.S)
    if not frontmatter:
        errors.append("Invalid YAML frontmatter boundaries")
    else:
        fields = {}
        for line in frontmatter.group(1).splitlines():
            key, sep, value = line.partition(":")
            if sep:
                fields[key.strip()] = value.strip().strip('"')
        if fields.get("name") != "trtc-chat-ios" or root.name != "trtc-chat-ios":
            errors.append("Name and directory must be trtc-chat-ios")
        if len(fields.get("description", "")) < 80:
            errors.append("Description must cover concrete trigger conditions")
        if not re.fullmatch(r"\d+\.\d+\.\d+", fields.get("version", "")):
            errors.append("Missing semantic version")
    if len(text.splitlines()) > 100 or len(text) > 4500:
        errors.append("SKILL.md exceeds the routing-only size budget")

    for path in files:
        rel = path.relative_to(root)
        if path.is_symlink() or "__pycache__" in rel.parts:
            errors.append(f"Unexpected packaged artifact: {rel}")
        if path.suffix not in {".md", ".py", ".json", ".swift"}:
            errors.append(f"Unexpected file type: {rel}")
            continue
        content = path.read_text(encoding="utf-8")
        if any(("/" + name + "/") in content for name in ("Users", "Applications")):
            errors.append(f"Machine-specific path in {rel}")
        if ("[" + "TODO:") in content:
            errors.append(f"Unfinished template in {rel}")
        if path.suffix == ".py":
            try:
                ast.parse(content)
            except SyntaxError as exc:
                errors.append(f"Python syntax: {rel}: {exc}")
        if path.suffix == ".md":
            if len(re.findall(r"^```", content, re.M)) % 2:
                errors.append(f"Unclosed code fence in {rel}")
            for link in re.findall(r"\[[^\]]+\]\(([^)]+)\)", content):
                parts = urlsplit(link)
                if parts.scheme or parts.netloc or not parts.path:
                    continue
                target = (path.parent / unquote(parts.path)).resolve()
                try:
                    target.relative_to(root.resolve())
                except ValueError:
                    errors.append(f"Non-portable reference in {rel}: {link}")
                    continue
                if not target.is_file():
                    errors.append(f"Broken reference in {rel}: {link}")

    required = {
        "references/app/integration.md", "references/app/customization.md",
        "references/shared/troubleshooting.md", "references/shared/constraints.md",
        "references/shared/boundaries.md", "references/app/demo-data.md",
        "references/shared/api-map.md", "references/maintenance/suite-integration.md",
        "references/source/index.md", "references/source/architecture.md",
        "references/source/workflow.md", "references/source/lessons.md",
        "references/source/tasks.json", "scripts/locate_source.py",
        "references/examples/ChatIntegration.swift", "references/examples/CustomMessage.swift", "references/examples/DebugSignature.swift",
        "references/shared/credentials.md", "references/shared/versions.md",
    }
    modules = ("messages", "input", "conversations", "contacts", "settings", "theme", "navigation")
    required.update(f"references/source/modules/{module}.md" for module in modules)
    actual = {str(path.relative_to(root)) for path in files}
    errors.extend(f"Missing resource: {item}" for item in sorted(required - actual))
    for name in modules:
        guide = root / f"references/source/modules/{name}.md"
        if guide.is_file():
            body = guide.read_text(encoding="utf-8")
            for heading in ("何时读取", "首读", "调用链", "修改配方", "不变量", "最小回归"):
                if heading not in body:
                    errors.append(f"Missing module recipe section: {name}: {heading}")
            if len(body) > 6000:
                errors.append(f"Module guide exceeds 6000 characters: {name}")

    task_names = set()
    try:
        from locate_source import load_manifest
        task_names = set(load_manifest(root / "references/source/tasks.json")["tasks"])
    except (ImportError, OSError, ValueError, KeyError, TypeError) as exc:
        errors.append(f"Invalid source index: {exc}")

    cases_file = Path(acceptance_file) if acceptance_file is not None else None
    if cases_file is not None and not cases_file.is_file():
        errors.append(f"Missing acceptance file: {cases_file}")
    if cases_file is not None and cases_file.is_file():
        try:
            data = json.loads(cases_file.read_text(encoding="utf-8"))
            cases = data["cases"]
            ids = [case["id"] for case in cases]
            if len(ids) < 20 or len(ids) != len(set(ids)):
                errors.append("Acceptance cases must contain at least 20 unique IDs")
            for case in cases:
                if not case.get("prompt") or not case.get("expect") or not case.get("reject"):
                    errors.append(f"Incomplete acceptance case: {case.get('id')}")
                for ref in case.get("references", []):
                    target = (root / ref).resolve()
                    if not target.is_relative_to(root.resolve()) or not target.is_file():
                        errors.append(f"Broken acceptance reference: {ref}")
                if case.get("source_task") and case["source_task"] not in task_names:
                    errors.append(f"Unknown source task: {case['source_task']}")
        except (ValueError, KeyError, TypeError) as exc:
            errors.append(f"Invalid acceptance JSON: {exc}")

    forbidden = (
        "ConversationListView(", "ContactListView(", "MessageInputView(",
        "MessageListView(conversationID:", "MessageCellRegistry.",
        "MessageActionIDs.", "ConversationActionIDs.", "TUILogin.",
        "context.config", "context.messageListStore", "ThemeStore.",
    )
    for path in (root / "references/examples").glob("*.swift"):
        content = path.read_text(encoding="utf-8")
        for token in forbidden:
            if token in content:
                errors.append(f"Non-public or wrong-platform API in {path.name}: {token}")
        modules = ("CommonCrypto", "Foundation", "zlib") if path.name == "DebugSignature.swift" else ("AtomicXCore", "TUIChatKit", "UIKit")
        for module in modules:
            if f"import {module}" not in content:
                errors.append(f"Missing import {module} in {path.name}")
        if path.name == "DebugSignature.swift":
            if not content.startswith("#if DEBUG\n") or not content.rstrip().endswith("#endif"):
                errors.append("Debug signature must be excluded from Release")
        elif "showsNavigationBar:" in content:
            errors.append(f"Version-dependent navigation parameter in common template: {path.name}")
    return errors


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--acceptance-file", type=Path, help="Maintainer-only acceptance JSON outside the distributed Skill")
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    errors = validate(root, args.acceptance_file)
    if errors:
        for error in errors:
            print("FAIL:", error)
        return 1
    print("PASS: metadata, local references, resource layout and Python syntax"
          + ("; acceptance schema" if args.acceptance_file is not None else ""))
    print("NOTE: Swift compilation, model task execution and live IM/UI behavior are separate checks")
    return 0


if __name__ == "__main__":
    sys.exit(main())
