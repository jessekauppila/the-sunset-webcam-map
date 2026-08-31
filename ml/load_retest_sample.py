#!/usr/bin/env python3
"""Freeze a stratified RETEST sample into `label_samples` (kind='retest').

A retest sample re-serves frames the operator has ALREADY rated, blind, so the
two passes measure test–retest reliability — the ceiling for any model trained
on these labels (roadmap: docs/superpowers/plans/
2026-08-30-quality-ceiling-and-labeling-roadmap.md, Phase 0).

Unlike load_label_sample.py, this draw comes FROM manual_labels rather than
excluding it, and the re-ratings land in manual_label_retests, never touching
the gold rows. kind='retest' tells both the queue API (serve despite an
existing label; drop out on a retest row) and the export quarantine (whose
NOT EXISTS guard is scoped to kind='draw') what this sample is.

Stratification (webcam frames with a live firebase_url only):
  quality arm    — 15 frames per rating 1..5; shortfall in a bucket
                   redistributes to the nearest ratings with surplus
  detection arm  — 40 N frames (is_sunset = false) + 35 rating-1 frames
                   (disjoint from the quality arm's rating-1 picks)
Within every bucket, frames whose original label is >= --stale-days old are
preferred: a fresher memory of the first pass inflates agreement.

Usage:
  .venv/bin/python ml/load_retest_sample.py --sample-name retest_v1 --dry-run
  .venv/bin/python ml/load_retest_sample.py --sample-name retest_v1
"""

from __future__ import annotations

import argparse
import os
import random
import sys
from pathlib import Path

import psycopg2
import psycopg2.extras

QUALITY_PER_RATING = 15  # ratings 1..5
DETECTION_N = 40         # is_sunset = false
DETECTION_R1 = 35        # extra rating-1 frames for the N/1 boundary


def load_env_local() -> None:
    """Match run_training.py: DATABASE_URL lives in .env.local, not the shell."""
    env = Path(__file__).resolve().parent.parent / ".env.local"
    if not env.exists():
        return
    for line in env.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, val = line.partition("=")
        os.environ.setdefault(key.strip(), val.strip().strip('"').strip("'"))


def draw_bucket(cur, where_sql: str, params: tuple, want: int,
                stale_days: int, rng: random.Random,
                exclude: set[int]) -> tuple[list[int], int]:
    """Return (picked image_ids, stale_count_in_pick), stale-first."""
    cur.execute(
        f"""
        SELECT m.image_id,
               (m.labeled_at < now() - %s * interval '1 day') AS stale
        FROM manual_labels m
        JOIN webcam_snapshots s ON s.id = m.image_id
        WHERE m.source = 'webcam' AND s.firebase_url IS NOT NULL AND {where_sql}
        """,
        (stale_days, *params),
    )
    rows = [(r[0], r[1]) for r in cur.fetchall() if r[0] not in exclude]
    stale = [iid for iid, is_stale in rows if is_stale]
    fresh = [iid for iid, is_stale in rows if not is_stale]
    rng.shuffle(stale)
    rng.shuffle(fresh)
    picked = (stale + fresh)[:want]
    return picked, sum(1 for iid in picked if iid in set(stale))


def main() -> None:
    p = argparse.ArgumentParser(description="Freeze a stratified retest sample")
    p.add_argument("--sample-name", required=True)
    p.add_argument("--seed", type=int, default=20260830)
    p.add_argument("--stale-days", type=int, default=14)
    p.add_argument("--dry-run", action="store_true")
    args = p.parse_args()

    load_env_local()
    database_url = os.getenv("DATABASE_URL")
    if not database_url:
        sys.exit("DATABASE_URL not set (looked in the environment and .env.local)")

    rng = random.Random(args.seed)
    picked: dict[str, list[int]] = {}
    stale_counts: dict[str, int] = {}
    taken: set[int] = set()

    with psycopg2.connect(database_url) as conn:
        with conn.cursor() as cur:
            # Quality arm, walking 1..5; collect shortfalls, then redistribute.
            shortfall = 0
            for r in range(1, 6):
                ids, n_stale = draw_bucket(
                    cur, "m.is_sunset AND m.rating = %s", (r,),
                    QUALITY_PER_RATING, args.stale_days, rng, taken)
                picked[f"q{r}"] = ids
                stale_counts[f"q{r}"] = n_stale
                taken.update(ids)
                shortfall += QUALITY_PER_RATING - len(ids)
            # Redistribute shortfall outward from 5 down (the scarce end is
            # usually 5; surplus usually lives in 1-3).
            for r in (4, 3, 2, 1):
                if shortfall <= 0:
                    break
                extra, n_stale = draw_bucket(
                    cur, "m.is_sunset AND m.rating = %s", (r,),
                    shortfall, args.stale_days, rng, taken)
                picked[f"q{r}"].extend(extra)
                stale_counts[f"q{r}"] += n_stale
                taken.update(extra)
                shortfall -= len(extra)

            ids, n_stale = draw_bucket(
                cur, "NOT m.is_sunset", (), DETECTION_N,
                args.stale_days, rng, taken)
            picked["dN"] = ids
            stale_counts["dN"] = n_stale
            taken.update(ids)

            ids, n_stale = draw_bucket(
                cur, "m.is_sunset AND m.rating = %s", (1,), DETECTION_R1,
                args.stale_days, rng, taken)
            picked["d1"] = ids
            stale_counts["d1"] = n_stale
            taken.update(ids)

            # Informational: overlap with existing draw samples (eval frames).
            all_ids = [iid for ids in picked.values() for iid in ids]
            cur.execute(
                "SELECT count(DISTINCT image_id) FROM label_samples "
                "WHERE source = 'webcam' AND image_id = ANY(%s)",
                (all_ids,),
            )
            in_draws = cur.fetchone()[0]

    total = len(all_ids)
    print(f"  Buckets (want q1-5={QUALITY_PER_RATING} each, "
          f"dN={DETECTION_N}, d1={DETECTION_R1}; seed {args.seed}):")
    for name in ("q1", "q2", "q3", "q4", "q5", "dN", "d1"):
        n = len(picked[name])
        print(f"    {name}: {n:3d}  ({stale_counts[name]} stale >= {args.stale_days}d)")
    print(f"  Total {total}; {in_draws} also belong to an existing draw sample "
          f"(fine — their retest rows are separate)")

    if args.dry_run:
        print("  --dry-run: nothing written")
        return

    rng.shuffle(all_ids)
    records = [
        (args.sample_name, "webcam", iid, i, "retest")
        for i, iid in enumerate(all_ids)
    ]
    with psycopg2.connect(database_url) as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT count(*) FROM label_samples WHERE sample_name = %s",
                (args.sample_name,),
            )
            before = cur.fetchone()[0]
            # Idempotent: re-running with the same name and seed is a no-op, and
            # never renumbers positions out from under a half-rated sitting.
            psycopg2.extras.execute_values(
                cur,
                """
                INSERT INTO label_samples (sample_name, source, image_id, position, kind)
                VALUES %s
                ON CONFLICT (sample_name, source, image_id) DO NOTHING
                """,
                records,
            )
            cur.execute(
                "SELECT count(*) FROM label_samples WHERE sample_name = %s",
                (args.sample_name,),
            )
            after = cur.fetchone()[0]
    print(f"  Inserted {after - before} new rows; '{args.sample_name}' now holds {after}")


if __name__ == "__main__":
    main()
