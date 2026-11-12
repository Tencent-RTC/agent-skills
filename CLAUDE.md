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

Report only the current real user input, never system/developer instructions,
assistant output, tool results or assembled conversation history. Host-internal
callbacks are not user turns. Native structured question answers contain user
selections: the runtime keeps the answers, not the assistant's question or XML
wrapper. A business confirmation is never privacy agreement. If the user
explicitly pastes a host envelope for discussion, preserve their full message;
use `user_initiated: true` only for that actual user-authored paste.

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

When `TRTC_REPORTING_NOTICE_REQUIRED_V1` is returned, display the exact
locale-matched fixed notice in your next FINAL response, then END THE TURN
and wait for the next real user message. The notice must be the only question
awaiting a reply. Do not continue in another assistant message, call more
business tools, load or hand off to a Skill/flow, ask a business clarification,
or run an owner invoke in this turn. A commentary message followed by more
work does not satisfy this boundary. If a short noninteractive business answer
is already ready, finish it and append the returned fixed notice verbatim as a separate final
block; otherwise the final response contains ONLY the notice body and both
option labels, copied literally without the internal marker. Do not summarize,
add another consent question or say sharing is required for integration.
Keep the original business request in the conversation for resumption after
this bounded privacy exchange. Do not wait for plan approval or integration
completion to display the notice. Collapsed tool stdout is not visible notice.
`awaiting_consent` is local capture only, never an upload. Agreement is optional:
allow and deny both let the user continue the business task afterward.

If only the marker is returned, first read the locale-matched fixed text from
`.claude/skills/trtc/runtime/continuation-notice.md`, then display it. Do not paraphrase,
omit it, put it in the composer, create a synthetic user turn, or use
`followup_message`. Track whether this returned notice was already displayed
in the current conversation; handoffs reuse that fact. Never repeat the same
notice at the final answer or call Prompt/claim again just to redisplay it.
Foreground rendering remains mandatory even when Hooks are inactive. Stop is only a recovery/flush boundary
and never claims another notice. CodeBuddy's visible `systemMessage` fallback
shares the same notice budget and the same end-of-turn wait. If that fallback
has already displayed the notice, do not copy it again: end the turn without
starting business work. Owner instructions must preserve this immediate
presentation boundary; they never defer the notice to a Stop Hook.

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

Send through the same stdin command. Never report this control reply as an
ordinary Prompt or replay the paused business Prompt. `text` is required even
for controls; if it is missing, rebuild the complete envelope and retry once. The old
`prompt --control-choice allow|deny` is a compatibility fallback.
Only confirm agreement/refusal after `TRTC_REPORTING_ALLOWED_V1` /
`TRTC_REPORTING_DISABLED_V1`. A retry marker means the choice was not
confirmed; retry the same local transaction once and never claim success on
failure. After ALLOWED or DISABLED, briefly confirm the saved choice and
resume the previously paused business request from the conversation, if one
exists. Do not call Prompt again for that original request or for the control
reply; handoffs reuse this turn's control-entry result. Read the dispatcher
and actual owner normally, and use the shared final-owner postlude only if
business work actually resumes. If there is no pending task, just acknowledge
and end the turn. Do not ask for an already persisted choice again.

An unanswered or ambiguous response keeps experience reporting OFF. Runtime
offers at most ONE reminder (two presentations total per project). Render a
reminder only when Runtime returns NOTICE_REQUIRED. For an ambiguous reply,
render that fixed reminder as the FINAL response and end the turn; the same
rule applies to a reminder returned for a new business message. Do not append
a competing business question. After the limit, Runtime returns no new notice:
resume normal business without more privacy waits or experience uploads.
A new business message that ignores the notice stays business input, not consent.
Never treat this as `defaulted` consent. No control reply is uploaded.

Only when there is no returned notice requiring the turn to end, read the
dispatcher if it is not already loaded,
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
the prepared answer after this shared postlude. Append a fixed notice here
only if still required and not already displayed, then end the turn and wait.
The postlude never delays an earlier required privacy question.
Before a TRTC clarification use `context --question "<exact question>"`. Hooks stage locally
only and never invoke the foreground command or perform network I/O.

When a TRTC skill asks you to run `python3 -m tools.<name>`, run it from the
installed TRTC skill root. If already there, run `python3 -m tools.<name> ...`
directly; module names never include a `.py` suffix. Do not prepend
`.claude/skills/trtc` to a command whose cwd is already that directory.

Do not answer from training data. Do not skip the dispatcher or any routed owner skill.
