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
from common.labels import LabelPolicy, map_label, resolve_binary_label
from common.splits import SplitConfig, assign_split, stable_bucket


def external_split(external_id: int, config: SplitConfig) -> str:
    """Deterministic train/val/test split for an external (Flickr) image.

    Uses the same sha256 bucketing as the webcam path, namespaced with an
    "ext_" prefix so external ids (1..5872) don't inherit the split of the
    webcam that happens to share their number.

    This replaced ``assign_split(hash(f"ext_{id}") % 10_000_000, ...)``.
    Python salts ``hash()`` on str per process unless PYTHONHASHSEED is set,
    so every export reshuffled external images: 2,718 of 5,767 Flickr images
    (47.1%) landed in a different split between the two v4 runs, which made
    no two Flickr-inclusive experiments comparable.
    """
    config.validate()
    bucket = stable_bucket(f"ext_{external_id}", config.seed)
    if bucket < config.train_pct:
        return "train"
    if bucket < config.train_pct + config.val_pct:
        return "val"
    return "test"


def gold_label_value(is_sunset: bool, rating: int | None) -> float | None:
    """Normalized [0,1] quality target for one operator gold label.

    A non-sunset is 0.0 whatever its rating column says. A sunset uses
    (rating-1)/4, the normalization the rest of the pipeline assumes — so a
    rating of 4 lands exactly on the 0.75 binary threshold. A sunset with no
    rating returns None so the caller skips the row instead of inventing a
    target for it.
    """
    if not is_sunset:
        return 0.0
    if rating is None:
        return None
    return max(0.0, min(1.0, (float(rating) - 1.0) / 4.0))


def load_llm_overrides(csv_path: str) -> dict[int, float]:
    """Load LLM ratings CSV and return {record_id: llm_quality} mapping."""
    df = pd.read_csv(csv_path)
    overrides: dict[int, float] = {}
    for _, row in df.iterrows():
        if row.get("source_table") == "webcam" and pd.notna(row.get("llm_quality")):
            overrides[int(row["record_id"])] = float(row["llm_quality"])
    return overrides


def fetch_llm_labels_from_db(
    conn: psycopg2.extensions.connection,
) -> dict[int, dict[str, Any]]:
    """Current LLM labels for webcam snapshots, straight from the database.

    v4 was bound to a frozen CSV (ml/artifacts/llm_ratings/initial_ratings.csv,
    29,605 rows) while the DB now holds 46,079 rated webcam frames — and the
    CSV path cannot supply llm_is_sunset at all.

    llm_is_sunset is populated on 100% of rated rows across both judge
    campaigns (claude-sonnet-4-5 and claude-sonnet-5) as of 2026-08-28.
    """
    query = """
    SELECT id, llm_quality, llm_is_sunset
    FROM webcam_snapshots
    WHERE llm_quality IS NOT NULL AND firebase_url IS NOT NULL
    """
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(query)
        return {
            int(r["id"]): {
                "quality": float(r["llm_quality"]),
                "is_sunset": r["llm_is_sunset"],
            }
            for r in cur.fetchall()
        }


def merge_label(
    snapshot_id: int,
    human_value: float | None,
    llm_overrides: dict[int, float],
    strategy: str,
    llm_weight: float,
) -> float | None:
    """Compute final label value using the chosen merge strategy.

    All returned values are in the normalised 0.0–1.0 range. Raw human
    ratings (1–5 scale) are mapped with (v - 1) / 4 when the strategy
    permits a human fallback.
    """
    llm_value = llm_overrides.get(snapshot_id)

    def _norm_human(v: float | None) -> float | None:
        if v is None:
            return None
        # If a 1–5 raw rating snuck through, map to 0–1; clip otherwise.
        if v > 1.0:
            return max(0.0, min(1.0, (v - 1.0) / 4.0))
        return max(0.0, min(1.0, v))

    if strategy == "llm_only":
        # Strict: an LLM label is required; rows without one are skipped.
        return llm_value
    if strategy == "human_override":
        return _norm_human(human_value) if human_value is not None else llm_value
    if strategy == "weighted_average":
        h = _norm_human(human_value)
        if llm_value is not None and h is not None:
            return llm_weight * llm_value + (1 - llm_weight) * h
        if llm_value is not None:
            return llm_value
        return h
    # human_only (default)
    return _norm_human(human_value)


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
        choices=["manual_only", "public_aggregate", "gold"],
        default="manual_only",
    )
    parser.add_argument("--target-type", choices=["binary", "regression"], default="binary")
    # Compared against the normalized [0,1] label produced by merge_label,
    # NOT the raw 1-5 rating. (rating - 1) / 4 = 0.75 corresponds to
    # "rating >= 4". See ml/common/labels.py docstring.
    parser.add_argument("--binary-threshold", type=float, default=0.75)
    parser.add_argument(
        "--binary-label-from",
        choices=["quality_threshold", "is_sunset", "min_rating"],
        default="quality_threshold",
        help="How the binary class is derived. quality_threshold reproduces "
             "v2-v4 (normalized quality >= --binary-threshold). is_sunset "
             "takes the boolean label directly, which needs a source that "
             "supplies one (--label-source gold, or --llm-label-source db). "
             "min_rating requires an operator rating >= --min-positive-rating, "
             "which excludes rating-1 'sunset happening but nothing to see' "
             "frames; needs --label-source gold.",
    )
    parser.add_argument(
        "--gold-sunsets-only", action="store_true",
        help="Restrict --label-source gold to rows the operator marked as "
             "sunsets. This is how the QUALITY head should be trained: 'is it "
             "a sunset' and 'how good is it' are different questions, and the "
             "quality head should only ever see actual sunsets. Without this "
             "flag the quality head spends 59%% of its training data (5,018 of "
             "8,564 rows) learning to predict 0.0 for non-sunsets, which is "
             "the detection head's job.",
    )
    parser.add_argument(
        "--min-positive-rating", type=int, default=4,
        help="Rating bar for --binary-label-from min_rating. 3 == 'clearly a "
             "sunset', 4 == 'would I want this surfaced'. See "
             "docs/ml/rating-rubric.md.",
    )
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
    parser.add_argument(
        "--llm-label-source",
        choices=["csv", "db"],
        default="csv",
        help="Where LLM labels come from. csv reads --llm-ratings-csv (v4 "
             "behavior, quality only, frozen at 29,605 rows). db reads "
             "webcam_snapshots.llm_* live and can supply llm_is_sunset.",
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
    label_merge_strategy: str = "human_only",
) -> list[dict[str, Any]]:
    """
    Query candidate labeled snapshots for export.

    manual_only:
      Uses all snapshots with calculated rating and minimum rating count.
    public_aggregate:
      Uses snapshots backed by public votes and stricter confidence gate.
    llm_only (via --label-merge-strategy):
      Uses *all* snapshots with an image; the LLM override CSV supplies the
      label. Human rating count is not required since the LLM is the label
      source.
    """
    if label_merge_strategy == "llm_only":
        query = """
        SELECT
          s.id AS snapshot_id,
          s.webcam_id,
          s.firebase_url AS image_path_or_url,
          s.phase,
          s.captured_at,
          s.calculated_rating AS label_value,
          COALESCE(c.rating_count, 0)::int AS rating_count
        FROM webcam_snapshots s
        LEFT JOIN (
          SELECT snapshot_id, COUNT(*) AS rating_count
          FROM webcam_snapshot_ratings
          GROUP BY snapshot_id
        ) c ON c.snapshot_id = s.id
        WHERE s.firebase_url IS NOT NULL
        """
    elif label_source == "public_aggregate":
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


def fetch_gold_rows(
    conn: psycopg2.extensions.connection,
) -> list[dict[str, Any]]:
    """Fetch the operator gold-label set (manual_labels), webcam + Flickr.

    manual_labels holds one adjudicated row per (source, image_id) from the
    Hard Examples queue — the operator's verdict on a frame the model and
    Claude disagreed about. is_sunset is always present; rating is present
    iff is_sunset is true.

    Webcam rows keep their webcam_id so they split by camera like everything
    else; Flickr rows carry their external id for the ext_ namespace.
    """
    query = """
    SELECT
      s.id AS snapshot_id,
      -- Cast to text so the UNION legs match: external_images.source is text
      -- ('flickr'), webcam_snapshots.webcam_id is integer. Webcam rows stay
      -- numeric strings, so they still int() cleanly for camera-grouped splits.
      s.webcam_id::text AS webcam_id,
      s.firebase_url AS image_path_or_url,
      s.phase,
      s.captured_at,
      m.is_sunset,
      m.rating,
      0 AS rating_count,
      'webcam' AS data_source
    FROM manual_labels m
    JOIN webcam_snapshots s ON s.id = m.image_id
    WHERE m.source = 'webcam' AND s.firebase_url IS NOT NULL
    UNION ALL
    SELECT
      e.id AS snapshot_id,
      e.source AS webcam_id,
      e.image_url AS image_path_or_url,
      CASE WHEN e.category = 'sunset' THEN 'sunset' ELSE 'other' END AS phase,
      e.scraped_at AS captured_at,
      m.is_sunset,
      m.rating,
      0 AS rating_count,
      e.source AS data_source
    FROM manual_labels m
    JOIN external_images e ON e.id = m.image_id
    WHERE m.source = 'flickr' AND e.image_url IS NOT NULL
    """
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(query)
        return [dict(row) for row in cur.fetchall()]


def build_gold_manifest(
    conn: psycopg2.extensions.connection,
    split_cfg: SplitConfig,
    label_policy: LabelPolicy,
    no_progress: bool = False,
    sunsets_only: bool = False,
) -> tuple[list[dict[str, Any]], int]:
    """Build manifest rows from the operator gold-label set.

    The operator rates on two separate scales, and they are different
    questions: *is this a sunset* (N vs yes) and, only if yes, *how good is
    it* (1-5). ``sunsets_only`` restricts the export to the second question by
    dropping non-sunsets entirely — the right input for a quality head, which
    should never have to spend capacity on detection.

    Returns (rows, skipped_no_rating). Webcam rows split by webcam_id like
    every other webcam frame; Flickr rows split in the ext_ namespace.
    """
    gold_rows = fetch_gold_rows(conn)
    print(f"  Gold labels found: {len(gold_rows)}")
    if sunsets_only:
        before = len(gold_rows)
        gold_rows = [r for r in gold_rows if r["is_sunset"]]
        print(
            f"  Restricted to operator sunsets: {len(gold_rows)} "
            f"({before - len(gold_rows)} non-sunsets dropped)"
        )

    manifest: list[dict[str, Any]] = []
    skipped_no_rating = 0
    for row in tqdm(
        gold_rows,
        desc="Building gold manifest",
        unit="row",
        disable=no_progress,
    ):
        is_sunset = bool(row["is_sunset"])
        value = gold_label_value(is_sunset, row["rating"])
        if value is None:
            skipped_no_rating += 1
            continue

        if row["data_source"] == "webcam":
            split = assign_split(int(row["webcam_id"]), split_cfg)
        else:
            split = external_split(int(row["snapshot_id"]), split_cfg)

        if label_policy.target_type == "binary":
            mapped_label = resolve_binary_label(
                value, is_sunset, label_policy, rating=row["rating"]
            )
        else:
            mapped_label = map_label(float(value), label_policy)

        manifest.append(
            {
                "snapshot_id": row["snapshot_id"],
                "webcam_id": row["webcam_id"],
                "label_source": "gold",
                "label_value": value,
                "target_label": mapped_label,
                "split": split,
                "image_path_or_url": row["image_path_or_url"],
                "phase": row["phase"],
                "captured_at": row["captured_at"],
                "rating_count": row["rating_count"],
                "source": row["data_source"],
            }
        )

    if skipped_no_rating:
        print(f"  Skipped {skipped_no_rating} sunset rows with no rating")
    return manifest, skipped_no_rating


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
      llm_is_sunset AS is_sunset,
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
        binary_label_from=args.binary_label_from,
        min_positive_rating=args.min_positive_rating,
    )

    llm_overrides: dict[int, float] = {}
    llm_is_sunset_by_id: dict[int, bool] = {}
    if args.llm_label_source == "csv" and args.llm_ratings_csv:
        llm_overrides = load_llm_overrides(args.llm_ratings_csv)
        print(f"  Loaded {len(llm_overrides)} LLM ratings from {args.llm_ratings_csv}")

    use_llm_labels = bool(llm_overrides) and args.label_merge_strategy != "human_only"

    skipped_no_rating = 0

    with psycopg2.connect(database_url) as conn:
        if args.llm_label_source == "db" and args.label_source != "gold":
            db_labels = fetch_llm_labels_from_db(conn)
            llm_overrides = {k: v["quality"] for k, v in db_labels.items()}
            llm_is_sunset_by_id = {
                k: v["is_sunset"] for k, v in db_labels.items()
                if v["is_sunset"] is not None
            }
            use_llm_labels = (
                bool(llm_overrides) and args.label_merge_strategy != "human_only"
            )
            print(
                f"  Loaded {len(llm_overrides)} LLM ratings from the database "
                f"({len(llm_is_sunset_by_id)} with llm_is_sunset)"
            )

        # The gold path is self-contained: manual_labels supplies both sources
        # and its own labels, so the crowd-vote/LLM queries are skipped.
        if args.label_source == "gold":
            rows: list[dict[str, Any]] = []
        else:
            rows = fetch_rows(
                conn,
                args.label_source,
                args.min_rating_count,
                label_merge_strategy=args.label_merge_strategy,
            )

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
            if label_policy.target_type == "binary":
                # The DB LLM source supplies llm_is_sunset; the CSV source
                # cannot, so is_sunset mode raises there rather than
                # silently labelling everything negative.
                row_is_sunset = llm_is_sunset_by_id.get(
                    row["snapshot_id"], row.get("is_sunset")
                )
                mapped_label = resolve_binary_label(
                    final_value, row_is_sunset, label_policy
                )
            else:
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
                # External images bucket in their own "ext_" namespace so they
                # don't inherit the split of a like-numbered webcam.
                split = external_split(int(row["snapshot_id"]), split_cfg)
                if label_policy.target_type == "binary":
                    mapped_label = resolve_binary_label(
                        row["label_value"], row.get("is_sunset"), label_policy
                    )
                else:
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

        if args.label_source == "gold":
            gold_manifest, skipped_no_rating = build_gold_manifest(
                conn, split_cfg, label_policy, args.no_progress,
                sunsets_only=args.gold_sunsets_only,
            )
            manifest.extend(gold_manifest)

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
            "llm_label_source": args.llm_label_source,
            "llm_overrides_count": len(llm_overrides),
            "target_type": args.target_type,
            "binary_threshold": args.binary_threshold,
            "binary_label_from": args.binary_label_from,
            "min_positive_rating": args.min_positive_rating,
            "gold_sunsets_only": args.gold_sunsets_only,
            "skipped_no_rating": skipped_no_rating,
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
