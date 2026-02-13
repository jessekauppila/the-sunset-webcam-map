#!/usr/bin/env python3
"""
Deterministic dataset export for AI model training.

Manual-first default:
  --label-source manual_only

Public-ready later:
  --label-source public_aggregate
"""

from __future__ import annotations

import argparse
import json
import os
from dataclasses import asdict
from pathlib import Path
from typing import Any

import psycopg2
import psycopg2.extras
from tqdm.auto import tqdm

from common.io import ensure_dir, env_required, utc_timestamp, write_csv, write_json
from common.labels import LabelPolicy, map_label
from common.splits import SplitConfig, assign_split


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Export training manifests")
    parser.add_argument("--database-url", default=os.getenv("DATABASE_URL"))
    parser.add_argument(
        "--label-source",
        choices=["manual_only", "public_aggregate"],
        default="manual_only",
    )
    parser.add_argument("--target-type", choices=["binary", "regression"], default="binary")
    parser.add_argument("--binary-threshold", type=float, default=4.0)
    parser.add_argument("--min-rating-count", type=int, default=2)
    parser.add_argument("--seed", type=int, default=20260212)
    parser.add_argument("--train-pct", type=int, default=70)
    parser.add_argument("--val-pct", type=int, default=15)
    parser.add_argument("--test-pct", type=int, default=15)
    parser.add_argument("--output-dir", default="ml/artifacts/datasets")
    parser.add_argument("--training-run-id", type=int)
    parser.add_argument("--no-progress", action="store_true")
    return parser.parse_args()


def fetch_rows(
    conn: psycopg2.extensions.connection,
    label_source: str,
    min_rating_count: int,
) -> list[dict[str, Any]]:
    """
    Query candidate labeled snapshots for export.

    manual_only:
      Uses all snapshots with calculated rating and minimum rating count.
    public_aggregate:
      Uses snapshots backed by public votes and stricter confidence gate.
    """
    if label_source == "public_aggregate":
        query = """
        SELECT
          s.id AS snapshot_id,
          s.webcam_id,
          s.firebase_url AS image_path_or_url,
          s.phase,
          s.captured_at,
          s.calculated_rating AS label_value,
          COUNT(r.id)::int AS rating_count
        FROM webcam_snapshots s
        JOIN webcam_snapshot_ratings r
          ON r.snapshot_id = s.id
        WHERE s.firebase_url IS NOT NULL
          AND s.calculated_rating IS NOT NULL
        GROUP BY
          s.id, s.webcam_id, s.firebase_url, s.phase, s.captured_at, s.calculated_rating
        HAVING COUNT(r.id) >= %(min_rating_count)s
        """
    else:
        query = """
        SELECT
          s.id AS snapshot_id,
          s.webcam_id,
          s.firebase_url AS image_path_or_url,
          s.phase,
          s.captured_at,
          s.calculated_rating AS label_value,
          COUNT(r.id)::int AS rating_count
        FROM webcam_snapshots s
        LEFT JOIN webcam_snapshot_ratings r
          ON r.snapshot_id = s.id
        WHERE s.firebase_url IS NOT NULL
          AND s.calculated_rating IS NOT NULL
        GROUP BY
          s.id, s.webcam_id, s.firebase_url, s.phase, s.captured_at, s.calculated_rating
        HAVING COUNT(r.id) >= %(min_rating_count)s
        """

    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(query, {"min_rating_count": min_rating_count})
        return [dict(row) for row in cur.fetchall()]


def write_training_run_labels(
    conn: psycopg2.extensions.connection,
    training_run_id: int,
    rows: list[dict[str, Any]],
    label_source: str,
) -> None:
    """
    Persist exact sample membership for auditability/reproducibility.

    This enables us to answer: "which snapshots trained model X?"
    """
    with conn.cursor() as cur:
        cur.executemany(
            """
            INSERT INTO model_training_snapshot_labels (
              training_run_id,
              snapshot_id,
              label_source,
              label_value,
              included_at
            )
            VALUES (%s, %s, %s, %s, NOW())
            ON CONFLICT (training_run_id, snapshot_id)
            DO UPDATE SET
              label_source = EXCLUDED.label_source,
              label_value = EXCLUDED.label_value,
              included_at = NOW()
            """,
            [
                (
                    training_run_id,
                    row["snapshot_id"],
                    label_source,
                    row["label_value"],
                )
                for row in rows
            ],
        )
    conn.commit()


def main() -> None:
    args = parse_args()
    database_url = args.database_url or env_required("DATABASE_URL")

    split_cfg = SplitConfig(
        seed=args.seed,
        train_pct=args.train_pct,
        val_pct=args.val_pct,
        test_pct=args.test_pct,
    )
    split_cfg.validate()
    label_policy = LabelPolicy(
        target_type=args.target_type,
        binary_threshold=args.binary_threshold,
    )

    with psycopg2.connect(database_url) as conn:
        rows = fetch_rows(conn, args.label_source, args.min_rating_count)

        manifest: list[dict[str, Any]] = []
        for row in tqdm(
            rows,
            desc="Building manifest",
            unit="row",
            disable=args.no_progress,
        ):
            # Deterministic webcam-group split (prevents leakage across splits).
            split = assign_split(int(row["webcam_id"]), split_cfg)
            # Convert raw rating into task target (binary/regression).
            mapped_label = map_label(float(row["label_value"]), label_policy)
            manifest.append(
                {
                    "snapshot_id": row["snapshot_id"],
                    "webcam_id": row["webcam_id"],
                    "label_source": args.label_source,
                    "label_value": row["label_value"],
                    "target_label": mapped_label,
                    "split": split,
                    "image_path_or_url": row["image_path_or_url"],
                    "phase": row["phase"],
                    "captured_at": row["captured_at"],
                    "rating_count": row["rating_count"],
                }
            )

        out_root = ensure_dir(Path(args.output_dir) / utc_timestamp())
        write_csv(out_root / "manifest_full.csv", manifest)
        write_csv(
            out_root / "manifest_train.csv",
            [r for r in manifest if r["split"] == "train"],
        )
        write_csv(
            out_root / "manifest_val.csv",
            [r for r in manifest if r["split"] == "val"],
        )
        write_csv(
            out_root / "manifest_test.csv",
            [r for r in manifest if r["split"] == "test"],
        )

        meta = {
            # Keep run metadata near artifacts for reproducibility/debugging.
            "label_source": args.label_source,
            "target_type": args.target_type,
            "binary_threshold": args.binary_threshold,
            "min_rating_count": args.min_rating_count,
            "split_config": asdict(split_cfg),
            "counts": {
                "total": len(manifest),
                "train": sum(1 for r in manifest if r["split"] == "train"),
                "val": sum(1 for r in manifest if r["split"] == "val"),
                "test": sum(1 for r in manifest if r["split"] == "test"),
            },
        }
        write_json(out_root / "export_meta.json", meta)

        if args.training_run_id:
            write_training_run_labels(
                conn=conn,
                training_run_id=args.training_run_id,
                rows=manifest,
                label_source=args.label_source,
            )

    print(json.dumps({"ok": True, "output_dir": str(out_root), "meta": meta}, indent=2))


if __name__ == "__main__":
    main()
