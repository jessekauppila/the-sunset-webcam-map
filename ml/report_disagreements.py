#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path

import psycopg2
import psycopg2.extras


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate AI vs human disagreement report")
    parser.add_argument("--database-url", default=os.getenv("DATABASE_URL"))
    parser.add_argument("--model-version")
    parser.add_argument("--limit", type=int, default=200)
    parser.add_argument("--output", default="ml/artifacts/reports/disagreement_report.json")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    if not args.database_url:
        raise RuntimeError("DATABASE_URL is required via --database-url or env")

    query = """
    SELECT
      s.id AS snapshot_id,
      s.webcam_id,
      s.phase,
      s.captured_at,
      s.calculated_rating,
      i.ai_rating,
      i.model_version,
      ABS(i.ai_rating - s.calculated_rating) AS abs_diff
    FROM webcam_snapshots s
    JOIN snapshot_ai_inferences i
      ON i.snapshot_id = s.id
    WHERE s.calculated_rating IS NOT NULL
      AND (%(model_version)s IS NULL OR i.model_version = %(model_version)s)
    ORDER BY abs_diff DESC
    LIMIT %(limit)s
    """

    with psycopg2.connect(args.database_url) as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(query, {"model_version": args.model_version, "limit": args.limit})
            rows = [dict(r) for r in cur.fetchall()]

    near_threshold = [
        r for r in rows if r["ai_rating"] is not None and 3.7 <= float(r["ai_rating"]) <= 4.3
    ]

    phase_summary = {}
    for r in rows:
        phase = r.get("phase") or "unknown"
        phase_summary.setdefault(phase, []).append(float(r["abs_diff"]))
    phase_summary = {
        phase: {
            "count": len(vals),
            "avg_abs_diff": (sum(vals) / len(vals)) if vals else 0.0,
        }
        for phase, vals in phase_summary.items()
    }

    report = {
        "model_version": args.model_version,
        "num_rows": len(rows),
        "phase_summary": phase_summary,
        "top_disagreements": rows[:50],
        "near_threshold_samples": near_threshold[:50],
    }

    out = Path(args.output)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(report, indent=2, default=str), encoding="utf-8")
    print(json.dumps({"ok": True, "output": out.as_posix(), "num_rows": len(rows)}, indent=2))


if __name__ == "__main__":
    main()
