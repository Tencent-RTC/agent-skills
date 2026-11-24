#!/usr/bin/env bash
# routing_probe.sh — Agent routing probe for TRTC refactoring baseline
#
# PURPOSE:
#   Verify that claude-internal correctly routes TRTC questions by reading
#   skills/trtc/SKILL.md as one of its first tool calls (not answering from
#   training data alone). This is a ROUTING test, not a code-quality test —
#   it complements trtc-eval which tests code output quality.
#
# USAGE:
#   ./routing_probe.sh
#   ./routing_probe.sh --out /tmp/probe_results.txt   # write to file
#   ./routing_probe.sh --quiet                         # suppress per-event trace
#   ./routing_probe.sh --max-tool-calls 5              # fail if SKILL.md not in first N calls
#
# ACCEPTANCE (Phase 0 baseline):
#   All 3 prompts → PASS (SKILL.md read within first MAX_TOOL_CALLS tool calls)
#   After Phase 2 rewrite → re-run and confirm still PASS with ≤80-line dispatcher
#
# Requires: bash 3.2+, python3, claude-internal >= 1.1.0

set -euo pipefail

# ─── Locate repo root ───────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# benchmark/ → tests/ → trtc-eval/ → skills/ → .claude/ → REPO_ROOT
REPO_ROOT="$(cd "$SCRIPT_DIR/../../../../../" && pwd)"

# ─── Configuration ──────────────────────────────────────────────────────────
CLAUDE_CMD="${CLAUDE_CMD:-claude-internal}"
MAX_TOOL_CALLS="${MAX_TOOL_CALLS:-8}"
PROBE_TARGET_SKILL="${PROBE_TARGET_SKILL:-skills/trtc/SKILL.md}"
PROBE_LOG_DIR="${PROBE_LOG_DIR:-$REPO_ROOT/.claude/eval-runs}"
QUIET=false
OUT_FILE=""

# ─── Parse args ─────────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
    case "$1" in
        --quiet|-q)       QUIET=true; shift ;;
        --out)            OUT_FILE="$2"; shift 2 ;;
        --max-tool-calls) MAX_TOOL_CALLS="$2"; shift 2 ;;
        --target-skill)   PROBE_TARGET_SKILL="$2"; shift 2 ;;
        *) echo "Unknown arg: $1" >&2; exit 1 ;;
    esac
done

# ─── Standard probe prompts (from baseline-snapshot.md §6) ──────────────────
PROMPTS=(
    "我想在 Vue3 项目里集成 TRTC 会议功能"
    "如何在 Android 实现 TRTC 进房"
    "集成时报错 ERR_CODE -1302 怎么办"
)
PROMPT_LABELS=(
    "conference-onboarding"
    "product-routing"
    "troubleshoot"
)

# Parallel result arrays (indexed, bash 3.2 compatible)
RESULT_STATUS=("" "" "")    # PASS / FAIL / ERROR per prompt
RESULT_SEQ=("" "" "")       # tool call sequence string per prompt

# ─── Helpers ────────────────────────────────────────────────────────────────
log() { [[ "$QUIET" == "false" ]] && echo "$*" || true; }
hr()  { log "──────────────────────────────────────────────────────────────"; }

tee_output() {
    if [[ -n "$OUT_FILE" ]]; then tee -a "$OUT_FILE"; else cat; fi
}

# ─── Verify prerequisites ────────────────────────────────────────────────────
if ! command -v "$CLAUDE_CMD" &>/dev/null; then
    echo "ERROR: $CLAUDE_CMD not found. Set CLAUDE_CMD env var to the correct path." >&2
    exit 1
fi
if ! command -v python3 &>/dev/null; then
    echo "ERROR: python3 required for stream-json parsing." >&2
    exit 1
fi

CLI_VER=$("$CLAUDE_CMD" --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1 || echo "unknown")

# ─── Setup ──────────────────────────────────────────────────────────────────
mkdir -p "$PROBE_LOG_DIR"
TIMESTAMP="$(date +%Y%m%d_%H%M%S)"
RUN_DIR="$PROBE_LOG_DIR/probe_${TIMESTAMP}"
mkdir -p "$RUN_DIR"
[[ -n "$OUT_FILE" ]] && : > "$OUT_FILE"

# ─── Python parser (inline) ─────────────────────────────────────────────────
# Exit 0=PASS, 1=FAIL, 2=ERROR (no tool calls)
PARSER=$(cat <<'PYEOF'
import sys, json, os

target_skill = os.environ.get("PROBE_TARGET_SKILL", "skills/trtc/SKILL.md")
max_tool_calls = int(os.environ.get("MAX_TOOL_CALLS", "8"))

tool_calls = []
found_at = None
final_text = []

for raw_line in sys.stdin:
    line = raw_line.strip()
    if not line:
        continue
    try:
        event = json.loads(line)
    except json.JSONDecodeError:
        continue

    etype = event.get("type", "")

    if etype == "assistant":
        msg = event.get("message", event)
        for block in msg.get("content", []):
            if isinstance(block, dict) and block.get("type") == "tool_use":
                path = block.get("input", {}).get("file_path",
                       block.get("input", {}).get("path", ""))
                tool_calls.append({"name": block.get("name",""), "path": path})
                if found_at is None and target_skill in path:
                    found_at = len(tool_calls)

    elif etype == "content_block_start":
        block = event.get("content_block", {})
        if block.get("type") == "tool_use":
            path = block.get("input", {}).get("file_path",
                   block.get("input", {}).get("path", ""))
            tool_calls.append({"name": block.get("name",""), "path": path})
            if found_at is None and target_skill in path:
                found_at = len(tool_calls)

    elif etype == "result":
        r = event.get("result", "")
        if isinstance(r, str):
            final_text.append(r[:200])

result = {
    "total_tool_calls": len(tool_calls),
    "tool_call_sequence": [
        "{}.{}({})".format(i+1, c["name"], c["path"][:60])
        for i, c in enumerate(tool_calls[:max_tool_calls])
    ],
    "target_skill": target_skill,
    "found_at_position": found_at,
    "max_tool_calls": max_tool_calls,
    "pass": found_at is not None and found_at <= max_tool_calls,
    "final_text_snippet": final_text[0] if final_text else ""
}

print(json.dumps(result, ensure_ascii=False, indent=2))

if len(tool_calls) == 0:
    sys.exit(2)
elif result["pass"]:
    sys.exit(0)
else:
    sys.exit(1)
PYEOF
)

# ─── Header ─────────────────────────────────────────────────────────────────
{
hr
echo "TRTC Agent Routing Probe"
echo "Run:       $TIMESTAMP"
echo "CLI:       $CLAUDE_CMD v${CLI_VER}"
echo "Repo root: $REPO_ROOT"
echo "Target:    $PROBE_TARGET_SKILL (must appear in first $MAX_TOOL_CALLS tool calls)"
echo "Log dir:   $RUN_DIR"
hr
} | tee_output

# ─── Run probes ─────────────────────────────────────────────────────────────
for i in 0 1 2; do
    PROMPT="${PROMPTS[$i]}"
    LABEL="${PROMPT_LABELS[$i]}"
    LOG_RAW="$RUN_DIR/${LABEL}.stream.jsonl"
    LOG_PARSED="$RUN_DIR/${LABEL}.result.json"

    {
    echo ""
    echo "▶ Prompt $((i+1))/3 [$LABEL]"
    echo "  \"$PROMPT\""
    } | tee_output

    set +e
    (
        cd "$REPO_ROOT"
        "$CLAUDE_CMD" \
            --output-format stream-json \
            --verbose \
            -p "$PROMPT" \
            2>/dev/null
    ) > "$LOG_RAW"
    RUN_EXIT=$?
    set -e

    if [[ $RUN_EXIT -ne 0 && ! -s "$LOG_RAW" ]]; then
        echo "  ✗ ERROR: claude-internal exited $RUN_EXIT with no output" | tee_output
        RESULT_STATUS[$i]="ERROR"
        RESULT_SEQ[$i]="(no output)"
        continue
    fi

    set +e
    PARSED=$(
        export PROBE_TARGET_SKILL="$PROBE_TARGET_SKILL"
        export MAX_TOOL_CALLS="$MAX_TOOL_CALLS"
        python3 -c "$PARSER" < "$LOG_RAW" 2>&1
    )
    PARSE_EXIT=$?
    set -e

    echo "$PARSED" > "$LOG_PARSED"

    TOTAL=$(echo "$PARSED" | python3 -c \
        "import json,sys; d=json.load(sys.stdin); print(d.get('total_tool_calls',0))" 2>/dev/null || echo "?")
    FOUND_AT=$(echo "$PARSED" | python3 -c \
        "import json,sys; d=json.load(sys.stdin); v=d.get('found_at_position'); print(v if v else 'not found')" 2>/dev/null || echo "?")
    SEQ=$(echo "$PARSED" | python3 -c \
        "import json,sys; d=json.load(sys.stdin); seq=d.get('tool_call_sequence',[]); print(' -> '.join(seq[:5]) if seq else '(none)')" \
        2>/dev/null || echo "?")

    if [[ $PARSE_EXIT -eq 0 ]]; then
        STATUS="PASS"
        RESULT_STATUS[$i]="PASS"
    elif [[ $PARSE_EXIT -eq 2 ]]; then
        STATUS="ERROR (no tool calls)"
        RESULT_STATUS[$i]="ERROR"
    else
        STATUS="FAIL"
        RESULT_STATUS[$i]="FAIL"
    fi

    RESULT_SEQ[$i]="$SEQ"

    {
    echo "  Status:      $STATUS"
    echo "  Total calls: $TOTAL"
    echo "  SKILL.md at: position $FOUND_AT"
    echo "  First calls: $SEQ"
    } | tee_output
done

# ─── Summary table ──────────────────────────────────────────────────────────
P1="${RESULT_STATUS[0]}"
P2="${RESULT_STATUS[1]}"
P3="${RESULT_STATUS[2]}"

if [[ "$P1" == "PASS" && "$P2" == "PASS" && "$P3" == "PASS" ]]; then
    HIT="all-hit"
elif [[ "$P1" == "FAIL" || "$P2" == "FAIL" || "$P3" == "FAIL" ]]; then
    HIT="partial-miss"
else
    HIT="error"
fi

{
echo ""
hr
echo "RESULTS SUMMARY — Claude (claude-internal v${CLI_VER})"
hr
echo ""
printf "| %-24s | %-12s | %-12s | %-12s | %-16s |\n" \
    "Agent" "Prompt 1" "Prompt 2" "Prompt 3" "SKILL.md hit"
printf "| %-24s | %-12s | %-12s | %-12s | %-16s |\n" \
    "------------------------" "------------" "------------" "------------" "----------------"
printf "| %-24s | %-12s | %-12s | %-12s | %-16s |\n" \
    "Claude (claude-internal)" "$P1" "$P2" "$P3" "$HIT"
printf "| %-24s | %-12s | %-12s | %-12s | %-16s |\n" \
    "Cursor" "(manual)" "(manual)" "(manual)" "-"
printf "| %-24s | %-12s | %-12s | %-12s | %-16s |\n" \
    "CodeBuddy" "(manual)" "(manual)" "(manual)" "-"
printf "| %-24s | %-12s | %-12s | %-12s | %-16s |\n" \
    "Codex" "(manual)" "(manual)" "(manual)" "-"
echo ""
echo "Sequences:"
echo "  [conference-onboarding]: ${RESULT_SEQ[0]}"
echo "  [product-routing]:       ${RESULT_SEQ[1]}"
echo "  [troubleshoot]:          ${RESULT_SEQ[2]}"
echo ""
echo "Raw logs: $RUN_DIR"
hr
} | tee_output

# ─── Exit code ──────────────────────────────────────────────────────────────
if [[ "$P1" == "PASS" && "$P2" == "PASS" && "$P3" == "PASS" ]]; then
    exit 0
else
    exit 1
fi
