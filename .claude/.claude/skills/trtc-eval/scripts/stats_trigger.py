"""stats_trigger.py — Trigger rate statistics for the eval skill.

Usage:
  python scripts/stats_trigger.py --last=30d
"""
import argparse
import json
import sys
from collections import Counter
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from scripts.lib.eval_config import repo_root


TRIGGER_LOG = repo_root() / ".claude" / "eval-runs" / "_trigger_log.jsonl"


def main() -> int:
    ap = argparse.ArgumentParser(description="Trigger rate analysis")
    ap.add_argument("--last", default="30d", help="Time window (e.g. 7d, 30d)")
    args = ap.parse_args()

    # Parse time window
    days = int(args.last.rstrip("d"))
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)

    if not TRIGGER_LOG.exists():
        print("No trigger log found. Run the eval skill first.")
        return 0

    total = 0
    matched = 0
    failed = 0
    keywords: Counter = Counter()

    for line in TRIGGER_LOG.read_text().splitlines():
        if not line.strip():
            continue
        try:
            entry = json.loads(line)
        except json.JSONDecodeError:
            continue

        ts_str = entry.get("ts", "")
        try:
            ts = datetime.fromisoformat(ts_str)
            if ts < cutoff:
                continue
        except (ValueError, TypeError):
            continue

        total += 1
        if entry.get("trigger_matched"):
            matched += 1
            # Extract trigger keyword
            kw = entry.get("trigger_keyword", "unknown")
            keywords[kw] += 1
        else:
            failed += 1

    print(f"=== Trigger Stats (last {days} days) ===")
    print(f"Total attempts: {total}")
    print(f"Matched: {matched}")
    print(f"Failed: {failed}")
    print(f"Match rate: {matched / total * 100:.1f}%" if total > 0 else "N/A")
    print()
    print("Top keywords:")
    for kw, count in keywords.most_common(10):
        print(f"  {kw}: {count}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
