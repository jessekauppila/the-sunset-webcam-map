#!/usr/bin/env python3
"""Build a manifest of ORDINARY frames, for checking a hard-case-trained model.

Why this exists: 8,162 of the 8,220 webcam gold labels (99.3%) came from the
Hard Examples disagreement queue, and only 8,281 of 55,414 imaged frames have
ever been flagged hard. So a model trained and tested on the gold set has been
measured on roughly the hardest 15% of the corpus and never on the other 85%
— which is what production actually sees.

This samples random LLM-rated frames that are:
  1. not in manual_labels (so they are ordinary, not adjudicated hard cases),
  2. from cameras absent from the gold train AND val splits (so a good score
     cannot come from having memorised the camera).

`llm_is_sunset` is the reference label. Claude is NOT ground truth — on the
1,224 gold/LLM overlap frames it disagreed with the operator 211 times — so
treat the result as gross-failure detection, not precise measurement. High
disagreement is ambiguous and has to be eyeballed: it can mean the model is
wrong, or that Claude is (the silhouette blind spot).

Usage:
  python ml/build_holdout_manifest.py \
    --gold-manifest ml/artifacts/datasets/gold_baseline/<ts>/manifest_full.csv \
    --output ml/artifacts/datasets/holdout_ordinary/manifest_test.csv
"""

from __future__ import annotations

import argparse
import csv
import os
import random
from pathlib import Path

import psycopg2
import psycopg2.extras


def excluded_cameras(gold_manifest: str) -> set[str]:
    """Cameras in the gold train/val splits — excluded so the sample is unseen.

    Test-split cameras are fine to keep: the model never trained on them
    either, and dropping them would shrink the pool for no gain.
    """
    excluded: set[str] = set()
    with open(gold_manifest) as fh:
        for row in csv.DictReader(fh):
            if row["source"] == "webcam" and row["split"] in ("train", "val"):
                excluded.add(row["webcam_id"])
    return excluded


def main() -> None:
    p = argparse.ArgumentParser(description="Sample ordinary (non-hard) frames")
    p.add_argument("--database-url", default=os.getenv("DATABASE_URL"))
    p.add_argument("--gold-manifest", required=True)
    p.add_argument("--output", required=True)
    p.add_argument("--sample-size", type=int, default=2000)
    p.add_argument("--seed", type=int, default=20260212)
    args = p.parse_args()

    skip_cams = excluded_cameras(args.gold_manifest)
    print(f"  Excluding {len(skip_cams)} cameras seen in gold train/val")

    query = """
    SELECT s.id, s.webcam_id, s.firebase_url, s.llm_is_sunset, s.llm_quality
    FROM webcam_snapshots s
    LEFT JOIN manual_labels m
      ON m.source = 'webcam' AND m.image_id = s.id
    WHERE s.firebase_url IS NOT NULL
      AND s.llm_quality IS NOT NULL
      AND s.llm_is_sunset IS NOT NULL
      AND m.id IS NULL
      AND s.model_disagreement_kind IS NULL
    """
    with psycopg2.connect(args.database_url) as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(query)
            rows = [dict(r) for r in cur.fetchall()]

    print(f"  Ordinary LLM-rated frames available: {len(rows)}")
    rows = [r for r in rows if str(r["webcam_id"]) not in skip_cams]
    print(f"  After excluding seen cameras:        {len(rows)}")

    rng = random.Random(args.seed)
    rng.shuffle(rows)
    sample = rows[: args.sample_size]

    positives = sum(1 for r in sample if r["llm_is_sunset"])
    print(
        f"  Sampled {len(sample)} frames from "
        f"{len({r['webcam_id'] for r in sample})} cameras; "
        f"{positives} positive ({positives / max(len(sample), 1):.1%})"
    )

    out = Path(args.output)
    out.parent.mkdir(parents=True, exist_ok=True)
    with out.open("w", newline="") as fh:
        w = csv.DictWriter(
            fh,
            fieldnames=[
                "snapshot_id", "webcam_id", "image_path_or_url",
                "target_label", "source", "llm_quality",
            ],
        )
        w.writeheader()
        for r in sample:
            w.writerow({
                "snapshot_id": r["id"],
                "webcam_id": r["webcam_id"],
                "image_path_or_url": r["firebase_url"],
                "target_label": 1 if r["llm_is_sunset"] else 0,
                "source": "webcam",
                "llm_quality": r["llm_quality"],
            })
    print(f"  Wrote {out}")


if __name__ == "__main__":
    main()
