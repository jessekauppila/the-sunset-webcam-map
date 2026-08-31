#!/usr/bin/env python3
"""Quality-head + composed-system eval against an operator-rated sample.

Companion to ml/score_manifest.py (which covers the detection head alone).
This scores BOTH heads of a shipping pair on a sample exported by
ml/build_operator_manifest.py and reports:

  - quality head vs operator on the confirmed sunsets (MAE / RMSE / Pearson,
    plus Claude's Pearson on the identical frames as the baseline)
  - the composed system at the decision gate: false-shows, >=4 shown,
    Spearman between tile signal and the operator's N/1-5 ordering, mean
    tile by rating, and the top-8 tiles

Preprocessing reuses score_manifest.load_image — the verified
training-parity path (see feedback-scoring-pipeline-parity). Regression
output is read the way ml/evaluate.py reads it: raw squeezed output, no
sigmoid.

Usage:
  .venv/bin/python ml/eval_composed_operator.py \
    --sample-name random_ordinary_v2 --gate 0.55 \
    --binary-onnx ml/artifacts/models/binary_resnet18/<tag>/model.onnx \
    --quality-onnx ml/artifacts/models/regression_resnet18/<tag>/model.onnx
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import onnxruntime as ort
import pandas as pd
from scipy.stats import pearsonr, spearmanr

from score_manifest import load_image, softmax_positive


def main() -> None:
    p = argparse.ArgumentParser(description="Composed two-head eval vs operator truth")
    p.add_argument("--sample-name", required=True)
    p.add_argument("--gate", type=float, default=0.55)
    p.add_argument("--binary-onnx", required=True)
    p.add_argument("--quality-onnx", required=True)
    p.add_argument("--cache-dir", default="ml/artifacts/image_cache")
    p.add_argument("--report-prefix", default=None,
                   help="reports are written as ml/artifacts/reports/<prefix>_*.json "
                        "(default: the sample name)")
    args = p.parse_args()

    prefix = args.report_prefix or args.sample_name
    dataset = Path("ml/artifacts/datasets") / args.sample_name
    full = pd.read_csv(dataset / "manifest_operator_is_sunset.csv")
    qual = pd.read_csv(dataset / "manifest_operator_quality.csv")
    rating_by_id = dict(zip(qual.snapshot_id, qual.rating))
    cache = Path(args.cache_dir)

    bsess = ort.InferenceSession(args.binary_onnx)
    qsess = ort.InferenceSession(args.quality_onnx)
    bin_name = bsess.get_inputs()[0].name
    q_name = qsess.get_inputs()[0].name

    rows = []
    skipped = 0
    for _, r in full.iterrows():
        arr = load_image(str(r.image_path_or_url), cache)
        if arr is None:
            skipped += 1
            continue
        p_sunset = softmax_positive(
            np.asarray(bsess.run(None, {bin_name: arr})[0][0], dtype=np.float32))
        q = float(np.asarray(qsess.run(None, {q_name: arr})[0]).squeeze())
        rows.append(dict(
            snapshot_id=int(r.snapshot_id), is_sunset=int(r.target_label),
            rating=rating_by_id.get(r.snapshot_id),  # None => operator N
            llm_quality=float(r.llm_quality), p_sunset=p_sunset, quality=q,
        ))
    df = pd.DataFrame(rows)

    # ---- Quality head on the operator-confirmed sunsets ----
    s = df[df.is_sunset == 1].copy()
    s["label"] = (s.rating - 1) / 4
    quality_report = dict(
        model=args.quality_onnx,
        sample=args.sample_name, n=int(len(s)),
        skipped_unreadable=skipped,
        preprocessing="FIXED (matches training)",
        mae=float(np.mean(np.abs(s.quality - s.label))),
        rmse=float(np.sqrt(np.mean((s.quality - s.label) ** 2))),
        pearson_model=float(pearsonr(s.label, s.quality)[0]),
        pearson_claude_same_frames=float(pearsonr(s.label, s.llm_quality)[0]),
        mean_quality_by_rating={int(k): round(float(v), 3)
                                for k, v in s.groupby("rating").quality.mean().items()},
    )

    # ---- Composed system: gate decides shown, quality sizes the tile ----
    df["shown"] = df.p_sunset >= args.gate
    df["tile"] = np.where(df.shown, df.quality, 0.0)
    df["op_order"] = df.rating.fillna(0)  # N=0 < 1..5

    n_frames = df[df.is_sunset == 0]
    ge4 = df[df.rating >= 4]
    r1 = df[df.rating == 1]
    composed_report = dict(
        sample=args.sample_name, gate=args.gate,
        binary_onnx=args.binary_onnx, quality_onnx=args.quality_onnx,
        n=int(len(df)),
        false_shows=f"{int(n_frames.shown.sum())}/{len(n_frames)}",
        ge4_shown=f"{int(ge4.shown.sum())}/{len(ge4)}",
        spearman_tile_vs_operator=float(spearmanr(df.op_order, df.tile)[0]),
        mean_tile_by_rating={("N" if np.isnan(k) else int(k)): round(float(v), 3)
                             for k, v in df.groupby("rating", dropna=False).tile.mean().items()},
        hidden_rating1=f"{int((~r1.shown).sum())}/{len(r1)}",
        top8=[dict(snapshot_id=int(r.snapshot_id),
                   rating=("N" if pd.isna(r.rating) else int(r.rating)),
                   tile=round(float(r.tile), 3))
              for r in df.nlargest(8, "tile").itertuples()],
    )

    reports = Path("ml/artifacts/reports")
    (reports / f"quality_head_on_operator_{prefix}.json").write_text(
        json.dumps(quality_report, indent=2))
    (reports / f"composed_on_operator_{prefix}.json").write_text(
        json.dumps(composed_report, indent=2))
    print(json.dumps(quality_report, indent=2))
    print(json.dumps(composed_report, indent=2))


if __name__ == "__main__":
    main()
