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

_HEADER = """# TRTC AI Integration

Reply in the user's language.

TRTC products covered: Conference, Chat, Call, Live, RTC Engine, Conversational AI (AI customer service / 智能客服 / voice agent / AI oral coach / 口语陪练 / speaking coach scenarios), and TIMPush (离线推送).

For any TRTC-related request, use `skills/trtc/SKILL.md` as the dispatcher after
the prompt-reporting step below.
This file is an installed host bootstrap. The actual TRTC skill lives under
`.{{IDE}}/skills/`; do not treat this file as the skill body.

"""

_REPORTING = """## Experience reporting and privacy

Experience data (Prompts, SDKAppID and business events) requires explicit
agreement. Before agreement, retain only the first redacted real Prompt in
the project-local consent slot; do not upload it, scan SDKAppID for telemetry,
enqueue other Prompts, or backfill other pre-consent turns. A settings/env
"on", silence, continued use, or an ambiguous reply is not agreement.
Installation and Hook activation statistics remain independent: refusing
experience data does not disable them. An explicit request to disable ALL
reporting uses `preference --enabled off --scope all`; an experience-only
opt-out uses `preference --enabled off`. Confirm only a successful result.

For every real TRTC user turn, Host bootstrap, Root and routed owners share
ONE foreground Prompt entry and ONE retry budget. Reuse this turn's existing
entry result across every handoff; an exit-zero call counts even when stdout
is silent. `awaiting_consent`, `prompt/queued` and `prompt/acknowledged` do not
need another Prompt call. Do not replay a Prompt to improve routing, repair
an auxiliary failure or obtain another notice. Hook capture alone does NOT
replace the required foreground entry.

Only if no foreground Prompt entry has been attempted for this user turn,
make a bounded local route decision from the current message, without reading
an owner Skill, network access or SDKAppID scanning. If reliable, include the
owner's exact frontmatter name as `route_hint` and known `product` / `framework`.
Resolve `framework` in this order and never skip it just because the turn looks
like a docs/consulting question: (1) a platform keyword already present in the
user's message; (2) the platform already known for this project and product;
(3) `n-a` when the question has no platform dimension at all (pure
server-side/backend topics: callbacks, persistence, field types, billing,
room-management APIs); (4) omit the field so runtime records `unknown`. Never
guess a platform just to keep the field non-empty; otherwise omit them. Never
use root `trtc` as an owner. Run
`python3 "{{SKILL}}/tools/reporting.py" prompt --input-stdin --require-input`
with a JSON-serialized object piped on stdin:

```json
{"text":"<verbatim user message>","cwd":"<current project root>","ide":"{{IDE}}","route_hint":"<optional owner>","product":"<optional product>","framework":"<optional platform>"}
```

Never interpolate raw Prompt text in shell JSON/argv. If already in the
installed TRTC skill root, use `python3 tools/reporting.py` without repeating
the directory prefix. Empty/invalid stdin must be re-serialized and retried
once; do not claim a failed retry was reported. `awaiting_consent` means local
capture only, never a successful upload. The one retry belongs to the same
entry attempt across Host, Root and owners; a handoff never resets it.

When `TRTC_REPORTING_NOTICE_REQUIRED_V1` is returned, finish the normal business
answer, then append the returned fixed notice verbatim as a separate final
block. If only the marker is returned, copy the locale-matched text from
`{{SKILL}}/runtime/continuation-notice.md`. The notice no longer depends on
a first-Prompt ACK. Do not paraphrase, omit it, put it in the composer, create
a synthetic user turn, or use `followup_message`. Foreground rendering remains
mandatory even when Hooks are inactive. Stop is only a recovery/flush boundary
and never claims another notice. CodeBuddy's visible `systemMessage` fallback
shares the same notice budget. Carry a returned notice requirement across
owner/flow handoffs and render it once in the final response; a handoff must
not lose it or claim another notice. Owner instructions never defer this
foreground notice to a Stop Hook.

Only classify a response when this conversation visibly contains an active
privacy notice and this message responds to it. Natural agreement such as
“可以” or “没问题” is `allow`; clear refusal is `deny`; an unclear reply is
`ambiguous`. If there is no reliable session ID, use the current conversation
to confirm that relationship. A business request which ignores the question
remains business input. A complete fixed notice replay (including both
options, even with whitespace changes) is host output, never a user choice.
Cursor's beforeSubmitPrompt intercepts it with `continue:false`.

A privacy control reply MUST include all four fields, preserving the reply:

```json
{"text":"可以，没问题","control_choice":"allow","cwd":"<current project root>","ide":"{{IDE}}"}
```

Send through the same stdin command, then stop without ordinary Prompt
reporting or routing. `text` is required even for controls; if it is missing,
rebuild the complete envelope and retry once. The old
`prompt --control-choice allow|deny` is a compatibility fallback.
Only confirm agreement/refusal after `TRTC_REPORTING_ALLOWED_V1` /
`TRTC_REPORTING_DISABLED_V1`. A retry marker means the choice was not
confirmed; retry the same local transaction once and never claim success on
failure. Do not ask for an already persisted choice again.

An unanswered or ambiguous response keeps experience reporting OFF. Runtime
offers at most ONE reminder (two presentations total per project). Render a
reminder only when Runtime returns NOTICE_REQUIRED. For an ambiguous reply,
render that fixed reminder immediately; for a new business message, answer
normally and append the returned reminder. After the limit, continue normal
business without repeated questions or uploading experience data. Never
treat this as `defaulted` consent. No control reply is uploaded.

After this entry step, read the dispatcher if it is not already loaded,
then read the routed owner Skill. A routing STOP ends dispatcher selection,
not the owner's work or the shared reporting postlude. Complete the business
work and prepare the normal answer, then run exactly one final owner
`python3 "{{SKILL}}/tools/reporting.py" invoke --skillname "<owner frontmatter name>" --product "<product or unknown>" --framework "<platform, n-a, or unknown>"`.
Run this postlude before sending the final response, using the actual final
owner's frontmatter name, not an intermediate dispatcher or flow. Reuse an
already attempted same-turn owner invoke; neither Root nor a nested owner
starts another invoke. If no owner has run yet (clarification, unsupported
request or control-only turn), do not invent an owner just to invoke it.
Never invoke before reading the owner or invoke Root `trtc`. If Host Stop has
already claimed the same event, do not create a second event/invoke. Render
the prepared answer and any required fixed notice after this shared postlude.
Before a TRTC clarification use `context --question "<exact question>"`. Hooks stage locally
only and never invoke the foreground command or perform network I/O.

"""

_FOOTER = """When a TRTC skill asks you to run `python3 -m tools.<name>`, run it from the
installed TRTC skill root. If already there, run `python3 -m tools.<name> ...`
directly; module names never include a `.py` suffix. Do not prepend
`{{SKILL}}` to a command whose cwd is already that directory.

Do not answer from training data. Do not skip the dispatcher or any routed owner skill.
"""

_CLAUDE_CALLBACK = """Claude Code background `<task-notification>` callbacks and messages explicitly marked as host-internal are not user turns. Do not call prompt reporting or start TRTC routing for these callbacks. If the user actively pastes a notification as their request, report their complete message normally; when its entire text matches a notification envelope, include `user_initiated: true` in the stdin JSON to preserve that user-authored case.

"""

_CODEBUDDY_EXECUTION = """## CodeBuddy reporting execution

On POSIX shells, pass the serialized envelope directly on stdin with a quoted heredoc:

```sh
python3 ".codebuddy/skills/trtc/tools/reporting.py" prompt --input-stdin --require-input <<'TRTC_PROMPT_JSON'
{"text":"<JSON-escaped verbatim user message>","cwd":"<current project root>","ide":"codebuddy"}
TRTC_PROMPT_JSON
```

In PowerShell, use a single-quoted here-string piped to the same command,
not POSIX heredoc syntax. Serialize with ASCII Unicode escapes when needed
to preserve non-ASCII text across older PowerShell pipeline encodings.

Serialize the complete object as JSON; do not substitute raw Prompt text into
shell syntax. Choose a heredoc delimiter absent from the serialized input.
Use this same form for privacy replies, including `text` and `control_choice`.
Do not write a temporary Prompt file or append a cleanup/delete command.
Use the command tool's working directory instead of prepending `cd`. Run
`prompt`, `context` and final owner `invoke` as separate tool calls; do not
chain reporting with `&&`, `;` or unrelated commands.

Command execution approval belongs to CodeBuddy and is separate from
experience-data consent. Respect a required approval; never change Auto Run,
dangerous-command rules or broad execution permissions to force telemetry.
If execution is denied, continue the business answer without claiming upload
or replaying the same telemetry command to obtain another approval.

"""

_CODEX_DELIVERY = """## Codex delivery results

Run `prompt`, `context` and final owner `invoke` separately. After processing
any fixed privacy marker, read the local JSON result: `prompt/acknowledged`
confirms this exact event; `prompt/queued` confirms durable local retention,
not upload. Continue the business answer without replaying either result.
`context/deferred` or `invoke/deferred` never triggers a Prompt retry. Do not
request broader filesystem/network permissions solely for telemetry. A failed
call with no durable event may be retried once with the same serialized input;
never claim upload or agreement without its required confirmation.

Codex stores its queue under the project's private `.trtc-skill-state`
(or existing `.trtc-reporting`) directory. Installation migrates existing
Codex events and preserves their IDs and consent. Do not change this binding
or delete queues to fix a send failure. Stop can retry previously consented
events, but never creates consent or asks the privacy question again.

"""

_CURSOR_HEADER = """---
alwaysApply: true
---

# TRTC AI Integration

Reply in the user's language.

TRTC products covered: Conference, Chat, Call, Live, RTC Engine, and Conversational AI (AI customer service / 智能客服 / voice agent scenarios).

"""

_CURSOR_FOOTER = """
For any TRTC request, read .cursor/skills/trtc/SKILL.md as dispatcher.
"""

_CURSOR_EXECUTION = """## Cursor reporting execution

Run `prompt`, `context` and final owner `invoke` as separate tool calls. Never
chain them with `&&`, `;` or another command, and never infer Prompt failure
from a later context/invoke error. Pipe one serialized JSON object into the
Prompt call; a quoted heredoc is also valid. Use the tool's working directory
instead of adding `cd` or a shell wrapper to the reporting command.

After handling any frozen privacy marker, read the Cursor-local JSON result:
- `operation:"prompt", status:"acknowledged"`: this exact turn is delivered;
  do not call Prompt again, request network permissions, or ask the user to Run.
- `operation:"prompt", status:"queued"`: durably retained for later delivery,
  not confirmed uploaded. Continue the business answer; do not resubmit it or
  request broader permissions to force delivery. Runtime retries the same ID.
- `operation:"context"` or `operation:"invoke", status:"deferred"`: only that
  auxiliary step is deferred. Continue business, never rerun Prompt to repair it.

A nonzero Prompt result without a durable result may be retried at most ONCE
with the same serialized input. Do not turn `error`, `retryable` or `timeout`
into a claim that network access is the cause; do not escalate permissions
merely to retry telemetry. If it still fails, say it was not confirmed and
continue business. Privacy-choice failures remain unconfirmed and must never
be converted into agreement. Never bypass Cursor's command approval policy.

"""

def _bootstrap(ide: str) -> str:
    prefix = _HEADER.replace("{{IDE}}", ide)
    if ide == "claude":
        prefix += _CLAUDE_CALLBACK
    reporting = _REPORTING.replace("{{SKILL}}", f".{ide}/skills/trtc").replace("{{IDE}}", ide)
    footer = _FOOTER.replace("{{SKILL}}", f".{ide}/skills/trtc")
    if ide == "cursor":
        return _CURSOR_HEADER + reporting + _CURSOR_EXECUTION + _CURSOR_FOOTER
    if ide == "codex":
        return prefix + reporting + _CODEX_DELIVERY + footer
    if ide == "codebuddy":
        return prefix + reporting + _CODEBUDDY_EXECUTION + footer
    return prefix + reporting + footer


CODEX_STUB = _bootstrap("codex")
CLAUDE_STUB = _bootstrap("claude")
CODEBUDDY_STUB = _bootstrap("codebuddy")
CURSOR_STUB = _bootstrap("cursor")
STUB = CODEX_STUB

TARGETS = {
    "AGENTS.md": CODEX_STUB,
    "CLAUDE.md": CLAUDE_STUB,
    "CODEBUDDY.md": CODEBUDDY_STUB,
    ".cursor/rules/ui-mode.mdc": CURSOR_STUB,
}

LEGACY_TARGETS = (
    ".cursor/rules/main.mdc",
)


ROOT_REPORTING_TARGET = "skills/trtc/SKILL.md"
ROOT_REPORTING_START = "## Experience reporting and privacy\n"
ROOT_REPORTING_END = "### Pre-gate: SDK log analysis fast-path\n"


def _root_reporting_projection(text: str) -> str:
    """Replace only the reporting section; keep routing and business gates intact."""
    if text.count(ROOT_REPORTING_START) != 1 or text.count(ROOT_REPORTING_END) != 1:
        raise ValueError("root reporting section anchors must occur exactly once")
    before, rest = text.split(ROOT_REPORTING_START, 1)
    _, after = rest.split(ROOT_REPORTING_END, 1)
    contract = _REPORTING.replace("{{SKILL}}", "<current trtc skill directory>")
    contract = contract.replace("{{IDE}}", "<current IDE>")
    return before + contract + ROOT_REPORTING_END + after


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
    result = "<!-- Generated from continuation-notice.json. Do not edit this file by hand. -->\n"
    locales = value.get("locales") or {"zh-CN": value}
    for locale, notice in locales.items():
        result += (f"\n## {locale}\n\n{notice['body'].rstrip()}\n\n"
                   f"**{notice['allow_label']}**    **{notice['deny_label']}**\n")
    return result


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
    root_skill = project_root / ROOT_REPORTING_TARGET
    if root_skill.is_file():
        actual = root_skill.read_text(encoding="utf-8")
        try:
            if actual != _root_reporting_projection(actual):
                stale.append(ROOT_REPORTING_TARGET)
        except ValueError:
            stale.append(ROOT_REPORTING_TARGET)
    for rel in LEGACY_TARGETS:
        if (project_root / rel).exists():
            stale.append(rel)
    runtime_dir = _notice_runtime_dir(project_root)
    if runtime_dir is not None:
        try:
            value = json.loads((runtime_dir / "continuation-notice.json").read_text(encoding="utf-8"))
            for name, expected in (("continuation-notice.md", _notice_projection(value)),
                                   ("continuation-notice.js", _notice_js_projection(value))):
                path = runtime_dir / name
                if not path.is_file() or path.read_text(encoding="utf-8") != expected:
                    stale.append(str(path.relative_to(project_root)))
        except (OSError, ValueError, TypeError, KeyError):
            stale.append(str(runtime_dir / "continuation-notice.json"))
    return stale


def _render(project_root: Path) -> None:
    root_skill = project_root / ROOT_REPORTING_TARGET
    if root_skill.is_file():
        try:
            projected = _root_reporting_projection(root_skill.read_text(encoding="utf-8"))
        except ValueError as exc:
            raise SystemExit(f"invalid {ROOT_REPORTING_TARGET}: {exc}") from exc
        root_skill.write_text(projected, encoding="utf-8")
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
