"""Publish a completed experiment run to public/ml-runs/<slug>/."""
from __future__ import annotations

import json
import re
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


REPO_ROOT = Path(__file__).resolve().parent.parent
PUBLIC_RUNS_DIR = REPO_ROOT / "public" / "ml-runs"
MANIFEST_PATH = PUBLIC_RUNS_DIR / "_manifest.json"


def slugify(text: str) -> str:
    """Lowercase + alphanumeric/underscore only + collapse runs of `_`."""
    out = re.sub(r"[^a-zA-Z0-9]+", "_", text).strip("_").lower()
    return re.sub(r"_+", "_", out)


def classify_status(
    epoch_history: list[dict[str, Any]],
    *,
    best_epoch: int,
) -> dict[str, str]:
    """Categorise a run as healthy / mild_overfit / overfit / severe_overfit.

    Logic:
      - severe_overfit: final val_loss > 1.5 * best val_loss
      - overfit: final val_loss > 1.2 * best val_loss
      - mild_overfit: final val_loss > 1.05 * best val_loss
      - healthy: otherwise
    """
    if not epoch_history:
        return {"status": "healthy", "note": "No epoch history available."}

    best = next(
        (e for e in epoch_history if e["epoch"] == best_epoch),
        epoch_history[0],
    )
    final = epoch_history[-1]
    best_val = float(best["val_loss"])
    final_val = float(final["val_loss"])
    if best_val <= 0:
        return {"status": "healthy", "note": "Best val_loss is 0; trivial."}
    ratio = final_val / best_val

    if ratio > 1.5:
        status = "severe_overfit"
        note = (
            f"Val loss grew {(ratio - 1) * 100:.0f}% from epoch {best_epoch} "
            f"to epoch {final['epoch']}."
        )
    elif ratio > 1.2:
        status = "overfit"
        note = (
            f"Val loss drifted up {(ratio - 1) * 100:.0f}% after the best "
            f"epoch ({best_epoch})."
        )
    elif ratio > 1.05:
        status = "mild_overfit"
        note = (
            f"Slight val-loss drift ({(ratio - 1) * 100:.0f}%) after the best "
            f"epoch."
        )
    else:
        status = "healthy"
        note = "Train/val loss tracked together; no overfit signal."
    return {"status": status, "note": note}


def _class_balance(eval_report: dict[str, Any]) -> dict[str, Any]:
    cb = eval_report.get("data", {}).get("class_balance", {})
    neg = cb.get("negative")
    pos = cb.get("positive")
    if neg is not None and pos:
        return {"negative": neg, "positive": pos, "ratio": round(neg / pos, 2)}
    return {"negative": neg, "positive": pos, "ratio": None}


def _binary_metrics(eval_report: dict[str, Any]) -> dict[str, float]:
    metrics = eval_report.get("metrics", {})
    sweep = metrics.get("binary_threshold_sweep", {})
    out: dict[str, float] = {}
    for src_key, dst_key in [
        ("val_f1", "val_f1"),
        ("best_f1", "val_f1"),
        ("val_precision", "val_precision"),
        ("val_recall", "val_recall"),
        ("val_accuracy", "val_accuracy"),
    ]:
        if src_key in metrics:
            out[dst_key] = float(metrics[src_key])
        elif src_key in sweep:
            out[dst_key] = float(sweep[src_key])
    return out


def _regression_metrics(eval_report: dict[str, Any]) -> dict[str, float]:
    metrics = eval_report.get("metrics", {})
    return {
        k: float(metrics[k])
        for k in ("pearson_r", "spearman_r", "r_squared", "val_mse")
        if k in metrics
    }


def build_index_json(
    *,
    slug: str,
    eval_report: dict[str, Any],
    train_summary: dict[str, Any],
    config: dict[str, Any],
    published_at: str,
) -> dict[str, Any]:
    target_type = eval_report.get("target_type", config.get("target_type"))
    diagnosis = classify_status(
        train_summary.get("epoch_history", []),
        best_epoch=train_summary.get("best_epoch", 0),
    )
    binary = _binary_metrics(eval_report)
    regression = _regression_metrics(eval_report)

    return {
        "schema_version": 1,
        "slug": slug,
        "display_name": config.get("run_name", slug),
        "published_at": published_at,
        "config_summary": {
            "model": config.get("model"),
            "target_type": target_type,
            "epochs_configured": config.get("epochs"),
            "lr_schedule": config.get("lr_schedule"),
            "early_stopping_patience": config.get("early_stopping_patience"),
            "head_dropout": config.get("head_dropout"),
            "class_weighting": config.get("class_weighting"),
            "label_source": config.get("label_source"),
        },
        "metrics": {
            **regression,
            "best_f1": binary.get("val_f1"),
            "val_precision": binary.get("val_precision"),
            "val_recall": binary.get("val_recall"),
            "val_accuracy": binary.get("val_accuracy"),
            "best_epoch": train_summary.get("best_epoch"),
            "epochs_completed": train_summary.get("epochs_completed"),
            "early_stopped_epoch": train_summary.get("early_stopped_epoch"),
        },
        "diagnosis": diagnosis,
        "data": {
            "train_samples": eval_report.get("data", {}).get("train_samples"),
            "val_samples": eval_report.get("data", {}).get("val_samples"),
            "test_samples": eval_report.get("data", {}).get("test_samples"),
            "class_balance": _class_balance(eval_report),
        },
        "assets": {
            "loss_curves_png": "plots/loss_curves.png",
            "label_distribution_png": "plots/label_distribution.png",
            "config_yaml": "config.yaml",
            "failure_gallery_json": "failure_gallery.json",
        },
    }


def build_manifest_entry(idx: dict[str, Any]) -> dict[str, Any]:
    metrics = idx["metrics"]
    binary = {
        k: metrics[k] for k in
        ("best_f1", "val_precision", "val_recall", "val_accuracy")
        if metrics.get(k) is not None
    }
    regression = {
        k: metrics[k] for k in ("pearson_r", "spearman_r", "r_squared", "val_mse")
        if metrics.get(k) is not None
    }
    # Pick the primary metric for sorting fallback
    if "best_f1" in binary:
        primary_name, primary_value = "val_f1", binary["best_f1"]
    elif "pearson_r" in regression:
        primary_name, primary_value = "pearson_r", regression["pearson_r"]
    else:
        primary_name, primary_value = "n_a", 0.0

    return {
        "slug": idx["slug"],
        "display_name": idx["display_name"],
        "published_at": idx["published_at"],
        "target_type": idx["config_summary"]["target_type"],
        "binary_metrics": {
            "val_f1": binary.get("best_f1"),
            "val_precision": binary.get("val_precision"),
            "val_recall": binary.get("val_recall"),
            "val_accuracy": binary.get("val_accuracy"),
        },
        "regression_metrics": regression,
        "best_metric_name": primary_name,
        "best_metric_value": primary_value,
        "best_epoch": metrics.get("best_epoch"),
        "epochs_total": metrics.get("epochs_completed"),
        "early_stopped": metrics.get("early_stopped_epoch") is not None
                         and metrics.get("early_stopped_epoch")
                             != metrics.get("epochs_completed"),
        "status": idx["diagnosis"]["status"],
        "status_note": idx["diagnosis"]["note"],
    }


def update_manifest(
    manifest: dict[str, Any],
    new_entry: dict[str, Any],
) -> dict[str, Any]:
    """Insert or replace `new_entry` keyed by slug; sort by published_at desc."""
    runs = [r for r in manifest.get("runs", []) if r["slug"] != new_entry["slug"]]
    runs.append(new_entry)
    runs.sort(key=lambda r: r.get("published_at", ""), reverse=True)
    return {
        "schema_version": 1,
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "runs": runs,
    }


def publish(
    *,
    run_dir: Path,
    config_path: Path,
) -> Path:
    """Copy artifacts to public/ml-runs/<slug>/ and update _manifest.json."""
    import yaml

    config = yaml.safe_load(config_path.read_text())
    run_name = config.get("run_name") or run_dir.name.split("_", 2)[-1]
    slug = slugify(run_name)
    out_dir = PUBLIC_RUNS_DIR / slug
    plots_out = out_dir / "plots"
    plots_out.mkdir(parents=True, exist_ok=True)

    # Copy assets
    src_plots = run_dir / "plots"
    for png in ("loss_curves.png", "label_distribution.png"):
        src = src_plots / png
        if src.exists():
            shutil.copy(src, plots_out / png)
    shutil.copy(config_path, out_dir / "config.yaml")
    fg_src = run_dir / "failure_gallery.json"
    if fg_src.exists():
        shutil.copy(fg_src, out_dir / "failure_gallery.json")

    # Build index.json
    eval_report = json.loads(
        (run_dir / "eval" / "eval_report.json").read_text()
    )
    train_summary = json.loads(
        (run_dir / "train" / "train_summary.json").read_text()
    )
    published_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
    idx = build_index_json(
        slug=slug,
        eval_report=eval_report,
        train_summary=train_summary,
        config=config,
        published_at=published_at,
    )
    (out_dir / "index.json").write_text(json.dumps(idx, indent=2))

    # Update manifest
    if MANIFEST_PATH.exists():
        manifest = json.loads(MANIFEST_PATH.read_text())
    else:
        manifest = {"schema_version": 1, "generated_at": "", "runs": []}
    manifest = update_manifest(manifest, build_manifest_entry(idx))
    MANIFEST_PATH.write_text(json.dumps(manifest, indent=2))

    return out_dir


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser()
    parser.add_argument("--run-dir", required=True, type=Path)
    parser.add_argument("--config", required=True, type=Path)
    args = parser.parse_args()
    out = publish(run_dir=args.run_dir, config_path=args.config)
    print(f"Published → {out.relative_to(REPO_ROOT)}  (commit + push to deploy)")
