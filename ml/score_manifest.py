#!/usr/bin/env python3
"""Score an existing manifest CSV with an already-exported ONNX model.

Deliberately decoupled from run_experiment.py: this judges a *previously
trained* model against a *different* label set, which is the only way to ask
"what does v4 actually do on the operator gold labels?"

v4's own eval_report.json cannot answer that. Its binary test split held 4
positive webcam frames and 303 positive Flickr photos, because the positive
class was `llm_quality >= 0.75` and Claude's quality scale tops out near 0.88
on webcam frames. Its reported F1 of 0.836 mostly measures "is this a Flickr
photograph", not "is this a sunset".

Usage:
  python ml/score_manifest.py \
    --manifest ml/artifacts/datasets/gold_baseline/<ts>/manifest_test.csv \
    --onnx ml/artifacts/models/binary_resnet18/<tag>/model.onnx \
    --output ml/artifacts/reports/v4_binary_on_gold_test.json
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

import numpy as np
import onnxruntime as ort
import pandas as pd
import requests
from PIL import Image
from tqdm.auto import tqdm

# Must match ml/train.py's eval transform, or the scores mean nothing.
IMAGENET_MEAN = np.array([0.485, 0.456, 0.406], dtype=np.float32)
IMAGENET_STD = np.array([0.229, 0.224, 0.225], dtype=np.float32)


def binary_metrics(y_true, y_score, threshold: float) -> dict:
    """Precision / recall / F1 / balanced accuracy at one decision threshold."""
    tp = fp = tn = fn = 0
    for t, s in zip(y_true, y_score):
        pred = 1 if s >= threshold else 0
        if t == 1 and pred == 1:
            tp += 1
        elif t == 0 and pred == 1:
            fp += 1
        elif t == 0 and pred == 0:
            tn += 1
        else:
            fn += 1
    precision = tp / (tp + fp) if (tp + fp) else 0.0
    recall = tp / (tp + fn) if (tp + fn) else 0.0
    f1 = (
        (2 * precision * recall / (precision + recall))
        if (precision + recall)
        else 0.0
    )
    tnr = tn / (tn + fp) if (tn + fp) else 0.0
    return {
        "count": tp + fp + tn + fn,
        "precision": precision,
        "recall": recall,
        "f1": f1,
        "balanced_accuracy": (recall + tnr) / 2,
        "confusion": {"tn": tn, "fp": fp, "fn": fn, "tp": tp},
    }


def cache_path(ref: str, cache_dir: Path) -> Path:
    """Reuse ml/train.py's sha256 cache naming so downloads are shared."""
    ext = Path(ref.split("?")[0]).suffix.lower()
    if ext not in {".jpg", ".jpeg", ".png", ".webp"}:
        ext = ".jpg"
    return cache_dir / f"{hashlib.sha256(ref.encode('utf-8')).hexdigest()}{ext}"


def load_image(ref: str, cache_dir: Path) -> np.ndarray | None:
    """Load and preprocess one image, downloading into the cache if needed."""
    path = cache_path(ref, cache_dir)
    if not path.exists():
        try:
            resp = requests.get(ref, timeout=30)
            resp.raise_for_status()
            path.write_bytes(resp.content)
        except Exception:
            return None
    try:
        img = Image.open(path).convert("RGB").resize((224, 224), Image.BILINEAR)
    except Exception:
        return None
    arr = np.asarray(img, dtype=np.float32) / 255.0
    arr = (arr - IMAGENET_MEAN) / IMAGENET_STD
    return arr.transpose(2, 0, 1)[None, :, :, :].astype(np.float32)


def softmax_positive(logits: np.ndarray) -> float:
    """P(class 1) from a 2-logit output, max-shifted for numerical stability."""
    e = np.exp(logits - logits.max())
    return float((e / e.sum())[1])


def main() -> None:
    p = argparse.ArgumentParser(description="Score a manifest with an ONNX model")
    p.add_argument("--manifest", required=True)
    p.add_argument("--onnx", required=True)
    p.add_argument("--output", required=True)
    p.add_argument("--threshold", type=float, default=0.5)
    p.add_argument("--cache-dir", default="ml/artifacts/image_cache")
    p.add_argument("--no-progress", action="store_true")
    args = p.parse_args()

    df = pd.read_csv(args.manifest)
    sess = ort.InferenceSession(args.onnx)
    input_name = sess.get_inputs()[0].name
    cache_dir = Path(args.cache_dir)
    cache_dir.mkdir(parents=True, exist_ok=True)

    y_true: list[int] = []
    y_score: list[float] = []
    sources: list[str] = []
    skipped = 0

    for _, row in tqdm(
        df.iterrows(), total=len(df), desc="Scoring", unit="img",
        disable=args.no_progress,
    ):
        arr = load_image(str(row["image_path_or_url"]), cache_dir)
        if arr is None:
            skipped += 1
            continue
        out = sess.run(None, {input_name: arr})[0][0]
        y_score.append(softmax_positive(np.asarray(out, dtype=np.float32)))
        y_true.append(int(row["target_label"]))
        sources.append(str(row["source"]) if "source" in df.columns else "webcam")

    report = {
        "manifest": args.manifest,
        "onnx": args.onnx,
        "threshold": args.threshold,
        "scored": len(y_true),
        "skipped_unreadable": skipped,
        "overall": binary_metrics(y_true, y_score, args.threshold),
    }
    for src in sorted(set(sources)):
        idx = [i for i, s in enumerate(sources) if s == src]
        report[f"source::{src}"] = binary_metrics(
            [y_true[i] for i in idx], [y_score[i] for i in idx], args.threshold
        )

    # A threshold sweep, since a model tuned for one label definition may just
    # need recalibration rather than retraining.
    report["threshold_sweep"] = [
        {"threshold": round(t, 2), **binary_metrics(y_true, y_score, t)}
        for t in [i / 20 for i in range(2, 19)]
    ]

    out_path = Path(args.output)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(report, indent=2))
    print(json.dumps({k: v for k, v in report.items()
                      if k != "threshold_sweep"}, indent=2))


if __name__ == "__main__":
    main()
