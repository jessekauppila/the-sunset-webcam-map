#!/usr/bin/env python3
"""Export a fully rated label sample as operator-truth manifest CSVs.

The random_ordinary_v1 manifests were built ad hoc in-session (commit
18ed7f9a7); this makes the join reproducible for v2 and any later draw.
Reads `label_samples` (the frozen draw) joined with `manual_labels`
(origin = sample name) and emits, into
ml/artifacts/datasets/<sample_name>/:

  manifest_operator_is_sunset.csv  target_label = operator is_sunset (0/1)
  manifest_operator_r4.csv         target_label = rating >= 4
  manifest_operator_quality.csv    operator-confirmed sunsets only, with the
                                   raw 1-5 rating and the normalized [0,1]
                                   quality_label = (rating - 1) / 4

Column layout matches the v1 manifests so ml/score_manifest.py consumes
them unchanged. Refuses to export a sample that is not fully labeled —
a partial export would silently bias every number computed from it.

Usage:
  .venv/bin/python ml/build_operator_manifest.py --sample-name random_ordinary_v2
"""

from __future__ import annotations

import argparse
import csv
import sys
from pathlib import Path

import psycopg2
import psycopg2.extras

from load_label_sample import load_env_local


QUERY = """
SELECT s.image_id      AS snapshot_id,
       w.webcam_id,
       w.firebase_url  AS image_path_or_url,
       s.source,
       w.llm_quality,
       m.is_sunset,
       m.rating
FROM label_samples s
JOIN webcam_snapshots w ON w.id = s.image_id
LEFT JOIN manual_labels m
  ON m.source = s.source AND m.image_id = s.image_id AND m.origin = %s
WHERE s.sample_name = %s
ORDER BY s.position
"""


def write_manifest(path: Path, rows: list[dict], extra_cols: list[str] = []) -> None:
    cols = ["snapshot_id", "webcam_id", "image_path_or_url",
            "target_label", "source", "llm_quality"] + extra_cols
    with path.open("w", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=cols)
        writer.writeheader()
        for r in rows:
            writer.writerow({c: r[c] for c in cols})
    print(f"  wrote {path}  ({len(rows)} rows)")


def main() -> None:
    p = argparse.ArgumentParser(description="Export operator manifests for a rated sample")
    p.add_argument("--sample-name", required=True)
    args = p.parse_args()

    load_env_local()
    import os

    conn = psycopg2.connect(os.environ["DATABASE_URL"])
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(QUERY, (args.sample_name, args.sample_name))
        rows = [dict(r) for r in cur.fetchall()]
    conn.close()

    if not rows:
        sys.exit(f"no frames in label_samples for sample {args.sample_name!r}")
    unlabeled = [r for r in rows if r["is_sunset"] is None]
    if unlabeled:
        sys.exit(
            f"{len(unlabeled)} of {len(rows)} frames are unlabeled "
            f"(origin={args.sample_name!r}) — refusing a partial export"
        )
    # N is stored as is_sunset=false with rating NULL; a sunset must carry one.
    bad = [r for r in rows if r["is_sunset"] and r["rating"] is None]
    if bad:
        sys.exit(f"{len(bad)} frames have is_sunset=true but no rating")

    outdir = Path("ml/artifacts/datasets") / args.sample_name
    outdir.mkdir(parents=True, exist_ok=True)

    for r in rows:
        r["target_label"] = int(r["is_sunset"])
    write_manifest(outdir / "manifest_operator_is_sunset.csv", rows)

    for r in rows:
        r["target_label"] = int(bool(r["is_sunset"]) and r["rating"] >= 4)
    write_manifest(outdir / "manifest_operator_r4.csv", rows)

    sunsets = [r for r in rows if r["is_sunset"]]
    for r in sunsets:
        r["target_label"] = int(r["is_sunset"])
        r["quality_label"] = (r["rating"] - 1) / 4
    write_manifest(
        outdir / "manifest_operator_quality.csv", sunsets,
        extra_cols=["rating", "quality_label"],
    )

    dist: dict[str, int] = {}
    for r in rows:
        key = str(r["rating"]) if r["is_sunset"] else "N"
        dist[key] = dist.get(key, 0) + 1
    print(f"  distribution: {dict(sorted(dist.items()))}")


if __name__ == "__main__":
    main()
