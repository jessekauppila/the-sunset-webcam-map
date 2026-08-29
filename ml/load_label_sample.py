#!/usr/bin/env python3
"""Freeze a manifest CSV into `label_samples` so the queue UI can serve it.

The labeling queue pulls from the disagreement set, which is exactly the
population that biases every number in the two-scale STATE doc: 99.3% of the
gold labels came from it. To measure anything unbiased the operator has to rate
frames drawn at random from the ordinary majority — and the draw has to be
fixed before rating starts, or it drifts as labeled frames leave the pool.

Default input is the ordinary-frame holdout manifest. Taking the sample as a
SUBSET of that file is deliberate: those 2,000 frames are the ones the v5
detection heads were already scored on, so operator labels on 200 of them
re-grade an existing run against real ground truth without re-scoring anything.

Usage:
  .venv/bin/python ml/load_label_sample.py \
    --manifest ml/artifacts/datasets/holdout_ordinary/manifest_test.csv \
    --sample-name random_ordinary_v1 --limit 200
"""

from __future__ import annotations

import argparse
import csv
import os
import random
import sys
from pathlib import Path

import psycopg2
import psycopg2.extras


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


def main() -> None:
    p = argparse.ArgumentParser(description="Freeze a manifest into label_samples")
    p.add_argument(
        "--manifest",
        default="ml/artifacts/datasets/holdout_ordinary/manifest_test.csv",
    )
    p.add_argument("--sample-name", required=True)
    p.add_argument("--limit", type=int, default=200)
    p.add_argument("--seed", type=int, default=20260829)
    p.add_argument("--source", default="webcam", choices=["webcam", "flickr"])
    p.add_argument("--dry-run", action="store_true")
    args = p.parse_args()

    load_env_local()
    database_url = os.getenv("DATABASE_URL")
    if not database_url and not args.dry_run:
        sys.exit("DATABASE_URL not set (looked in the environment and .env.local)")

    with open(args.manifest) as fh:
        rows = list(csv.DictReader(fh))
    print(f"  Manifest rows: {len(rows)}")

    # Shuffle before truncating: the manifest is already in sampled order, but
    # taking its first N would tie this sample to that file's ordering rather
    # than to a seed of its own.
    rng = random.Random(args.seed)
    rng.shuffle(rows)
    sample = rows[: args.limit]

    cams = len({r["webcam_id"] for r in sample})
    llm_pos = sum(1 for r in sample if r["target_label"] == "1")
    print(
        f"  Drawing {len(sample)} frames from {cams} cameras "
        f"(seed {args.seed}); Claude calls {llm_pos} of them sunsets "
        f"({llm_pos / max(len(sample), 1):.1%})"
    )

    if args.dry_run:
        print("  --dry-run: nothing written")
        return

    records = [
        (args.sample_name, args.source, int(r["snapshot_id"]), i)
        for i, r in enumerate(sample)
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
                INSERT INTO label_samples (sample_name, source, image_id, position)
                VALUES %s
                ON CONFLICT (sample_name, source, image_id) DO NOTHING
                """,
                records,
            )
            cur.execute(
                "SELECT count(*) FROM label_samples WHERE sample_name = %s",
                (args.sample_name,),
            )
            total = cur.fetchone()[0]
            cur.execute(
                """
                SELECT count(*) FROM label_samples ls
                JOIN manual_labels m
                  ON m.source = ls.source AND m.image_id = ls.image_id
                WHERE ls.sample_name = %s
                """,
                (args.sample_name,),
            )
            labeled = cur.fetchone()[0]

    # Counted before/after, not from cur.rowcount: execute_values pages at 100,
    # so rowcount reports only the final page and reads as a silent truncation.
    print(f"  Inserted {total - before} new rows; '{args.sample_name}' now holds {total}")
    print(f"  Already labeled: {labeled} / {total}")


if __name__ == "__main__":
    main()
