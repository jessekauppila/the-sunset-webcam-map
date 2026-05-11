"""Generate failure_gallery.json from a finished experiment run.

Pure helpers + a small CLI. Importable by run_experiment.py.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import pandas as pd


def compute_top_failures(
    df: pd.DataFrame,
    *,
    target_type: str,
    n: int = 20,
) -> pd.DataFrame:
    """Return the rows with the largest prediction error.

    For regression: |y_true - y_pred|.
    For binary: |y_true - y_pred_proba| (distance from the correct class).
    """
    if target_type == "regression":
        if "y_pred" not in df.columns:
            raise ValueError("regression predictions CSV must have y_pred column")
        df = df.copy()
        df["absolute_error"] = (df["y_true"] - df["y_pred"]).abs()
        sort_col = "absolute_error"
    elif target_type == "binary":
        if "y_pred_proba" not in df.columns:
            raise ValueError("binary predictions CSV must have y_pred_proba column")
        df = df.copy()
        df["absolute_error"] = (df["y_true"] - df["y_pred_proba"]).abs()
        sort_col = "absolute_error"
    else:
        raise ValueError(f"unknown target_type: {target_type}")

    return df.sort_values(sort_col, ascending=False).head(n).reset_index(drop=True)


def resolve_image_urls(
    snapshot_ids: list[str],
    *,
    db_url: str,
) -> dict[str, dict[str, Any]]:
    """Look up image URLs and metadata by snapshot_id.

    Returns {snapshot_id: {image_url, webcam_id, captured_at, llm_explanation}}.
    Missing IDs are simply absent from the result.
    """
    import psycopg2  # local import — DB connection only needed in CLI path
    import psycopg2.extras

    if not snapshot_ids:
        return {}

    sql = """
        SELECT
            id::text AS snapshot_id,
            image_url,
            webcam_id,
            captured_at,
            llm_rating_explanation
        FROM webcam_snapshots
        WHERE id::text = ANY(%s)
    """
    out: dict[str, dict[str, Any]] = {}
    with psycopg2.connect(db_url) as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(sql, (snapshot_ids,))
            for row in cur.fetchall():
                out[row["snapshot_id"]] = {
                    "image_url": row["image_url"],
                    "webcam_id": row["webcam_id"],
                    "captured_at": (
                        row["captured_at"].isoformat()
                        if row["captured_at"]
                        else None
                    ),
                    "llm_explanation": row["llm_rating_explanation"],
                }
    return out


def write_failure_gallery(
    *,
    out_path: Path,
    split: str,
    target_type: str,
    items: list[dict[str, Any]],
) -> None:
    """Serialise the failure gallery JSON. Schema v1."""
    payload = {
        "schema_version": 1,
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "split": split,
        "target_type": target_type,
        "items": items,
    }
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(payload, indent=2))


def generate_from_run(
    *,
    run_dir: Path,
    db_url: str,
    n: int = 20,
    split: str = "val",
) -> Path:
    """End-to-end: read run_dir's eval outputs, write failure_gallery.json."""
    predictions_csv = run_dir / "eval" / "predictions.csv"
    if not predictions_csv.exists():
        raise FileNotFoundError(f"missing predictions CSV: {predictions_csv}")

    eval_report_path = run_dir / "eval" / "eval_report.json"
    if not eval_report_path.exists():
        raise FileNotFoundError(f"missing eval report: {eval_report_path}")
    eval_report = json.loads(eval_report_path.read_text())
    target_type = eval_report.get("target_type", "regression")

    df = pd.read_csv(predictions_csv)
    top = compute_top_failures(df, target_type=target_type, n=n)

    enriched = resolve_image_urls(
        snapshot_ids=top["snapshot_id"].astype(str).tolist(),
        db_url=db_url,
    )

    items: list[dict[str, Any]] = []
    for _, row in top.iterrows():
        sid = str(row["snapshot_id"])
        meta = enriched.get(sid, {})
        if "y_pred" in row:
            predicted_score = float(row["y_pred"])
        else:
            predicted_score = float(row["y_pred_proba"])
        items.append({
            "snapshot_id": sid,
            "webcam_id": meta.get("webcam_id"),
            "image_url": meta.get("image_url"),
            "true_label": float(row["y_true"]),
            "predicted_score": predicted_score,
            "absolute_error": float(row["absolute_error"]),
            "captured_at": meta.get("captured_at"),
            "llm_explanation": meta.get("llm_explanation"),
        })

    out_path = run_dir / "failure_gallery.json"
    write_failure_gallery(
        out_path=out_path,
        split=split,
        target_type=target_type,
        items=items,
    )
    return out_path


if __name__ == "__main__":
    import argparse
    import os

    parser = argparse.ArgumentParser()
    parser.add_argument("--run-dir", required=True, type=Path)
    parser.add_argument("--n", type=int, default=20)
    parser.add_argument("--db-url", default=os.environ.get("DATABASE_URL"))
    args = parser.parse_args()

    if not args.db_url:
        raise SystemExit("DATABASE_URL not set and --db-url not provided")

    out = generate_from_run(run_dir=args.run_dir, db_url=args.db_url, n=args.n)
    print(f"Wrote {out}")
