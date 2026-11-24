"""report.py — Generate scoreboard, Mermaid report, and diff reports.

Subcommands:
  build  --run-dir=<path>                    Generate report.md + scoreboard.csv + errata.md
  diff   --baseline=<path> --current=<path>  Compare two runs, output diff_report.md

Does NOT write trace.jsonl.
Does NOT modify summary.json / scoreboard.csv (read-only + derive new files).
"""
import argparse
import csv
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from scripts.lib.schemas import CaseSummary


def cmd_build(args) -> int:
    """Build report from a single run."""
    run_dir = Path(args.run_dir).resolve()
    cases_dir = run_dir / "cases"

    if not cases_dir.exists():
        print(f"ERROR: {cases_dir} not found", file=sys.stderr)
        return 1

    summaries: list[CaseSummary] = []
    for case_path in sorted(cases_dir.iterdir()):
        summary_file = case_path / "summary.json"
        if summary_file.exists():
            data = json.loads(summary_file.read_text())
            summaries.append(CaseSummary(**data))

    if not summaries:
        print("WARNING: no summaries found", file=sys.stderr)
        return 0

    # Write scoreboard.csv
    csv_path = run_dir / "scoreboard.csv"
    with open(csv_path, "w", newline="") as f:
        writer = csv.writer(f)
        writer.writerow([
            "test_id", "ability", "platform", "static_score", "dynamic_score",
            "final_score", "passed", "failure_reason",
        ])
        for s in summaries:
            static_score = s.static_result.score if s.static_result else 0.0
            dynamic_score = s.dynamic_result.score if s.dynamic_result else 0.0
            writer.writerow([
                s.test_id, s.ability, s.platform,
                f"{static_score:.4f}", f"{dynamic_score:.4f}",
                f"{s.final_score:.4f}", s.passed, s.failure_reason or "",
            ])

    # Write report.md with Mermaid
    total = len(summaries)
    passed = sum(1 for s in summaries if s.passed)
    failed = total - passed
    pass_rate = passed / total * 100 if total > 0 else 0

    report_lines = [
        "# TRTC Eval Report",
        "",
        f"**Run**: `{run_dir.name}`  ",
        f"**Cases**: {total} | **Passed**: {passed} | **Failed**: {failed} | **Pass Rate**: {pass_rate:.1f}%",
        "",
        "## Pass Rate",
        "",
        "```mermaid",
        "pie title Pass Rate",
        f'    \"Passed\" : {passed}',
        f'    \"Failed\" : {failed}',
        "```",
        "",
        "## Scoreboard",
        "",
        "| Test ID | Ability | Platform | Static | Dynamic | Final | Passed | Failure |",
        "|---------|---------|----------|--------|---------|-------|--------|---------|",
    ]
    for s in summaries:
        static_score = s.static_result.score if s.static_result else 0.0
        dynamic_score = s.dynamic_result.score if s.dynamic_result else 0.0
        status = "✅" if s.passed else "❌"
        report_lines.append(
            f"| {s.test_id} | {s.ability} | {s.platform} | "
            f"{static_score:.2f} | {dynamic_score:.2f} | {s.final_score:.2f} | "
            f"{status} | {s.failure_reason or '-'} |"
        )

    report_lines.extend(["", "## Errata (Failed Cases)", ""])
    failed_cases = [s for s in summaries if not s.passed]
    if not failed_cases:
        report_lines.append("_All cases passed!_")
    else:
        for s in failed_cases:
            report_lines.append(f"### {s.test_id} — {s.ability}")
            report_lines.append(f"- **Reason**: {s.failure_reason}")
            report_lines.append(f"- **Final Score**: {s.final_score:.4f}")
            report_lines.append(f"- **Artifacts**: `{s.artifacts_dir}`")
            report_lines.append("")

    (run_dir / "report.md").write_text("\n".join(report_lines))

    # Write errata.md separately
    errata_lines = ["# Errata (错题本)", ""]
    for s in failed_cases:
        errata_lines.append(f"## {s.test_id}")
        errata_lines.append(f"- Ability: {s.ability}")
        errata_lines.append(f"- Platform: {s.platform}")
        errata_lines.append(f"- Failure: {s.failure_reason}")
        errata_lines.append(f"- Score: {s.final_score:.4f}")
        errata_lines.append("")
    (run_dir / "errata.md").write_text("\n".join(errata_lines))

    print(f"Report written to {run_dir / 'report.md'}")
    return 0


def cmd_diff(args) -> int:
    """Compare baseline vs current runs."""
    baseline_dir = Path(args.baseline).resolve()
    current_dir = Path(args.current).resolve()

    baseline_csv = baseline_dir / "scoreboard.csv"
    current_csv = current_dir / "scoreboard.csv"

    if not baseline_csv.exists() or not current_csv.exists():
        print("ERROR: scoreboard.csv missing in baseline or current", file=sys.stderr)
        return 1

    def read_scores(csv_path: Path) -> dict[str, dict]:
        results = {}
        with open(csv_path) as f:
            reader = csv.DictReader(f)
            for row in reader:
                results[row["test_id"]] = row
        return results

    baseline = read_scores(baseline_csv)
    current = read_scores(current_csv)

    regressed = []
    fixed = []
    score_drop = []
    score_up = []
    new_cases = []
    removed = []

    all_ids = set(baseline.keys()) | set(current.keys())
    for tid in sorted(all_ids):
        if tid in current and tid not in baseline:
            new_cases.append(tid)
            continue
        if tid in baseline and tid not in current:
            removed.append(tid)
            continue

        b = baseline[tid]
        c = current[tid]
        b_passed = b["passed"] == "True"
        c_passed = c["passed"] == "True"
        b_score = float(b["final_score"])
        c_score = float(c["final_score"])

        if b_passed and not c_passed:
            regressed.append({"test_id": tid, "old_score": b_score, "new_score": c_score,
                              "failure_reason": c.get("failure_reason", "")})
        elif not b_passed and c_passed:
            fixed.append(tid)
        elif c_passed and b_passed:
            diff = c_score - b_score
            if diff <= -0.1:
                score_drop.append({"test_id": tid, "old": b_score, "new": c_score})
            elif diff >= 0.1:
                score_up.append({"test_id": tid, "old": b_score, "new": c_score})

    # Write diff report
    lines = [
        "# Diff Report",
        "",
        f"**Baseline**: `{baseline_dir.name}`  ",
        f"**Current**: `{current_dir.name}`",
        "",
    ]

    if regressed:
        lines.append("## ❌ Regressed")
        for r in regressed:
            lines.append(f"- **{r['test_id']}**: {r['old_score']:.4f} → {r['new_score']:.4f} ({r['failure_reason']})")
        lines.append("")

    if fixed:
        lines.append("## ✅ Fixed")
        for tid in fixed:
            lines.append(f"- {tid}")
        lines.append("")

    if score_drop:
        lines.append("## ⚠️ Score Drop (≥0.1)")
        for d in score_drop:
            lines.append(f"- **{d['test_id']}**: {d['old']:.4f} → {d['new']:.4f}")
        lines.append("")

    if score_up:
        lines.append("## 📈 Score Up (≥0.1)")
        for u in score_up:
            lines.append(f"- **{u['test_id']}**: {u['old']:.4f} → {u['new']:.4f}")
        lines.append("")

    if new_cases:
        lines.append("## 🆕 New Cases")
        for tid in new_cases:
            lines.append(f"- {tid}")
        lines.append("")

    if removed:
        lines.append("## 🗑️ Removed Cases")
        for tid in removed:
            lines.append(f"- {tid}")
        lines.append("")

    if not any([regressed, fixed, score_drop, score_up, new_cases, removed]):
        lines.append("_No changes detected._")

    (current_dir / "diff_report.md").write_text("\n".join(lines))

    # Exit code per §3.6.2
    if regressed:
        return 1
    if score_drop:
        return 2
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description="Report generation")
    sub = ap.add_subparsers(dest="command")

    build_p = sub.add_parser("build", help="Generate report from a run")
    build_p.add_argument("--run-dir", required=True)

    diff_p = sub.add_parser("diff", help="Compare two runs")
    diff_p.add_argument("--baseline", required=True)
    diff_p.add_argument("--current", required=True)

    args = ap.parse_args()
    if args.command == "build":
        return cmd_build(args)
    elif args.command == "diff":
        return cmd_diff(args)
    else:
        ap.print_help()
        return 0


if __name__ == "__main__":
    sys.exit(main())
