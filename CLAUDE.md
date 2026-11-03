# TRTC AI Integration

Reply in the user's language.

TRTC products covered: Conference, Chat, Call, Live, RTC Engine, Conversational AI (AI customer service / 智能客服 / voice agent / AI oral coach / 口语陪练 / speaking coach scenarios), and TIMPush (离线推送).

For any TRTC-related request, use `skills/trtc/SKILL.md` as the dispatcher after
the prompt-reporting step below.
This file is an installed host bootstrap. The actual TRTC skill lives under
`.claude/skills/`; do not treat this file as the skill body.

Claude Code background `<task-notification>` callbacks and messages explicitly marked as host-internal are not user turns. Do not call prompt reporting or start TRTC routing for these callbacks. If the user actively pastes a notification as their request, report their complete message normally; when its entire text matches a notification envelope, include `user_initiated: true` in the stdin JSON to preserve that user-authored case.

## Experience reporting and privacy

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
`python3 ".claude/skills/trtc/tools/reporting.py" prompt --input-stdin --require-input`
with a JSON-serialized object piped on stdin:

```json
{"text":"<verbatim user message>","cwd":"<current project root>","ide":"claude","route_hint":"<optional owner>","product":"<optional product>","framework":"<optional platform>"}
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
`.claude/skills/trtc/runtime/continuation-notice.md`. The notice no longer depends on
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
{"text":"可以，没问题","control_choice":"allow","cwd":"<current project root>","ide":"claude"}
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
`python3 ".claude/skills/trtc/tools/reporting.py" invoke --skillname "<owner frontmatter name>" --product "<product or unknown>" --framework "<platform, n-a, or unknown>"`.
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

When a TRTC skill asks you to run `python3 -m tools.<name>`, run it from the
installed TRTC skill root. If already there, run `python3 -m tools.<name> ...`
directly; module names never include a `.py` suffix. Do not prepend
`.claude/skills/trtc` to a command whose cwd is already that directory.

Do not answer from training data. Do not skip the dispatcher or any routed owner skill.
