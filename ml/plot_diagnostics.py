#!/usr/bin/env python3
from __future__ import annotations

"""
Diagnostic plotting script for sunset ML experiments.

Generates three standard plots from a completed experiment run:
  1. label_distribution.png  -- histogram of raw ratings + class balance
  2. loss_curves.png         -- train/val loss and val metric over epochs
  3. (multi-run only) comparison_<ts>.png -- overlaid val metrics across runs

Usage:
  # Single run
  python ml/plot_diagnostics.py --run-dir ml/artifacts/experiments/<run_id>

  # Multiple runs (comparison overlay added)
  python ml/plot_diagnostics.py \\
    --run-dir ml/artifacts/experiments/run_a \\
    --run-dir ml/artifacts/experiments/run_b

  # All completed runs under default artifacts root
  python ml/plot_diagnostics.py --all

  # Custom artifacts root
  python ml/plot_diagnostics.py --all --output-root ml/artifacts/experiments
"""

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path

import matplotlib
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd

matplotlib.use("Agg")  # headless rendering; no display required


# ---------------------------------------------------------------------------
# Data loading
# ---------------------------------------------------------------------------

def find_completed_runs(root: Path) -> list[Path]:
    """Return run dirs that have a train_summary.json."""
    runs = []
    for candidate in sorted(root.iterdir()):
        if (candidate / "train" / "train_summary.json").exists():
            runs.append(candidate)
    return runs


def find_export_dir(run_dir: Path) -> Path | None:
    dataset_dir = run_dir / "dataset"
    if not dataset_dir.exists():
        return None
    candidates = sorted(dataset_dir.iterdir())
    return candidates[-1] if candidates else None


def load_run(run_dir: Path) -> dict:
    """Load all relevant artifacts for a run into a single dict."""
    train_summary_path = run_dir / "train" / "train_summary.json"
    eval_report_path = run_dir / "eval" / "eval_report.json"

    summary = json.loads(train_summary_path.read_text(encoding="utf-8"))

    eval_report = None
    if eval_report_path.exists():
        eval_report = json.loads(eval_report_path.read_text(encoding="utf-8"))

    export_dir = find_export_dir(run_dir)
    manifests: dict[str, pd.DataFrame | None] = {}
    if export_dir:
        for split in ("train", "val", "test"):
            csv = export_dir / f"manifest_{split}.csv"
            manifests[split] = pd.read_csv(csv) if csv.exists() else None

    # train_class_counts keys are strings in JSON ("0", "1")
    raw_counts = summary.get("train_class_counts", {})
    class_counts = {int(k): int(v) for k, v in raw_counts.items()} if raw_counts else {}

    return {
        "name": run_dir.name,
        "run_dir": run_dir,
        "target_type": summary.get("target_type", "binary"),
        "epochs": summary.get("epochs", 0),
        "history": summary.get("history", []),
        "class_counts": class_counts,
        "class_weighting": summary.get("class_weighting", "none"),
        "effective_class_weights": summary.get("effective_class_weights"),
        "sampler": summary.get("sampler", "none"),
        "best_metric": summary.get("best_metric"),
        "augmentation_profile": summary.get("augmentation_profile", ""),
        "crop_strategy": summary.get("crop_strategy", ""),
        "manifests": manifests,
        "eval_report": eval_report,
        "train_num_samples": summary.get("train_num_samples", 0),
        "val_num_samples": summary.get("val_num_samples", 0),
    }


# ---------------------------------------------------------------------------
# Plot 1: Label distribution
# ---------------------------------------------------------------------------

def plot_label_distribution(run: dict, output_path: Path) -> None:
    """
    Binary: grouped bar chart of class 0 vs 1 per split.
    Regression: overlaid histograms of label_value per split.
    """
    manifests = run["manifests"]
    target_type = run["target_type"]
    splits = [s for s in ("train", "val", "test") if manifests.get(s) is not None]

    fig, axes = plt.subplots(1, 2, figsize=(13, 5))
    fig.suptitle(f"Label Distribution — {run['name']}", fontsize=11, fontweight="bold")

    ax_raw = axes[0]
    ax_target = axes[1]

    colors = {"train": "#4c72b0", "val": "#dd8452", "test": "#55a868"}

    # --- left: raw label_value distribution ---
    # Bins: 0.5–5.5 in 0.5 steps so that every integer rating (1–5) is
    # centered in its own bin and nothing is clipped at the edges.
    bins = np.arange(0.5, 6.0, 0.5)
    for split in splits:
        df = manifests[split]
        if "label_value" not in df.columns:
            continue
        ax_raw.hist(
            df["label_value"].dropna(),
            bins=bins,
            alpha=0.6,
            label=f"{split} (n={len(df)})",
            color=colors.get(split, None),
            edgecolor="white",
        )
    ax_raw.set_xlabel("Raw rating (1–5)")
    ax_raw.set_ylabel("Count")
    title = "Rating distribution per split" if target_type == "regression" else "Raw rating distribution per split"
    ax_raw.set_title(title)
    ax_raw.set_xticks([1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5])
    ax_raw.legend()

    # --- right: target_label distribution (binary classes or regression target) ---
    if target_type == "binary":
        class_names = ["Negative (0)", "Positive (1)"]
        x = np.arange(2)
        width = 0.25
        for i, split in enumerate(splits):
            df = manifests[split]
            if df is None or "target_label" not in df.columns:
                continue
            counts = df["target_label"].astype(int).value_counts().sort_index()
            c0 = int(counts.get(0, 0))
            c1 = int(counts.get(1, 0))
            bars = ax_target.bar(
                x + i * width,
                [c0, c1],
                width,
                label=f"{split} (n={len(df)})",
                color=colors.get(split, None),
                alpha=0.85,
            )
            for bar in bars:
                h = bar.get_height()
                if h > 0:
                    ax_target.text(
                        bar.get_x() + bar.get_width() / 2,
                        h + 5,
                        str(int(h)),
                        ha="center",
                        va="bottom",
                        fontsize=8,
                    )

        ax_target.set_xticks(x + width)
        ax_target.set_xticklabels(class_names)
        ax_target.set_ylabel("Count")
        ax_target.set_title("Class balance (target_label)")
        ax_target.legend()

        # Annotate with imbalance info from train split
        cc = run["class_counts"]
        if cc.get(0, 0) > 0 and cc.get(1, 0) > 0:
            ratio = cc[0] / cc[1]
            wts = run["effective_class_weights"]
            wt_str = f"weights=[{wts[0]:.2f}, {wts[1]:.2f}]" if wts else "no weighting"
            ax_target.set_xlabel(
                f"Train imbalance: {cc[0]} neg / {cc[1]} pos  (ratio {ratio:.1f}:1)\n{wt_str}",
                fontsize=8,
            )
    else:
        bins = np.arange(0.5, 5.75, 0.5)
        for split in splits:
            df = manifests[split]
            if df is None or "target_label" not in df.columns:
                continue
            ax_target.hist(
                df["target_label"].dropna(),
                bins=bins,
                alpha=0.6,
                label=f"{split} (n={len(df)})",
                color=colors.get(split, None),
                edgecolor="white",
            )
        ax_target.set_xlabel("Target label (continuous)")
        ax_target.set_ylabel("Count")
        ax_target.set_title("Target distribution per split (regression)")
        ax_target.legend()

    plt.tight_layout()
    output_path.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(output_path, dpi=120, bbox_inches="tight")
    plt.close(fig)
    print(f"  Saved: {output_path}")


# ---------------------------------------------------------------------------
# Plot 2: Loss curves
# ---------------------------------------------------------------------------

def plot_loss_curves(run: dict, output_path: Path) -> None:
    """
    Top panel: train_loss and val_loss per epoch.
    Bottom panel: val_metric per epoch (F1 for binary, MSE for regression).
    Vertical dashed line at best epoch.
    """
    history = run["history"]
    if not history:
        print(f"  Skipping loss curves for {run['name']}: no history data")
        return

    epochs = [h["epoch"] for h in history]
    train_losses = [h["train_loss"] for h in history]
    val_losses = [h["val_loss"] for h in history]
    val_metrics = [h["val_metric"] for h in history]
    target_type = run["target_type"]

    # Find best epoch
    if target_type == "binary":
        best_epoch = epochs[int(np.argmax(val_metrics))]
        metric_label = "Val F1"
    else:
        best_epoch = epochs[int(np.argmin(val_metrics))]
        metric_label = "Val MSE (loss)"

    fig, (ax1, ax2) = plt.subplots(2, 1, figsize=(9, 7), sharex=True)
    fig.suptitle(
        f"Training Curves — {run['name']}\n"
        f"({target_type}, {run['augmentation_profile']} aug, {run['crop_strategy']} crop)",
        fontsize=10,
        fontweight="bold",
    )

    # Loss panel
    ax1.plot(epochs, train_losses, "o-", color="#4c72b0", label="Train loss", linewidth=1.8, markersize=4)
    ax1.plot(epochs, val_losses, "s--", color="#dd8452", label="Val loss", linewidth=1.8, markersize=4)
    ax1.axvline(best_epoch, color="gray", linestyle=":", linewidth=1.2, alpha=0.7, label=f"Best epoch ({best_epoch})")
    ax1.set_ylabel("Loss")
    ax1.set_title("Train vs Val Loss")
    ax1.legend(fontsize=8)
    ax1.grid(True, alpha=0.3)

    # Metric panel
    metric_color = "#55a868" if target_type == "binary" else "#c44e52"
    ax2.plot(epochs, val_metrics, "D-", color=metric_color, label=metric_label, linewidth=1.8, markersize=4)
    ax2.axvline(best_epoch, color="gray", linestyle=":", linewidth=1.2, alpha=0.7)
    ax2.set_xlabel("Epoch")
    ax2.set_ylabel(metric_label)
    ax2.set_title(f"Validation Metric ({metric_label})")
    ax2.legend(fontsize=8)
    ax2.grid(True, alpha=0.3)

    # Best metric annotation
    best_val = run["best_metric"]
    if best_val is not None:
        ax2.annotate(
            f"best={best_val:.4f}",
            xy=(best_epoch, best_val),
            xytext=(best_epoch + 0.3, best_val),
            fontsize=8,
            color=metric_color,
        )

    # Overfitting diagnosis annotation
    final_train = train_losses[-1]
    final_val = val_losses[-1]
    gap = final_val - final_train
    if gap > 0.15:
        diagnosis = f"Warning: val_loss > train_loss by {gap:.3f} — possible overfitting"
        color = "#c44e52"
    elif final_val < final_train * 1.05:
        diagnosis = "Train and val loss converging — healthy"
        color = "#55a868"
    else:
        diagnosis = f"Modest gap ({gap:.3f}) — watch for more epochs"
        color = "#8c8c8c"
    fig.text(0.5, 0.01, diagnosis, ha="center", fontsize=8, color=color, style="italic")

    plt.tight_layout(rect=(0, 0.03, 1, 1))
    output_path.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(output_path, dpi=120, bbox_inches="tight")
    plt.close(fig)
    print(f"  Saved: {output_path}")


# ---------------------------------------------------------------------------
# Plot 3: Multi-run comparison overlay
# ---------------------------------------------------------------------------

def plot_comparison(runs: list[dict], output_path: Path) -> None:
    """
    Overlay val_metric curves from multiple runs.
    Also print a summary table to stdout.
    """
    if not runs:
        return

    fig, ax = plt.subplots(figsize=(11, 6))
    cmap = plt.get_cmap("tab10")

    print("\n=== Run Comparison Summary ===")
    header = f"{'Run':<50} {'Type':<12} {'BestEpoch':>10} {'BestMetric':>12} {'Neg':>7} {'Pos':>7} {'Ratio':>7}"
    print(header)
    print("-" * len(header))

    for i, run in enumerate(runs):
        history = run["history"]
        if not history:
            continue
        epochs = [h["epoch"] for h in history]
        val_metrics = [h["val_metric"] for h in history]
        target_type = run["target_type"]

        if target_type == "binary":
            best_idx = int(np.argmax(val_metrics))
            metric_label = "Val F1"
        else:
            best_idx = int(np.argmin(val_metrics))
            metric_label = "Val MSE"

        best_epoch = epochs[best_idx]
        best_val = val_metrics[best_idx]
        color = cmap(i % 10)

        ax.plot(
            epochs,
            val_metrics,
            "o-",
            color=color,
            label=f"{run['name'][:40]} (best={best_val:.3f} @ep{best_epoch})",
            linewidth=1.5,
            markersize=3,
            alpha=0.85,
        )
        ax.axvline(best_epoch, color=color, linestyle=":", linewidth=0.8, alpha=0.4)

        cc = run["class_counts"]
        neg = cc.get(0, 0)
        pos = cc.get(1, 0)
        ratio = f"{neg/pos:.1f}:1" if pos > 0 else "N/A"
        print(f"{run['name']:<50} {target_type:<12} {best_epoch:>10} {best_val:>12.4f} {neg:>7} {pos:>7} {ratio:>7}")

    ax.set_xlabel("Epoch")
    ax.set_ylabel(metric_label)
    ax.set_title("Validation Metric Comparison Across Runs")
    ax.legend(fontsize=7, loc="lower right")
    ax.grid(True, alpha=0.3)

    plt.tight_layout()
    output_path.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(output_path, dpi=120, bbox_inches="tight")
    plt.close(fig)
    print(f"\n  Comparison plot saved: {output_path}")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Generate diagnostic plots for sunset ML experiments.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument(
        "--run-dir",
        action="append",
        dest="run_dirs",
        metavar="DIR",
        help="Path to a completed experiment run directory. Repeat for multiple.",
    )
    parser.add_argument(
        "--all",
        action="store_true",
        help="Plot all completed runs under --output-root.",
    )
    parser.add_argument(
        "--output-root",
        default="ml/artifacts/experiments",
        help="Root folder to search for runs when --all is used (default: ml/artifacts/experiments).",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()

    run_paths: list[Path] = []

    if args.all:
        root = Path(args.output_root)
        if not root.exists():
            print(f"Output root does not exist: {root}")
            return
        run_paths = find_completed_runs(root)
        if not run_paths:
            print(f"No completed runs found under {root}")
            return
        print(f"Found {len(run_paths)} completed run(s) under {root}")
    elif args.run_dirs:
        run_paths = [Path(d) for d in args.run_dirs]
    else:
        print("Specify --run-dir <path> or --all. Run with --help for usage.")
        return

    runs = []
    for rp in run_paths:
        summary_path = rp / "train" / "train_summary.json"
        if not summary_path.exists():
            print(f"Skipping {rp.name}: no train_summary.json")
            continue
        print(f"\nLoading: {rp.name}")
        run = load_run(rp)
        runs.append(run)

        plots_dir = rp / "plots"

        print(f"  Generating label distribution...")
        plot_label_distribution(run, plots_dir / "label_distribution.png")

        print(f"  Generating loss curves...")
        plot_loss_curves(run, plots_dir / "loss_curves.png")

    if len(runs) > 1:
        ts = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
        comparison_path = Path(args.output_root) / ".." / "reports" / f"comparison_{ts}.png"
        print(f"\nGenerating multi-run comparison...")
        plot_comparison(runs, comparison_path)

    print(f"\nDone. {len(runs)} run(s) processed.")


if __name__ == "__main__":
    main()
