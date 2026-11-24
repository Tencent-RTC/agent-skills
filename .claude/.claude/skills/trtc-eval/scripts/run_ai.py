"""run_ai.py — Drive the AI CLI to generate code for a given case.

Does NOT write trace.jsonl (orchestrator only).
"""
import argparse
import json
import os
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from scripts.lib.cli_driver import invoke_cli
from scripts.lib.eval_config import repo_root, skill_root
from scripts.lib.schemas import Case


SYSTEM_PROMPT_PATH = skill_root() / "prompts" / "ai_driver_system_prompt.md"


def _extract_code_blocks(markdown: str) -> list[tuple[str, str]]:
    """Extract fenced code blocks with language tags.

    Returns list of (language, code) tuples.
    """
    pattern = re.compile(r"```(\w+)\s*\n(.*?)```", re.DOTALL)
    return [(m.group(1), m.group(2)) for m in pattern.finditer(markdown)]


def _language_to_ext(lang: str) -> str:
    mapping = {
        "swift": ".swift", "kotlin": ".kt", "java": ".java",
        "typescript": ".ts", "javascript": ".js", "ts": ".ts", "js": ".js",
        "python": ".py", "objc": ".m", "objectivec": ".m",
        "vue": ".vue",
    }
    return mapping.get(lang.lower(), f".{lang}")


def _extract_dependencies(markdown: str) -> dict:
    """Extract the dependencies JSON block from AI output.

    Looks for a fenced block labeled ```json dependencies.
    Returns parsed dict like {"cocoapods": [...], "npm": [...], ...} or empty dict.
    """
    # Match ```json dependencies ... ```
    pattern = re.compile(
        r"```json\s+dependencies\s*\n(.*?)```", re.DOTALL
    )
    m = pattern.search(markdown)
    if m:
        try:
            return json.loads(m.group(1))
        except (json.JSONDecodeError, ValueError):
            pass

    # Fallback: look for any ```json block that parses as a dependency dict
    # (contains at least one known package manager key)
    known_keys = {"cocoapods", "gradle", "npm", "pub"}
    json_pattern = re.compile(r"```json\s*\n(.*?)```", re.DOTALL)
    for jm in json_pattern.finditer(markdown):
        try:
            data = json.loads(jm.group(1))
            if isinstance(data, dict) and any(k in known_keys for k in data):
                return data
        except (json.JSONDecodeError, ValueError):
            continue
    return {}


def _is_dep_block(lang: str, code: str) -> bool:
    """Check if a code block is a dependency declaration (should be excluded from impl code)."""
    if lang.lower() != "json":
        return False
    # Heuristic: if it parses as JSON with known package manager keys, it's a dep block
    known_keys = {"cocoapods", "gradle", "npm", "pub"}
    try:
        data = json.loads(code)
        if isinstance(data, dict) and any(k in known_keys for k in data):
            return True
    except (json.JSONDecodeError, ValueError):
        pass
    return False


def main() -> int:
    ap = argparse.ArgumentParser(description="Drive AI CLI to generate code")
    ap.add_argument("--case-id", required=True)
    ap.add_argument("--run-dir", required=True)
    args = ap.parse_args()

    run_dir = Path(args.run_dir).resolve()
    case_dir = run_dir / "cases" / args.case_id
    case_dir.mkdir(parents=True, exist_ok=True)

    # Load case
    cases_data = json.loads((skill_root() / "tests" / "benchmark" / "cases.json").read_text())
    case_raw = next((c for c in cases_data if c["test_id"] == args.case_id), None)
    if case_raw is None:
        print(f"ERROR: case '{args.case_id}' not found", file=sys.stderr)
        return 1
    case = Case(**case_raw)

    # Build prompt
    system_prefix = ""
    if SYSTEM_PROMPT_PATH.exists():
        system_prefix = SYSTEM_PROMPT_PATH.read_text().strip() + "\n\n"
    full_prompt = system_prefix + case.user_prompt

    # Save input.json
    (case_dir / "input.json").write_text(json.dumps({
        "test_id": case.test_id,
        "user_prompt": case.user_prompt,
        "system_prefix_len": len(system_prefix),
    }, ensure_ascii=False, indent=2))

    # Invoke CLI
    # IMPORTANT: cwd must be the repo root, not the caller's cwd. The CLI
    # (codebuddy/claude in -p mode) sandboxes file reads to its cwd; if we
    # set it to the skill dir, the AI cannot reach `knowledge-base/` and is
    # forced to answer from training data — defeating the eval.
    project_root = repo_root()
    try:
        exit_code, raw_output = invoke_cli(full_prompt, cwd=project_root, timeout=300)
    except TimeoutError:
        (case_dir / "ai_raw_output.md").write_text("[TIMEOUT: CLI did not respond within 300s]")
        # Update input.json
        input_data = json.loads((case_dir / "input.json").read_text())
        input_data["status"] = "timeout"
        input_data["token_count"] = 0
        (case_dir / "input.json").write_text(json.dumps(input_data, ensure_ascii=False, indent=2))
        return 124

    # Save raw output
    (case_dir / "ai_raw_output.md").write_text(raw_output)

    # Update input.json with token approximation
    input_data = json.loads((case_dir / "input.json").read_text())
    input_data["cli_exit_code"] = exit_code
    input_data["token_count"] = len(raw_output) // 4  # rough approximation
    input_data["status"] = "ok" if exit_code == 0 else "cli_error"
    (case_dir / "input.json").write_text(json.dumps(input_data, ensure_ascii=False, indent=2))

    # Extract code blocks
    code_dir = case_dir / "ai_extracted_code"
    code_dir.mkdir(exist_ok=True)

    blocks = _extract_code_blocks(raw_output)
    if not blocks:
        input_data["status"] = "no_code_generated"
        (case_dir / "input.json").write_text(json.dumps(input_data, ensure_ascii=False, indent=2))
        return 0  # Not an error — evaluator will score 0

    # Extract and save dependencies from the dedicated JSON block
    deps = _extract_dependencies(raw_output)
    (case_dir / "dependencies.json").write_text(json.dumps(deps, ensure_ascii=False, indent=2))

    # Filter out dependency declaration blocks from implementation code
    # (blocks labeled "json dependencies" are already excluded by _extract_code_blocks
    #  since the label is "json", but we skip them by checking content)
    impl_blocks = [(lang, code) for lang, code in blocks if not _is_dep_block(lang, code)]

    # Determine expected filenames from injection_map keys
    injection_names = list(case.demo_injection_map.keys()) if case.demo_injection_map else []

    for i, (lang, code) in enumerate(impl_blocks):
        ext = _language_to_ext(lang)
        # If injection_map defines expected filenames, use them in order
        if i < len(injection_names):
            filename = injection_names[i]
        else:
            filename = f"block_{i:02d}{ext}"
        (code_dir / filename).write_text(code)

    return 0


if __name__ == "__main__":
    sys.exit(main())
