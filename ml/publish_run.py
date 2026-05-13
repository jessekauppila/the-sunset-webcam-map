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


def parse_started_at(run_dir: Path) -> str | None:
    """Derive the run's start time from the directory name prefix.

    Convention is `<YYYYMMDD>_<HHMMSS>_<run_name>`. Returns ISO-8601 in UTC,
    or None if the directory name doesn't match.
    """
    m = re.match(r"^(\d{8})_(\d{6})_", run_dir.name)
    if not m:
        return None
    try:
        dt = datetime.strptime(m.group(1) + m.group(2), "%Y%m%d%H%M%S")
        return dt.replace(tzinfo=timezone.utc).isoformat(timespec="seconds")
    except ValueError:
        return None


def _count_csv_rows(path: Path | None) -> int | None:
    """Count data rows (excluding header) in a CSV. None if path missing
    or empty."""
    if path is None or not path.is_file():
        return None
    with path.open() as f:
        return max(sum(1 for _ in f) - 1, 0)


def _bucket_label(value: float) -> str:
    """Map a normalised 0.0–1.0 label to a 1–5 bucket label.

    Values outside [0, 1] (e.g. raw human 1–5 ratings that never got
    normalised) get tagged separately so we can flag them as a data
    quality issue.
    """
    if value < 0 or value > 1:
        return "unnormalized"
    if value < 0.125:
        return "1"
    if value < 0.375:
        return "2"
    if value < 0.625:
        return "3"
    if value < 0.875:
        return "4"
    return "5"


def _label_distribution(path: Path | None) -> dict[str, int] | None:
    """Count label_value bucket occurrences in a manifest CSV. None if
    the file is missing or has no label_value column."""
    if path is None or not path.is_file():
        return None
    import csv
    counts: dict[str, int] = {}
    with path.open() as f:
        reader = csv.DictReader(f)
        if reader.fieldnames is None or "label_value" not in reader.fieldnames:
            return None
        for row in reader:
            try:
                v = float(row["label_value"])
            except (TypeError, ValueError):
                continue
            key = _bucket_label(v)
            counts[key] = counts.get(key, 0) + 1
    return counts or None


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


def _class_balance(
    eval_report: dict[str, Any],
    train_summary: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Class balance from eval_report.data, or fall back to train_class_counts."""
    cb = eval_report.get("data", {}).get("class_balance", {})
    neg = cb.get("negative")
    pos = cb.get("positive")
    if (neg is None or pos is None) and train_summary is not None:
        counts = train_summary.get("train_class_counts") or {}
        # train_class_counts keys may be strings ("0", "1") or ints
        if neg is None:
            neg = counts.get("0", counts.get(0))
        if pos is None:
            pos = counts.get("1", counts.get(1))
    if neg is not None and pos:
        return {"negative": neg, "positive": pos, "ratio": round(neg / pos, 2)}
    return {"negative": neg, "positive": pos, "ratio": None}


def _binary_metrics(eval_report: dict[str, Any]) -> dict[str, float]:
    """Extract binary classification metrics.

    Handles two real-world shapes:
      - Binary run: flat top-level keys (f1, precision, recall, confusion).
      - Regression run with thresholding: pick the best row from
        derived_binary_sweep by f1.
    """
    out: dict[str, float] = {}
    target_type = eval_report.get("target_type")
    if target_type == "binary":
        for k in ("f1", "precision", "recall"):
            v = eval_report.get(k)
            if v is not None:
                out[f"val_{k}"] = float(v)
        conf = eval_report.get("confusion", {}) or {}
        total = sum((conf.get(k) or 0) for k in ("tn", "fp", "fn", "tp"))
        if total > 0:
            out["val_accuracy"] = (
                (conf.get("tn") or 0) + (conf.get("tp") or 0)
            ) / total
    elif target_type == "regression":
        sweep = eval_report.get("derived_binary_sweep") or []
        if sweep:
            best = max(sweep, key=lambda r: r.get("f1", float("-inf")))
            for k in ("f1", "precision", "recall"):
                v = best.get(k)
                if v is not None:
                    out[f"val_{k}"] = float(v)
    return out


def _regression_metrics(eval_report: dict[str, Any]) -> dict[str, float]:
    """Regression metrics from flat top-level keys; derive val_mse from rmse."""
    out: dict[str, float] = {}
    for k in ("pearson_r", "spearman_r", "r_squared"):
        v = eval_report.get(k)
        if v is not None:
            out[k] = float(v)
    rmse = eval_report.get("rmse")
    if rmse is not None:
        out["val_mse"] = float(rmse) ** 2
    return out


def _best_epoch_from_history(
    history: list[dict[str, Any]],
    target_type: str | None,
) -> int | None:
    """Pick the best epoch index: lowest val_loss for regression, highest
    val_metric for binary (which is typically f1 or balanced accuracy)."""
    if not history:
        return None
    if target_type == "regression":
        best = min(history, key=lambda e: e.get("val_loss", float("inf")))
    else:
        best = max(history, key=lambda e: e.get("val_metric", float("-inf")))
    return best.get("epoch")


def build_index_json(
    *,
    slug: str,
    eval_report: dict[str, Any],
    train_summary: dict[str, Any],
    config: dict[str, Any],
    published_at: str,
    started_at: str | None = None,
    sample_counts: dict[str, int | None] | None = None,
    label_distribution: dict[str, dict[str, int] | None] | None = None,
) -> dict[str, Any]:
    target_type = (
        eval_report.get("target_type")
        or train_summary.get("target_type")
        or config.get("target_type")
    )
    history = (
        train_summary.get("history")
        or train_summary.get("epoch_history")
        or []
    )
    best_epoch = train_summary.get("best_epoch")
    if best_epoch is None:
        best_epoch = _best_epoch_from_history(history, target_type)

    diagnosis = classify_status(history, best_epoch=best_epoch or 0)
    binary = _binary_metrics(eval_report)
    regression = _regression_metrics(eval_report)

    epochs_completed = train_summary.get("epochs_completed")
    if epochs_completed is None and history:
        epochs_completed = history[-1].get("epoch")

    sample_counts = sample_counts or {}

    # Forward the threshold sweep verbatim — small enough that we don't
    # need to denormalise it, and the UI can render a tradeoff table.
    threshold_sweep = (
        eval_report.get("derived_binary_sweep")
        or eval_report.get("threshold_sweep")
        or []
    )
    best_threshold = (
        eval_report.get("best_derived_threshold_by_f1")
        or eval_report.get("best_threshold_by_f1")
    )

    return {
        "schema_version": 1,
        "slug": slug,
        "display_name": config.get("run_name", slug),
        "published_at": published_at,
        "started_at": started_at,
        "config_summary": {
            "model": config.get("model") or train_summary.get("model_name"),
            "target_type": target_type,
            "epochs_configured": config.get("epochs") or train_summary.get("epochs"),
            "lr_schedule": (
                config.get("lr_schedule") or train_summary.get("lr_schedule")
            ),
            "early_stopping_patience": (
                config.get("early_stopping_patience")
                or train_summary.get("early_stopping_patience")
            ),
            "head_dropout": (
                config.get("head_dropout") or train_summary.get("head_dropout")
            ),
            "class_weighting": (
                config.get("class_weighting") or train_summary.get("class_weighting")
            ),
            "label_source": config.get("label_source"),
        },
        "metrics": {
            **regression,
            "best_f1": binary.get("val_f1"),
            "val_precision": binary.get("val_precision"),
            "val_recall": binary.get("val_recall"),
            "val_accuracy": binary.get("val_accuracy"),
            "best_epoch": best_epoch,
            "epochs_completed": epochs_completed,
            "early_stopped_epoch": train_summary.get("early_stopped_epoch"),
        },
        "diagnosis": diagnosis,
        "data": {
            "train_samples": (
                sample_counts.get("train")
                or eval_report.get("data", {}).get("train_samples")
            ),
            "val_samples": (
                sample_counts.get("val")
                or eval_report.get("data", {}).get("val_samples")
                or eval_report.get("num_samples")
            ),
            "test_samples": (
                sample_counts.get("test")
                or eval_report.get("data", {}).get("test_samples")
            ),
            "class_balance": _class_balance(eval_report, train_summary),
            "label_distribution": label_distribution or {},
        },
        "assets": {
            "loss_curves_png": "plots/loss_curves.png",
            "label_distribution_png": "plots/label_distribution.png",
            "config_yaml": "config.yaml",
            "failure_gallery_json": "failure_gallery.json",
        },
        "threshold_sweep": threshold_sweep,
        "best_threshold": best_threshold,
        "decision_threshold": config.get("metrics", {}).get("decision_threshold")
            or config.get("decision_threshold"),
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
        "started_at": idx.get("started_at"),
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
        "early_stopped": metrics.get("early_stopped_epoch") is not None,
        "train_samples": idx["data"]["train_samples"],
        "val_samples": idx["data"]["val_samples"],
        "test_samples": idx["data"]["test_samples"],
        "status": idx["diagnosis"]["status"],
        "status_note": idx["diagnosis"]["note"],
    }


def update_manifest(
    manifest: dict[str, Any],
    new_entry: dict[str, Any],
) -> dict[str, Any]:
    """Insert or replace `new_entry` keyed by slug; sort by started_at desc
    (falling back to published_at) so the most-recently-trained run is first."""
    runs = [r for r in manifest.get("runs", []) if r["slug"] != new_entry["slug"]]
    runs.append(new_entry)
    runs.sort(
        key=lambda r: (r.get("started_at") or r.get("published_at") or ""),
        reverse=True,
    )
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
    started_at = parse_started_at(run_dir)
    def _maybe_path(value: Any) -> Path | None:
        return Path(value) if isinstance(value, str) and value else None

    train_csv = _maybe_path(train_summary.get("train_manifest"))
    val_csv = _maybe_path(train_summary.get("val_manifest"))
    test_csv = _maybe_path(train_summary.get("test_manifest"))
    sample_counts = {
        "train": _count_csv_rows(train_csv),
        "val": _count_csv_rows(val_csv),
        "test": _count_csv_rows(test_csv),
    }
    label_distribution = {
        "train": _label_distribution(train_csv),
        "val": _label_distribution(val_csv),
        "test": _label_distribution(test_csv),
    }
    idx = build_index_json(
        slug=slug,
        eval_report=eval_report,
        train_summary=train_summary,
        config=config,
        published_at=published_at,
        started_at=started_at,
        sample_counts=sample_counts,
        label_distribution=label_distribution,
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
