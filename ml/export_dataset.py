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

import pandas as pd

from common.io import ensure_dir, env_required, utc_timestamp, write_csv, write_json
from common.labels import LabelPolicy, map_label
from common.splits import SplitConfig, assign_split


def load_llm_overrides(csv_path: str) -> dict[int, float]:
    """Load LLM ratings CSV and return {record_id: llm_quality} mapping."""
    df = pd.read_csv(csv_path)
    overrides: dict[int, float] = {}
    for _, row in df.iterrows():
        if row.get("source_table") == "webcam" and pd.notna(row.get("llm_quality")):
            overrides[int(row["record_id"])] = float(row["llm_quality"])
    return overrides


def merge_label(
    snapshot_id: int,
    human_value: float | None,
    llm_overrides: dict[int, float],
    strategy: str,
    llm_weight: float,
) -> float | None:
    """Compute final label value using the chosen merge strategy."""
    llm_value = llm_overrides.get(snapshot_id)

    if strategy == "llm_only":
        return llm_value if llm_value is not None else human_value
    if strategy == "human_override":
        return human_value if human_value is not None else llm_value
    if strategy == "weighted_average":
        if llm_value is not None and human_value is not None:
            human_norm = human_value / 5.0
            return llm_weight * llm_value + (1 - llm_weight) * human_norm
        if llm_value is not None:
            return llm_value
        if human_value is not None:
            return human_value / 5.0
        return None
    # human_only (default)
    return human_value


def summarize_targets(rows: list[dict[str, Any]], target_type: str) -> dict[str, Any]:
    if not rows:
        return {"count": 0}
    values = [r["target_label"] for r in rows]
    if target_type == "binary":
        negatives = sum(1 for v in values if int(v) == 0)
        positives = sum(1 for v in values if int(v) == 1)
        total = negatives + positives
        return {
            "count": total,
            "negative": negatives,
            "positive": positives,
            "positive_rate": (positives / total) if total else None,
        }
    numeric = [float(v) for v in values]
    return {
        "count": len(numeric),
        "min": min(numeric),
        "max": max(numeric),
        "mean": sum(numeric) / len(numeric),
    }


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
    parser.add_argument("--include-external", action="store_true",
                        help="Include LLM-rated external images (from external_images table)")
    parser.add_argument("--external-categories", nargs="+", default=["sunset", "negative"],
                        help="Which external_images categories to include")
    parser.add_argument(
        "--llm-ratings-csv", default="",
        help="Path to LLM ratings CSV. When set, overrides label_value with llm_quality "
             "for matching snapshot_ids (webcam source only).",
    )
    parser.add_argument(
        "--label-merge-strategy",
        choices=["human_only", "llm_only", "human_override", "weighted_average"],
        default="human_only",
        help="How to merge human and LLM labels when --llm-ratings-csv is set",
    )
    parser.add_argument(
        "--llm-weight", type=float, default=0.7,
        help="LLM weight in weighted_average strategy (human gets 1 - this)",
    )
    parser.add_argument("--no-progress", action="store_true")

    args = parser.parse_args()

    if args.llm_ratings_csv and args.label_merge_strategy == "human_only":
        args.label_merge_strategy = "llm_only"

    return parser.parse_args() if False else args


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


def fetch_external_rows(
    conn: psycopg2.extensions.connection,
    categories: list[str],
) -> list[dict[str, Any]]:
    """
    Fetch LLM-rated external images for inclusion in training manifests.

    Only images that have been rated by the LLM (llm_quality IS NOT NULL)
    are included — unrated images are skipped.
    """
    query = """
    SELECT
      id AS snapshot_id,
      source AS webcam_id,
      image_url AS image_path_or_url,
      CASE WHEN category = 'sunset' THEN 'sunset' ELSE 'other' END AS phase,
      scraped_at AS captured_at,
      llm_quality AS label_value,
      0 AS rating_count,
      source AS data_source
    FROM external_images
    WHERE llm_quality IS NOT NULL
      AND category = ANY(%(categories)s)
    """
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(query, {"categories": categories})
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

    llm_overrides: dict[int, float] = {}
    if args.llm_ratings_csv:
        llm_overrides = load_llm_overrides(args.llm_ratings_csv)
        print(f"  Loaded {len(llm_overrides)} LLM ratings from {args.llm_ratings_csv}")

    use_llm_labels = bool(llm_overrides) and args.label_merge_strategy != "human_only"

    with psycopg2.connect(database_url) as conn:
        rows = fetch_rows(conn, args.label_source, args.min_rating_count)

        manifest: list[dict[str, Any]] = []
        for row in tqdm(
            rows,
            desc="Building webcam manifest",
            unit="row",
            disable=args.no_progress,
        ):
            human_value = float(row["label_value"]) if row["label_value"] is not None else None

            if use_llm_labels:
                final_value = merge_label(
                    row["snapshot_id"], human_value, llm_overrides,
                    args.label_merge_strategy, args.llm_weight,
                )
                if final_value is None:
                    continue
                effective_label_source = args.label_merge_strategy
            else:
                final_value = human_value
                if final_value is None:
                    continue
                effective_label_source = args.label_source

            split = assign_split(int(row["webcam_id"]), split_cfg)
            mapped_label = map_label(float(final_value), label_policy)
            manifest.append(
                {
                    "snapshot_id": row["snapshot_id"],
                    "webcam_id": row["webcam_id"],
                    "label_source": effective_label_source,
                    "label_value": final_value,
                    "target_label": mapped_label,
                    "split": split,
                    "image_path_or_url": row["image_path_or_url"],
                    "phase": row["phase"],
                    "captured_at": row["captured_at"],
                    "rating_count": row["rating_count"],
                    "source": "webcam",
                }
            )

        if args.include_external:
            ext_rows = fetch_external_rows(conn, args.external_categories)
            print(f"  External images found: {len(ext_rows)}")
            for row in tqdm(
                ext_rows,
                desc="Building external manifest",
                unit="row",
                disable=args.no_progress,
            ):
                # External images use their source name as the split group key
                # so they don't leak into webcam-based splits.
                split = assign_split(
                    hash(f"ext_{row['snapshot_id']}") % 10_000_000,
                    split_cfg,
                )
                mapped_label = map_label(float(row["label_value"]), label_policy)
                manifest.append(
                    {
                        "snapshot_id": row["snapshot_id"],
                        "webcam_id": row["webcam_id"],
                        "label_source": "llm",
                        "label_value": row["label_value"],
                        "target_label": mapped_label,
                        "split": split,
                        "image_path_or_url": row["image_path_or_url"],
                        "phase": row["phase"],
                        "captured_at": row["captured_at"],
                        "rating_count": row["rating_count"],
                        "source": row["data_source"],
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

        train_rows = [r for r in manifest if r["split"] == "train"]
        val_rows = [r for r in manifest if r["split"] == "val"]
        test_rows = [r for r in manifest if r["split"] == "test"]

        webcam_rows = [r for r in manifest if r.get("source") == "webcam"]
        external_rows = [r for r in manifest if r.get("source") not in ("webcam", None)]

        meta = {
            "label_source": args.label_source,
            "label_merge_strategy": args.label_merge_strategy,
            "llm_ratings_csv": args.llm_ratings_csv or None,
            "llm_overrides_count": len(llm_overrides),
            "target_type": args.target_type,
            "binary_threshold": args.binary_threshold,
            "min_rating_count": args.min_rating_count,
            "include_external": args.include_external,
            "split_config": asdict(split_cfg),
            "counts": {
                "total": len(manifest),
                "train": len(train_rows),
                "val": len(val_rows),
                "test": len(test_rows),
                "webcam": len(webcam_rows),
                "external": len(external_rows),
            },
            "target_distribution": {
                "full": summarize_targets(manifest, args.target_type),
                "train": summarize_targets(train_rows, args.target_type),
                "val": summarize_targets(val_rows, args.target_type),
                "test": summarize_targets(test_rows, args.target_type),
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
