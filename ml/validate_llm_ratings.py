#!/usr/bin/env python3
"""
Validate LLM ratings against human consensus ratings.

Computes correlation metrics and generates a scatter plot to verify
that LLM-generated quality scores are consistent with human ratings
before using them as training labels.

Usage:
  python3 ml/validate_llm_ratings.py \
    --ratings-csv ml/artifacts/llm_ratings/ratings_*.csv

  # Require more confident human labels
  python3 ml/validate_llm_ratings.py \
    --ratings-csv ml/artifacts/llm_ratings/initial_ratings.csv \
    --min-human-raters 5
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from scipy.stats import pearsonr, spearmanr

from common.io import ensure_dir


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Validate LLM ratings against human consensus"
    )
    parser.add_argument("--ratings-csv", required=True, help="Path to LLM ratings CSV")
    parser.add_argument(
        "--min-human-raters", type=int, default=2,
        help="Minimum human rating count for inclusion (default: 2)",
    )
    parser.add_argument(
        "--pass-threshold", type=float, default=0.80,
        help="Pearson correlation threshold for pass/fail (default: 0.80)",
    )
    parser.add_argument(
        "--output-dir", default="",
        help="Output directory for plots and report (default: same dir as CSV)",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    csv_path = Path(args.ratings_csv)
    df = pd.read_csv(csv_path)

    output_dir = Path(args.output_dir) if args.output_dir else csv_path.parent
    ensure_dir(output_dir)

    # Filter to rows with human ratings that meet the rater count threshold
    has_human = df[
        (df["human_calculated_rating"].notna())
        & (df["human_rating_count"] >= args.min_human_raters)
    ].copy()

    print(f"Total rows in CSV: {len(df)}")
    print(f"Rows with human ratings (>= {args.min_human_raters} raters): {len(has_human)}")

    if len(has_human) < 10:
        print("ERROR: Not enough rows with human ratings to validate. "
              "Try lowering --min-human-raters.")
        return

    llm_quality = has_human["llm_quality"].astype(float).values
    human_normalized = (has_human["human_calculated_rating"].astype(float) / 5.0).values

    r_pearson, p_pearson = pearsonr(llm_quality, human_normalized)
    r_spearman, p_spearman = spearmanr(llm_quality, human_normalized)
    mae = float(np.mean(np.abs(llm_quality - human_normalized)))

    # Binary agreement: LLM >= 0.7 should agree with human >= 4.0 (normalized 0.8)
    llm_binary = (llm_quality >= 0.7).astype(int)
    human_binary = (human_normalized >= 0.8).astype(int)
    binary_agreement = float(np.mean(llm_binary == human_binary))

    passed = r_pearson >= args.pass_threshold

    report = {
        "ratings_csv": str(csv_path),
        "total_rows": len(df),
        "rows_with_human_ratings": len(has_human),
        "min_human_raters": args.min_human_raters,
        "pearson_r": round(r_pearson, 4),
        "pearson_p": round(p_pearson, 6),
        "spearman_r": round(r_spearman, 4),
        "spearman_p": round(p_spearman, 6),
        "mae": round(mae, 4),
        "binary_agreement": round(binary_agreement, 4),
        "pass_threshold": args.pass_threshold,
        "passed": passed,
    }

    # Print results
    print(f"\n--- Validation Results ---")
    print(f"  Pearson r:          {r_pearson:.4f}  (p={p_pearson:.2e})")
    print(f"  Spearman r:         {r_spearman:.4f}  (p={p_spearman:.2e})")
    print(f"  MAE:                {mae:.4f}")
    print(f"  Binary agreement:   {binary_agreement:.1%}")
    print(f"  Pass threshold:     {args.pass_threshold}")
    print(f"  RESULT:             {'PASS' if passed else 'FAIL'}")

    if not passed:
        print(f"\n  WARNING: Pearson correlation ({r_pearson:.4f}) is below "
              f"threshold ({args.pass_threshold}). Refine the LLM prompt "
              f"before using these ratings for training.")

    # Scatter plot
    fig, axes = plt.subplots(1, 2, figsize=(14, 6))

    ax1 = axes[0]
    ax1.scatter(human_normalized, llm_quality, alpha=0.3, s=20)
    ax1.plot([0, 1], [0, 1], "r--", alpha=0.5, label="Perfect agreement")
    ax1.set_xlabel("Human Rating (normalized 0-1)")
    ax1.set_ylabel("LLM Quality Score")
    ax1.set_title(f"LLM vs Human Ratings\nPearson r={r_pearson:.3f}, n={len(has_human)}")
    ax1.legend()
    ax1.set_xlim(0, 1.05)
    ax1.set_ylim(0, 1.05)
    ax1.grid(True, alpha=0.3)

    ax2 = axes[1]
    residuals = llm_quality - human_normalized
    ax2.hist(residuals, bins=30, edgecolor="black", alpha=0.7)
    ax2.axvline(0, color="r", linestyle="--", alpha=0.5)
    ax2.set_xlabel("Residual (LLM - Human)")
    ax2.set_ylabel("Count")
    ax2.set_title(f"Residual Distribution\nMAE={mae:.3f}")
    ax2.grid(True, alpha=0.3)

    plt.tight_layout()
    plot_path = output_dir / "validation_scatter.png"
    fig.savefig(plot_path, dpi=150)
    plt.close(fig)
    print(f"\nPlot saved to {plot_path}")

    report_path = output_dir / "validation_report.json"
    report_path.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(f"Report saved to {report_path}")


if __name__ == "__main__":
    main()
