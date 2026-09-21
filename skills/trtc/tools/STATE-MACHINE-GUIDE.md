# State Machine Guide (topic skill internal)

> 这个文档由 `topic/SKILL.md` Step 3 引用。`topic/SKILL.md` 只在 Step 3 给一个简短的指针，
> 真正的状态机操作手册（Bash 命令、状态图、harness 强制规则、per-slice 节奏等）都在这里。
>
> AI 在执行 topic 的 Step 3 时，**MUST 先读这个文件再开始 slice 循环**。slice loop 由
> on-disk 状态机加 PreToolUse / Stop hooks 物理强制——下面的规则不是建议，违反会被 hook
> 物理拒绝，用户能直接看到拒绝消息。**驱动状态机；不要绕开它。**

---

## The five commands (run via Bash)

```bash
# 1. Materialise the execution queue from confirmed_plan (ONCE per scenario).
#    Default: one execution step per slice. If session.execution_granularity=unit:
#    execution_queue contains delivery-unit steps with multiple slices.
python3 ${CLAUDE_PLUGIN_ROOT}/skills/trtc/tools/init_slice_queue.py

# 2. Inspect the cursor at any time.
python3 ${CLAUDE_PLUGIN_ROOT}/skills/trtc/tools/next_slice.py status

# 3. Advance the cursor as you progress through the current execution step.
python3 ${CLAUDE_PLUGIN_ROOT}/skills/trtc/tools/next_slice.py advance mark_slice_read
python3 ${CLAUDE_PLUGIN_ROOT}/skills/trtc/tools/next_slice.py advance mark_code_written
python3 ${CLAUDE_PLUGIN_ROOT}/skills/trtc/tools/next_slice.py advance mark_user_confirmed

# 4. Run apply (default CLI advances mark_apply_passed / mark_apply_failed itself).
python3 -m tools.apply --slice <slice_id>
# In delivery-unit mode:
python3 -m tools.apply --unit <unit_id>
```

---

## State diagram (one execution step)

```
not_started ─Read slice file─▶ mark_slice_read ─▶ slice_read
                                                      │
                                                 Write code
                                                      │
                                             mark_code_written
                                                      ▼
                                                 code_written ──tools.apply──▶ apply_passed
                                                      │            │
                                                      │            └──fail──▶ apply_failed ──Edit code──▶ mark_code_written ──▶ code_written
                                                      │
                                      (you're stuck — Stop hook blocks turn end)

apply_passed ─Pause for user "继续"─▶ mark_user_confirmed ─▶ next slice
```

---

## What the harness physically enforces

| Rule | Enforced by | What you'll see if you violate |
|---|---|---|
| You can only Read the **current execution step's** slice `.md` files | `gate_slice_read.py` PreToolUse | "Read blocked: '<other-slice>' is not in the current execution step" + exit 2 |
| You cannot Write project source files in `not_started` | `gate_slice_write.py` PreToolUse | "Write blocked: state is 'not_started'" + exit 2 |
| You cannot Write project source files in `apply_passed` | `gate_slice_write.py` PreToolUse | "Write blocked: state is 'apply_passed'... ask the user to confirm" + exit 2 |
| You cannot end the turn with `code_written` or `apply_failed` | `stop_require_apply_evidence.py` Stop | "Cannot end turn: execution step [N] '<id>' is in 'code_written'" + exit 2 |
| tools.apply refuses unless state == `code_written` and the requested slice/unit matches the cursor | `tools.apply` itself | exit 2 with explanation |

---

## Auto-advance policy

`auto_advance_policy` (root-level field in `<projectRoot>/.trtc-session.yaml`) decides whether
`tools.apply` pauses for the user after a clean pass:

| policy | After apply pass | After apply fail/partial |
|---|---|---|
| `pause_each` | stays at `apply_passed`; AI must wait for user "继续" then call `mark_user_confirmed` | stays at `apply_failed`; regenerate, re-apply |
| `pause_on_failure` (recommended default) | tools.apply auto-calls `mark_user_confirmed`; cursor lands on the next execution step's `not_started` | stays at `apply_failed`; regenerate, re-apply |
| `pause_at_end` | same as `pause_on_failure` (reserved for future per-batch summary) | stays at `apply_failed` |

Unset / unknown values are treated as `pause_each` — fail closed. The policy
is set by onboarding when the user picks scope; **do not change it mid-flight**.

---

## Execution granularity

By default the topic loop runs one slice at a time. When the session has:

```yaml
execution_granularity: unit
```

the state machine runs delivery units instead. A delivery unit is an execution
batch containing multiple existing `confirmed_plan` slices. It never adds a
slice that is not already in `confirmed_plan`; it only reduces how many
read/write/apply loops the agent runs.

Automatic grouping is scenario-scoped and declared in:

```bash
skills/trtc-conference/references/execution-units.yaml
```

If the current scenario is absent from that file, unit mode uses single-slice
execution steps. Session-level `delivery_units` may override the scenario
config, but the same rule applies: only slices already in `confirmed_plan` may
be grouped.

Example:

```yaml
execution_queue:
  - id: foundation
    type: unit
    status: pending
    slices:
      - conference/login-auth
      - conference/room-lifecycle
```

In unit mode the slice-read gate allows every slice inside the current unit and
blocks slices outside it. The write and Stop gates use the current unit state.
`tools.apply --unit <id>` runs the entry-symbol check for every slice in the unit
and writes one evidence JSON grouped by slice.

## Per-slice / per-unit rhythm (the tool-using turns, in order)

1. `Bash`: run `next_slice.py status` to confirm the cursor.
2. `Read`: open the current slice's product overview + platform file. In unit
   mode, read every slice listed in the current unit.
3. `Bash`: `next_slice.py advance mark_slice_read`.
4. `Write` / `Edit`: generate code into the user project for the current slice
   or current unit. Then `Bash`: `next_slice.py advance mark_code_written`.
5. `Bash`: `python3 -m tools.apply --slice <id>` or, in unit mode, `python3 -m tools.apply --unit <id>`.
   - **policy = pause_each + pass** → ask user "继续？", wait, then `next_slice.py advance mark_user_confirmed`.
   - **policy = pause_on_failure + pass** → `tools.apply` auto-advances; loop straight back to (1) for the next execution step.
   - **fail (any policy)** → Edit code based on the issue text in `.trtc-apply-evidence/{slug}.json`, `mark_code_written` again, re-run `python3 -m tools.apply`. (Re-reading the slice file is permitted — gate allows it — but not enforced.)

---

## Hard rules (review before every execution step)

- Do **not** combine code from multiple execution steps into one Write. Unit mode may combine the slices inside the current unit only.
- Do **not** Read slices outside the current execution step before the cursor advances (whether by manual confirm or by `python3 -m tools.apply` auto-advance) — the Read gate will reject it.
- The evidence shown to the user must come from the JSON `python3 -m tools.apply` writes to `.trtc-apply-evidence/{slice_slug}.json` — **quote it, don't compose it from memory**.
- After `apply_failed`, fix the code based on the issue text in the evidence JSON. Re-reading the slice file is allowed and often useful, but the harness no longer forces it — the Stop hook keeps you in the loop until apply passes.

---

## Post-loop: `all_done` is NOT the end

**CRITICAL**: When `python3 -m tools.apply` prints `next state: all_done`, the slice loop is
finished — but the **topic flow is not done**. `all_done` means "all code steps
passed", not "task complete, output summary and stop".

After `all_done` you MUST continue to:

1. **Step 4 (Verification Checklist)** — present the scenario's verification
   items to the user and ask them to confirm each one works.
2. **Step 4.5 (Runtime Verification & Telemetry)** — offer to run the app and
   automatically verify SDK events fire correctly (opt-in consent required if
   `telemetry.opted_in` is null in the session).
3. **Finalize the session** — after Step 4 / Step 4.5 are genuinely complete,
   run:

   ```bash
   python3 ${CLAUDE_PLUGIN_ROOT}/skills/trtc/tools/finalize_session.py
   ```

   This normalizes `status`, `current_step`, `completed_steps`, and the slice
   cursor so the next turn reloads as a completed integration rather than a
   mid-topic handoff.

`tools.apply` prints a `POST-LOOP CHECKLIST` block when it reaches `all_done` as
a physical reminder. **Do not ignore that block.**

**Self-check signal**: If your next action after seeing `all_done` is to write
a "project complete" summary without first executing Step 4 — STOP, you are
skipping mandatory steps. Go back to `topic/SKILL.md` §Step 4.

---

## Related documents

- `topic/SKILL.md` — high-level scenario walkthrough flow, references this guide
- `apply/SKILL.md` — apply skill input/output contract
- Source: `trtc/tools/state_machine.py`, `trtc/tools/next_slice.py`, `trtc/tools/apply.py`, `trtc/hooks/{gate_slice_read,gate_slice_write,stop_require_apply_evidence}.py`
