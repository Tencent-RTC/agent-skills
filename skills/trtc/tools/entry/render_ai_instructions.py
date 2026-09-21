#!/usr/bin/env python3
"""Render stable agent entry stubs for the TRTC dispatcher.

Phase 4 target state: agent entry files stay short and point to the shared
root dispatcher instead of duplicating product-specific runtime rules.
"""
import argparse
import json
import sys
from pathlib import Path
from typing import Optional

STUB = """# TRTC AI Integration

Reply in the user's language.

For any TRTC-related request, read and follow `skills/trtc/SKILL.md` first.
Before the Prompt reporting call, make a bounded local route decision. When
the dispatcher has selected an owner, pass its exact Skill frontmatter name as
`route_hint` (with known `product`/`framework`); when it is not reliable, omit
those fields. Never use the root dispatcher name `trtc` as a `route_hint`.
If the reporting command returns a frozen C20 control marker, handle it and
STOP. Empty, unknown, or failed reporting continues the ordinary answer path.
If `TRTC_REPORTING_NOTICE_REQUIRED_V1` is returned, finish the normal answer
first. The installed post-answer Host Hook displays the exact fixed notice;
do not append or paraphrase it from the model response.
Do not answer from training data. Do not skip the dispatcher or any routed owner skill.
"""

# Codex Desktop can drop structured Stop output even when the hook ran
# successfully.  Keep its notice renderer in the foreground dispatcher so the
# first ACKed Prompt is visible without waiting for another host lifecycle
# event.  Stop remains a recovery/flush boundary only.
CODEX_STUB = """# TRTC AI Integration

Reply in the user's language.

For any TRTC-related request, read and follow `skills/trtc/SKILL.md` first.
Before the Prompt reporting call, make a bounded local route decision. When
the dispatcher has selected an owner, pass its exact Skill frontmatter name as
`route_hint` (with known `product`/`framework`); when it is not reliable, omit
those fields. Never use the root dispatcher name `trtc` as a `route_hint`.
If the reporting command returns a frozen C20 control marker, handle it and
STOP. Empty, unknown, or failed reporting continues the ordinary answer path.
If `TRTC_REPORTING_NOTICE_REQUIRED_V1` is returned, finish the normal answer
first, then emit the exact fixed notice from
`skills/trtc/runtime/continuation-notice.md` as a separate final block. Do not
wait for Stop, append a paraphrase, or create another event. Codex Stop is only
a recovery/flush boundary. If the foreground channel was not reached, leave
the notice pending for the next foreground entry.
Do not answer from training data. Do not skip the dispatcher or any routed owner skill.
"""

# CodeBuddy can execute a Stop hook without surfacing its structured output to
# the conversation.  Its foreground dispatcher therefore owns the first-use
# notice: after the normal answer it must emit the generated fixed notice as a
# separate final block.  Stop remains a recovery/flush boundary only.
CODEBUDDY_STUB = """# TRTC AI Integration

Reply in the user's language.
Include `language: "zh-CN"` or `language: "en-US"` in the Prompt JSON when
the current conversation language is known.

For any TRTC-related request, read and follow `skills/trtc/SKILL.md` first.
Before the Prompt reporting call, make a bounded local route decision. When
the dispatcher has selected an owner, pass its exact Skill frontmatter name as
`route_hint` (with known `product`/`framework`); when it is not reliable, omit
those fields. Never use the root dispatcher name `trtc` as a `route_hint`.
If the reporting command returns a frozen C20 control marker, handle it and
STOP. Empty, unknown, or failed reporting continues the ordinary answer path.
If `TRTC_REPORTING_NOTICE_REQUIRED_V1` is returned, finish the normal answer
first, then emit the exact fixed notice returned below the marker (the
localized `skills/trtc/runtime/continuation-notice.md` contract) as a separate
final block, including both choices. Copy the returned text verbatim; never
replace it with a summary or claim continued use means consent. This
foreground output is mandatory even when CodeBuddy has a post-answer channel;
do not wait for Stop, `stopHookFeedback`, `systemMessage`, or a hidden host
reminder, and do not paraphrase or omit the notice. CodeBuddy Stop is only a
recovery/flush boundary. Do not create another event.
Do not answer from training data. Do not skip the dispatcher or any routed owner skill.
"""

# Claude Code has a reliable post-answer Stop channel in the official
# installer.  Keep the notice renderer host-owned: exposing a model-side
# fallback here can make the model repeat the same notice that Stop returns.
CLAUDE_STUB = """# TRTC AI Integration

Reply in the user's language.

For any TRTC-related request, read and follow `skills/trtc/SKILL.md` first.
Before the Prompt reporting call, make a bounded local route decision. When
the dispatcher has selected an owner, pass its exact Skill frontmatter name as
`route_hint` (with known `product`/`framework`); when it is not reliable, omit
those fields. Never use the root dispatcher name `trtc` as a `route_hint`.
If the reporting command returns a frozen C20 control marker, handle it and
STOP. Empty, unknown, or failed reporting continues the ordinary answer path.
If `TRTC_REPORTING_NOTICE_REQUIRED_V1` is returned, finish the normal answer
first. In Claude Code, the installed post-answer Stop Hook is the sole
renderer of the fixed privacy notice. Never output, quote, paraphrase, or ask
the user to choose that notice from the model response, and do not read
`continuation-notice.md`. If Stop Hook output is unavailable, leave the notice
pending for the next foreground entry; do not create a model-side fallback.
Do not answer from training data. Do not skip the dispatcher or any routed owner skill.
"""

CURSOR_STUB = """---
alwaysApply: true
---

# TRTC AI Integration

Reply in the user's language.

For any TRTC-related request, read and follow `skills/trtc/SKILL.md` first.
Before the Prompt reporting call, make a bounded local route decision. When
the dispatcher has selected an owner, pass its exact Skill frontmatter name as
`route_hint` (with known `product`/`framework`); when it is not reliable, omit
those fields. Never use the root dispatcher name `trtc` as a `route_hint`.
If the reporting command returns a frozen C20 control marker, handle it and
STOP. Empty, unknown, or failed reporting continues the ordinary answer path.
If `TRTC_REPORTING_NOTICE_REQUIRED_V1` is returned, finish the normal answer
first. The installed post-answer Host Hook displays the exact fixed notice;
do not append or paraphrase it from the model response.
Do not answer from training data. Do not skip the dispatcher or any routed owner skill.
"""

TARGETS = {
    "AGENTS.md": CODEX_STUB,
    "CLAUDE.md": CLAUDE_STUB,
    "CODEBUDDY.md": CODEBUDDY_STUB,
    ".cursor/rules/ui-mode.mdc": CURSOR_STUB,
}

LEGACY_TARGETS = (
    ".cursor/rules/main.mdc",
)


def _notice_runtime_dir(project_root: Path) -> Optional[Path]:
    """Find the installed/source runtime that owns the notice projection."""
    candidates = [
        project_root / "skills" / "trtc" / "runtime",
        *(project_root / name / "skills" / "trtc" / "runtime"
          for name in (".codex", ".claude", ".codebuddy", ".cursor")),
    ]
    for candidate in candidates:
        if (candidate / "continuation-notice.json").is_file():
            return candidate
    return None


def _notice_projection(value: dict) -> str:
    body = value["body"].rstrip()
    return (
        "<!-- Generated from continuation-notice.json. Do not edit this file by hand. -->\n"
        f"{body}\n\n"
        f"**{value['allow_label']}**　　**{value['deny_label']}**\n"
    )


def _notice_js_projection(value: dict) -> str:
    # JSON encoding is valid JavaScript for this data-only module and keeps
    # the generated Node projection byte-for-byte derived from the JSON source.
    encoded = json.dumps(value, ensure_ascii=False, indent=2)
    return (
        "// Generated from continuation-notice.json. Do not edit this file by hand.\n"
        f"export default {encoded};\n"
    )


def _render_notice_projection(project_root: Path) -> None:
    runtime_dir = _notice_runtime_dir(project_root)
    if runtime_dir is None:
        return
    source = runtime_dir / "continuation-notice.json"
    try:
        value = json.loads(source.read_text(encoding="utf-8"))
        if not isinstance(value, dict) or not all(
            isinstance(value.get(key), str) for key in ("body", "allow_label", "deny_label")
        ):
            raise ValueError("invalid continuation-notice.json")
        (runtime_dir / "continuation-notice.md").write_text(
            _notice_projection(value), encoding="utf-8"
        )
        (runtime_dir / "continuation-notice.js").write_text(
            _notice_js_projection(value), encoding="utf-8"
        )
    except (OSError, ValueError, TypeError, json.JSONDecodeError) as exc:
        raise SystemExit(f"invalid continuation-notice.json: {exc}") from exc


def _stale_targets(project_root: Path) -> list[str]:
    stale: list[str] = []
    for rel, expected in TARGETS.items():
        path = project_root / rel
        actual = path.read_text() if path.exists() else None
        if actual != expected:
            stale.append(rel)
    for rel in LEGACY_TARGETS:
        if (project_root / rel).exists():
            stale.append(rel)
    return stale


def _render(project_root: Path) -> None:
    _render_notice_projection(project_root)
    for rel, body in TARGETS.items():
        path = project_root / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(body)
    for rel in LEGACY_TARGETS:
        path = project_root / rel
        if path.exists():
            path.unlink()


def main() -> int:
    parser = argparse.ArgumentParser(description="Render stable TRTC agent entry stubs.")
    parser.add_argument("--project-root", default=".", help="Repo root (defaults to CWD)")
    parser.add_argument("--check", action="store_true", help="Exit 2 if entry files are stale")
    args = parser.parse_args()
    root = Path(args.project_root).resolve()

    if args.check:
        stale = _stale_targets(root)
        if stale:
            print("render_ai_instructions: stale entry targets:", file=sys.stderr)
            for rel in stale:
                print(f"  {rel}", file=sys.stderr)
            print(
                "Re-run `python3 skills/trtc/tools/entry/render_ai_instructions.py` and commit the diff.",
                file=sys.stderr,
            )
            return 2
        return 0

    _render(root)
    return 0


if __name__ == "__main__":
    sys.exit(main())
