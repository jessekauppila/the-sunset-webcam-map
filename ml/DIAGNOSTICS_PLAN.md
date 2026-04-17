# ML Diagnostics Plan

## Goal

Before tuning hyperparameters, architectures, or loss functions, produce
visual diagnostics from existing training artifacts so we can make
evidence-based decisions. The professor's core advice: "look at your data
before touching the model."

---

## How to generate plots

### Single run (retroactive, on an existing experiment)

```bash
python ml/plot_diagnostics.py --run-dir ml/artifacts/experiments/<run_id>
```

Example:

```bash
python ml/plot_diagnostics.py \
  --run-dir ml/artifacts/experiments/20260314_070706_v2_mild_crop_balanced
```

### All completed runs at once

```bash
python ml/plot_diagnostics.py --all
```

Finds every run under `ml/artifacts/experiments/` that has a
`train/train_summary.json` and generates plots for each. Also generates a
multi-run comparison overlay at `ml/artifacts/reports/comparison_<ts>.png`.

### Multiple specific runs (comparison)

```bash
python ml/plot_diagnostics.py \
  --run-dir ml/artifacts/experiments/20260314_070706_v2_mild_crop_balanced \
  --run-dir ml/artifacts/experiments/20260314_082956_v2_no_crop_balanced
```

### Automatic (baked into every future run)

`run_experiment.py` now runs `plot_diagnostics.py` automatically after eval.
You do not need to do anything extra for new experiments.

---

## Plot outputs

Each run directory gets a `plots/` subfolder:

```
ml/artifacts/experiments/<run_id>/
  plots/
    label_distribution.png   -- histogram of ratings + class balance
    loss_curves.png          -- train/val loss and val metric over epochs
```

Multi-run comparison goes to:

```
ml/artifacts/reports/comparison_<timestamp>.png
```

---

## How to read the plots

### label_distribution.png

**Left panel — Raw rating histogram:**
Shows where your human ratings (1–5 scale) fall across train/val/test splits.

What to look for:
- Clustering around 2.5–3.5 means most images were rated "average." The
  model will tend to predict average and struggle with extremes.
- Thin bars at 1, 4.5, 5 means you have few "definitive" examples. The
  model cannot learn clear boundaries between great and mediocre.
- Splits should look similar in shape (same distribution train vs val vs
  test), otherwise your split was not representative.

**Right panel — Target label distribution (binary runs):**
Shows class 0 (not-good) vs class 1 (good) counts per split.

What to look for:
- A 4:1 or greater ratio between negative and positive means significant
  imbalance. Without weighting, the model can achieve ~80% accuracy by
  always predicting negative.
- The x-axis annotation shows the effective class weights used. If
  `class_weighting: balanced`, the positive class is upweighted
  proportionally. If `class_weighting: none`, the model sees raw imbalance.
- For "archive great sunsets," recall on class 1 (positives) is the key
  metric. If you miss a great sunset, it is gone. A false alarm (capturing
  a mediocre one) is less costly.

### loss_curves.png

**Top panel — Train and val loss:**

Patterns and what they mean:

| Pattern | Meaning | What to try |
|---------|---------|-------------|
| Both lines go down together | Healthy learning | Run more epochs or export more data |
| Train down, val up (diverging) | Overfitting | Reduce epochs, add dropout, get more data |
| Both flat/high from epoch 1 | Underfitting | Learning rate too low, model too small, or bad data |
| Val loss bouncy but train smooth | Val set too small, or noisy labels | Larger val set, better labels |

**Bottom panel — Validation metric:**

- Binary: val F1 (higher = better; 1.0 is perfect, 0.0 is random)
- Regression: val MSE (lower = better)

The dashed vertical line marks the epoch where the best checkpoint was
saved. If the best checkpoint is at a very early epoch (e.g. 3 of 10), you
may be wasting training time — the model peaked early. If it is at the
final epoch, more epochs might still help.

The small annotation at the bottom of the figure gives an automatic
diagnosis (overfitting warning, healthy, or modest gap).

### comparison_<timestamp>.png (multi-run)

Overlaid val metric curves from multiple runs. Use this to compare:
- Crop strategies (random_resized vs center vs resize_only)
- Class weighting (none vs balanced)
- Augmentation profiles (off vs light vs medium)
- Number of epochs

A stdout table is also printed with: run name, best epoch, best metric,
class counts, and imbalance ratio.

---

## Current class balance (known from your best binary run)

From `20260314_070706_v2_mild_crop_balanced/train/train_summary.json`:

| | Count | % |
|---|---|---|
| Negative (class 0) | 2638 | 80% |
| Positive (class 1) | 646 | 20% |
| Ratio | 4.1:1 | |
| Effective weights | [0.62, 2.54] | (balanced mode) |

This is significant imbalance. `class_weighting: balanced` compensates by
upweighting positives ~4x in the loss function.

---

## Current loss curve summary (known from your best binary run)

From `20260314_070706_v2_mild_crop_balanced` (10 epochs):

| Epoch | Train loss | Val loss | Val F1 |
|-------|-----------|----------|--------|
| 1 | 0.381 | 0.418 | 0.725 |
| 4 | 0.163 | 0.287 | 0.800 |
| 8 | 0.091 | 0.316 | 0.802 |
| 10 | 0.075 | 0.459 | 0.832 |

Note: train loss decreases smoothly but val loss bounces (0.29 to 0.53).
The val F1 improves despite val loss bouncing — the model is getting better
at ranking but less calibrated. This is a sign of mild overfitting and
unstable training, likely from the small val set or noisy labels.

---

## Next diagnostic steps (after running the plots)

1. If label distribution shows clustering at 2.5–3.5: consider labeling
   more definitive examples (1s and 5s), or tightening the binary threshold
   to better separate "archive-worthy" from "average."

2. If loss curves show overfitting: try fewer epochs, add `dropout`, or
   get more training images.

3. If class imbalance is very high (>5:1): try `imbalance.sampler: weighted`
   in addition to `class_weighting: balanced` and compare val recall.

4. For regression: `evaluate.py` currently reports MAE and RMSE. Add R²
   (`r2_score` from sklearn) to get a normalized measure of fit.

---

## Known production issue (separate from training)

`app/api/cron/update-windy/lib/aiScoring.ts` currently feeds a small
feature vector to the ONNX model, not a 224x224 image tensor. Any model
trained on images will not work correctly in production until that path is
updated. This is tracked separately and is not in scope for this diagnostic
work.
