#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
from typing import Any

import psycopg2
import psycopg2.extras

from common.io import ensure_dir, env_required, utc_timestamp, write_csv, write_json


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Audit snapshot coverage and rating integrity. "
            "Exports CSV lists for all snapshots, rated snapshots, and mismatches."
        )
    )
    parser.add_argument("--database-url", default=os.getenv("DATABASE_URL"))
    parser.add_argument("--output-dir", default="ml/artifacts/reports/snapshot_audit")
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument(
        "--sort",
        choices=["captured_desc", "captured_asc", "id_desc", "id_asc"],
        default="captured_desc",
    )
    return parser.parse_args()


def _order_by_clause(sort: str) -> str:
    if sort == "captured_asc":
        return "ORDER BY s.captured_at ASC NULLS LAST, s.id ASC"
    if sort == "id_desc":
        return "ORDER BY s.id DESC"
    if sort == "id_asc":
        return "ORDER BY s.id ASC"
    return "ORDER BY s.captured_at DESC NULLS LAST, s.id DESC"


def _limit_clause(limit: int) -> str:
    if limit <= 0:
        return ""
    return "LIMIT %(limit)s"


def fetch_snapshot_rows(
    conn: psycopg2.extensions.connection, sort: str, limit: int
) -> list[dict[str, Any]]:
    query = f"""
    WITH rating_stats AS (
      SELECT
        snapshot_id,
        COUNT(*)::int AS rating_count,
        COUNT(DISTINCT user_session_id)::int AS unique_rater_count,
        MIN(created_at) AS first_rating_at,
        MAX(created_at) AS last_rating_at
      FROM webcam_snapshot_ratings
      GROUP BY snapshot_id
    )
    SELECT
      s.id AS snapshot_id,
      s.webcam_id,
      s.phase,
      s.rank,
      s.captured_at,
      s.created_at,
      s.firebase_url,
      s.firebase_path,
      s.initial_rating,
      s.calculated_rating,
      s.ai_rating,
      COALESCE(rs.rating_count, 0)::int AS rating_count,
      COALESCE(rs.unique_rater_count, 0)::int AS unique_rater_count,
      rs.first_rating_at,
      rs.last_rating_at,
      (s.firebase_url IS NOT NULL)::boolean AS has_firebase_url,
      (s.calculated_rating IS NOT NULL)::boolean AS has_calculated_rating,
      (COALESCE(rs.rating_count, 0) > 0)::boolean AS has_rating_rows
    FROM webcam_snapshots s
    LEFT JOIN rating_stats rs
      ON rs.snapshot_id = s.id
    {_order_by_clause(sort)}
    {_limit_clause(limit)}
    """
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(query, {"limit": limit})
        return [dict(row) for row in cur.fetchall()]


def build_summary(rows: list[dict[str, Any]]) -> dict[str, Any]:
    total = len(rows)
    with_firebase = sum(1 for r in rows if r["has_firebase_url"])
    with_calc = sum(1 for r in rows if r["has_calculated_rating"])
    with_ratings = sum(1 for r in rows if r["has_rating_rows"])
    export_manual_only_min1_equivalent = sum(
        1
        for r in rows
        if r["has_firebase_url"] and r["has_calculated_rating"] and r["rating_count"] >= 1
    )
    ratings_without_calculated = sum(
        1 for r in rows if r["rating_count"] >= 1 and not r["has_calculated_rating"]
    )
    calculated_without_ratings = sum(
        1 for r in rows if r["has_calculated_rating"] and r["rating_count"] == 0
    )
    rated_missing_firebase = sum(
        1 for r in rows if r["rating_count"] >= 1 and not r["has_firebase_url"]
    )

    return {
        "total_snapshots": total,
        "with_firebase_url": with_firebase,
        "with_calculated_rating": with_calc,
        "with_any_rating_rows": with_ratings,
        "export_manual_only_min_rating_1_equivalent": export_manual_only_min1_equivalent,
        "mismatches": {
            "rating_rows_but_no_calculated_rating": ratings_without_calculated,
            "calculated_rating_but_no_rating_rows": calculated_without_ratings,
            "rating_rows_but_no_firebase_url": rated_missing_firebase,
        },
    }


def main() -> None:
    args = parse_args()
    database_url = args.database_url or env_required("DATABASE_URL")

    with psycopg2.connect(database_url) as conn:
        rows = fetch_snapshot_rows(conn, sort=args.sort, limit=args.limit)
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                """
                SELECT
                  COUNT(*)::int AS total_rating_rows,
                  COUNT(DISTINCT snapshot_id)::int AS distinct_snapshots_with_ratings,
                  COUNT(DISTINCT user_session_id)::int AS distinct_user_sessions
                FROM webcam_snapshot_ratings
                """
            )
            rating_totals = dict(cur.fetchone() or {})

    all_snapshots = rows
    rated_snapshots = [r for r in rows if r["rating_count"] >= 1]
    export_eligible = [
        r
        for r in rows
        if r["has_firebase_url"] and r["has_calculated_rating"] and r["rating_count"] >= 1
    ]
    mismatches_rating_no_calc = [
        r for r in rows if r["rating_count"] >= 1 and not r["has_calculated_rating"]
    ]
    mismatches_calc_no_rating = [
        r for r in rows if r["has_calculated_rating"] and r["rating_count"] == 0
    ]
    mismatches_rating_no_firebase = [
        r for r in rows if r["rating_count"] >= 1 and not r["has_firebase_url"]
    ]

    summary = build_summary(rows)
    summary["rating_table_totals"] = rating_totals
    rated_snapshot_count = summary["with_any_rating_rows"]
    total_rating_rows = rating_totals.get("total_rating_rows", 0)
    summary["avg_rating_rows_per_rated_snapshot"] = (
        round(total_rating_rows / rated_snapshot_count, 4) if rated_snapshot_count else 0.0
    )
    summary["query"] = {"sort": args.sort, "limit": args.limit}

    out_root = ensure_dir(Path(args.output_dir) / utc_timestamp())
    write_csv(out_root / "all_snapshots.csv", all_snapshots)
    write_csv(out_root / "rated_snapshots.csv", rated_snapshots)
    write_csv(out_root / "export_eligible_snapshots.csv", export_eligible)
    write_csv(
        out_root / "mismatch_rating_rows_but_no_calculated_rating.csv",
        mismatches_rating_no_calc,
    )
    write_csv(
        out_root / "mismatch_calculated_rating_but_no_rating_rows.csv",
        mismatches_calc_no_rating,
    )
    write_csv(
        out_root / "mismatch_rating_rows_but_no_firebase_url.csv",
        mismatches_rating_no_firebase,
    )
    write_json(out_root / "summary.json", summary)

    print(
        json.dumps(
            {
                "ok": True,
                "output_dir": str(out_root),
                "summary": summary,
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
