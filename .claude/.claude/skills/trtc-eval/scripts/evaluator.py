"""evaluator.py — Static evaluation of AI-generated code.

Checks must_include / must_not_include constraints using ripgrep.
Does NOT write trace.jsonl (orchestrator only).
"""
import argparse
import json
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from scripts.lib.eval_config import skill_root
from scripts.lib.schemas import Case, StaticResult


def grep_fixed(needle: str, root: Path) -> list[dict]:
    """Return matches for a fixed string in root directory (pure Python fallback)."""
    # Try ripgrep first; fall back to Python scanning if unavailable
    try:
        proc = subprocess.run(
            ["rg", "-F", "--no-heading", "--line-number", "--json", needle, str(root)],
            capture_output=True, text=True, check=False,
        )
        if proc.returncode != 2:  # 2 = rg error, 1 = no match (ok)
            out = []
            for line in proc.stdout.splitlines():
                try:
                    ev = json.loads(line)
                    if ev.get("type") == "match":
                        data = ev["data"]
                        out.append({
                            "file": data["path"]["text"],
                            "line_no": data["line_number"],
                            "line": data["lines"]["text"].rstrip("\n"),
                        })
                except (json.JSONDecodeError, KeyError):
                    continue
            return out
    except (FileNotFoundError, PermissionError):
        pass

    # Pure Python fallback: walk directory and search files
    out = []
    for filepath in sorted(root.rglob("*")):
        if not filepath.is_file():
            continue
        try:
            text = filepath.read_text(errors="ignore")
        except (OSError, UnicodeDecodeError):
            continue
        for line_no, line in enumerate(text.splitlines(), 1):
            if needle in line:
                out.append({
                    "file": str(filepath),
                    "line_no": line_no,
                    "line": line,
                })
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description="Static evaluation of AI-generated code")
    ap.add_argument("--case-id", required=True)
    ap.add_argument("--run-dir", required=True)
    args = ap.parse_args()

    run_dir = Path(args.run_dir).resolve()
    case_dir = run_dir / "cases" / args.case_id
    code_dir = case_dir / "ai_extracted_code"

    # Load case
    cases_data = json.loads((skill_root() / "tests" / "benchmark" / "cases.json").read_text())
    case_raw = next((c for c in cases_data if c["test_id"] == args.case_id), None)
    if case_raw is None:
        print(f"ERROR: case '{args.case_id}' not found", file=sys.stderr)
        return 1
    case = Case(**case_raw)

    # Check if code was generated
    if not code_dir.exists() or not any(code_dir.iterdir()):
        result = StaticResult(
            test_id=case.test_id,
            must_include_hit=0.0,
            must_not_include_clean=1.0,
            hits=[],
            misses=case.constraints.must_include[:],
            dirty=[],
            score=0.0,
        )
        (case_dir / "static_result.json").write_text(
            json.dumps(result.model_dump(), indent=2, ensure_ascii=False)
        )
        return 0

    # Check file_count_min
    file_count = len(list(code_dir.iterdir()))
    if file_count < case.constraints.file_count_min:
        result = StaticResult(
            test_id=case.test_id,
            must_include_hit=0.0,
            must_not_include_clean=1.0,
            hits=[],
            misses=case.constraints.must_include[:],
            dirty=[],
            score=0.0,
        )
        (case_dir / "static_result.json").write_text(
            json.dumps(result.model_dump(), indent=2, ensure_ascii=False)
        )
        return 0

    # must_include check
    hits: list[str] = []
    misses: list[str] = []
    for needle in case.constraints.must_include:
        matches = grep_fixed(needle, code_dir)
        if matches:
            hits.append(needle)
        else:
            misses.append(needle)

    total_mi = len(case.constraints.must_include)
    must_include_hit = len(hits) / total_mi if total_mi > 0 else 1.0

    # must_not_include check
    dirty: list[str] = []
    for needle in case.constraints.must_not_include:
        matches = grep_fixed(needle, code_dir)
        if matches:
            dirty.append(needle)

    total_mni = len(case.constraints.must_not_include)
    must_not_include_clean = (total_mni - len(dirty)) / total_mni if total_mni > 0 else 1.0

    # Score
    static_score = (
        must_include_hit * case.weights.w_must_include
        + must_not_include_clean * case.weights.w_must_not
    )

    result = StaticResult(
        test_id=case.test_id,
        must_include_hit=round(must_include_hit, 4),
        must_not_include_clean=round(must_not_include_clean, 4),
        hits=hits,
        misses=misses,
        dirty=dirty,
        score=round(static_score, 4),
    )
    (case_dir / "static_result.json").write_text(
        json.dumps(result.model_dump(), indent=2, ensure_ascii=False)
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
