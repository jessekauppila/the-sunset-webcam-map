# ML Pipeline Operating Guide

Last updated: April 2026

This is the single reference for operating the sunset webcam ML pipeline.
It covers everything from environment setup through production deployment,
including the LLM labeling system, Flickr scraper, and experiment workflow.

For background on *why* the pipeline works this way, see:

- `DIAGNOSTICS_FINDINGS.md` -- what the professor consultation revealed
- `LLM_TEACHER_AND_EXTERNAL_DATA_PLAN.md` -- strategy and rationale
- `IMPLEMENTATION_PLAN.md` -- step-by-step build log

---

## What this pipeline does

The pipeline trains an image classifier that looks at webcam snapshots and
answers: "How good is this sunset?" It outputs a continuous 0.0-1.0 quality
score used for archiving, gallery ranking, and display.

```
                        ┌─────────────┐
                        │  Data sources│
                        └──────┬──────┘
                               │
              ┌────────────────┼────────────────┐
              │                │                │
      ┌───────▼──────┐ ┌──────▼───────┐ ┌──────▼──────┐
      │   Webcam      │ │   Flickr     │ │  LLM Rater  │
      │   snapshots   │ │   scraper    │ │  (labels)   │
      │   (Postgres)  │ │  (external)  │ │             │
      └───────┬───────┘ └──────┬───────┘ └──────┬──────┘
              │                │                │
              └────────────────┼────────────────┘
                               │
                      ┌────────▼────────┐
                      │ export_dataset  │
                      │  (manifest CSV) │
                      └────────┬────────┘
                               │
                      ┌────────▼────────┐
                      │   train.py      │
                      │  (PyTorch)      │
                      └────────┬────────┘
                               │
                      ┌────────▼────────┐
                      │  evaluate.py    │
                      │  (metrics)      │
                      └────────┬────────┘
                               │
                      ┌────────▼────────┐
                      │  export_onnx    │
                      │  (deploy)       │
                      └────────┬────────┘
                               │
                      ┌────────▼────────┐
                      │  aiScoring.ts   │
                      │  (production)   │
                      └─────────────────┘
```

---

## Code map

### Core pipeline

| Script | What it does |
|--------|-------------|
| `export_dataset.py` | Queries Postgres for labeled snapshots, builds deterministic train/val/test manifest CSVs. Supports webcam data, external Flickr data (`--include-external`), and LLM label overrides (`--llm-ratings-csv`). |
| `train.py` | Trains a transfer-learning image classifier (ResNet18 or MobileNetV3). Supports early stopping, cosine LR decay, and head dropout. Saves best checkpoint as `best.pt`. |
| `evaluate.py` | Runs inference on the test split. Reports precision/recall/F1/AUC (binary) or MAE/RMSE/R²/Pearson/Spearman (regression). Saves predictions CSV and optional threshold sweep. |
| `export_onnx.py` | Converts a PyTorch checkpoint to ONNX format for production deployment. |
| `export_onnx_versioned.py` | Same as above but writes to versioned artifact folders for rollback support. |

### Data acquisition

| Script | What it does |
|--------|-------------|
| `flickr_scraper.py` | Searches Flickr API by tags, downloads CC-licensed images, uploads to Firebase Storage, inserts metadata into Postgres `external_images` table. |
| `llm_rater.py` | Sends images to Gemini Flash or GPT-4o-mini for structured quality ratings (0.0-1.0). Rates webcam snapshots and/or external images. Writes CSV + optional DB writeback. |
| `validate_llm_ratings.py` | Computes Pearson/Spearman correlation between LLM and human ratings. Pass/fail gate at Pearson > 0.80. |

### Experiment management

| Script | What it does |
|--------|-------------|
| `run_experiment.py` | Single-entrypoint runner: reads a YAML config, runs export -> train -> evaluate -> plot in sequence. All artifacts land in a timestamped run folder. |
| `run_training.py` | Convenience launcher that resolves `DATABASE_URL` from `.env.local` and runs experiments. |
| `compare_experiments.py` | Aggregates multiple run folders into a comparison JSON/CSV report. |
| `plot_diagnostics.py` | Generates label distribution histograms, loss curves, and multi-run comparison overlays. Runs automatically after each experiment. |

### Shared modules

| Module | What it does |
|--------|-------------|
| `common/splits.py` | Deterministic webcam-group split logic (prevents data leakage). |
| `common/labels.py` | Binary/regression label mapping rules. |
| `common/io.py` | Shared artifact I/O helpers. |

---

## 1. Environment setup

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r ml/requirements.txt
```

### Required environment variables

| Variable | Required for | Where to get it |
|----------|-------------|-----------------|
| `DATABASE_URL` | All export/rater scripts | Neon dashboard (or any Postgres provider). Format: `postgresql://USER:PASS@HOST:PORT/DBNAME` |
| `GEMINI_API_KEY` | LLM rater (Gemini provider) | Google AI Studio |
| `OPENAI_API_KEY` | LLM rater (OpenAI provider) | OpenAI platform |
| `FLICKR_API_KEY` | Flickr scraper | https://www.flickr.com/services/apps/create/ |
| `FIREBASE_STORAGE_BUCKET` | Flickr scraper (Firebase upload) | Firebase console |

Store credentials in `.env.local` (gitignored). The `run_training.py`
launcher reads `DATABASE_URL` from there automatically.

### Database migrations

Run these once before first use:

```bash
# External images table (for Flickr scraper)
psql $DATABASE_URL -f database/migrations/20260417_external_images.sql

# LLM quality column on webcam snapshots (for LLM rater --write-to-db)
psql $DATABASE_URL -f database/migrations/20260417_add_llm_quality_to_snapshots.sql
```

---

## 2. Running an experiment (the standard workflow)

Every experiment is driven by a single YAML config file. This is the
recommended workflow for all model training.

### Pick or create a config

Available configs:

| Config | Description |
|--------|-------------|
| `configs/v2_baseline.yaml` | Original binary classifier, no balancing |
| `configs/v2_mild_crop_balanced.yaml` | Binary, mild crop, balanced class weights |
| `configs/v2_no_crop_balanced.yaml` | Binary, no crop, balanced class weights |
| `configs/v2_regression_mild_crop.yaml` | Regression on human ratings |
| `configs/v3_regression_llm_labels.yaml` | Regression on LLM labels, cosine LR, early stopping, dropout |
| `configs/v3_regression_llm_with_external.yaml` | Same as above + Flickr external images |

Pilot versions (3 epochs) exist for `v2_mild_crop_balanced` and
`v2_no_crop_balanced` for quick sanity checks.

### Run the experiment

```bash
python ml/run_experiment.py --config ml/configs/v3_regression_llm_labels.yaml
```

Or use the convenience launcher (auto-resolves `DATABASE_URL` from `.env.local`):

```bash
python ml/run_training.py --config ml/configs/v3_regression_llm_labels.yaml
```

### What happens

The runner executes these steps in sequence:

1. **Export** -- queries DB, builds manifest CSVs with train/val/test splits
2. **Train** -- loads images, trains model, saves `best.pt` checkpoint
3. **Evaluate** -- runs test split inference, writes metrics report
4. **Plot** -- generates diagnostic plots automatically

All outputs land in a timestamped folder:

```
ml/artifacts/experiments/<timestamp>_<run_name>/
  config.input.yaml          -- copy of your config
  config.resolved.json       -- all resolved settings
  run_manifest.json          -- paths to all artifacts
  dataset/<export_ts>/       -- manifest CSVs + export_meta.json
  train/
    best.pt                  -- best model checkpoint
    train_summary.json       -- epoch history, class counts, timing
  eval/
    eval_report.json         -- all metrics
    predictions.csv          -- raw y_true vs y_pred (regression)
  plots/
    label_distribution.png   -- rating histograms + class balance
    loss_curves.png          -- train/val loss + val metric over epochs
```

### Compare experiments

```bash
python ml/compare_experiments.py \
  --run-dirs \
    ml/artifacts/experiments/<run_a> \
    ml/artifacts/experiments/<run_b>
```

Outputs:

- `ml/artifacts/reports/experiment_compare.json`
- `ml/artifacts/reports/experiment_compare.csv`

### Regenerate diagnostic plots

```bash
# All runs
python ml/plot_diagnostics.py --all

# Specific runs (with comparison overlay)
python ml/plot_diagnostics.py \
  --run-dir ml/artifacts/experiments/<run_a> \
  --run-dir ml/artifacts/experiments/<run_b>
```

---

## 3. Understanding the diagnostic plots

### label_distribution.png

**Left panel -- raw rating histogram:** shows where human ratings (1-5)
fall across splits.

| What you see | What it means |
|-------------|---------------|
| Clustering around 2.5-3.5 | Most images rated "average." Model will struggle with extremes. |
| Thin bars at 1, 4.5, 5 | Few definitive examples. Model cannot learn clear boundaries. |
| Different shapes across splits | Split is not representative. Check split logic. |

**Right panel -- target label distribution (binary runs):** class 0 vs
class 1 counts per split.

| What you see | What it means |
|-------------|---------------|
| 4:1+ negative-to-positive ratio | Significant imbalance. Use `class_weighting: balanced`. |
| Annotation shows effective weights | Confirms whether balancing is active. |

For the "archive great sunsets" use case, **recall on positives** is the
key metric. Missing a great sunset is worse than capturing a mediocre one.

### loss_curves.png

**Top panel -- train vs val loss:**

| Pattern | Meaning | What to try |
|---------|---------|-------------|
| Both lines go down together | Healthy learning | More epochs or more data |
| Train down, val up (diverging) | Overfitting | Fewer epochs, add dropout, more data |
| Both flat/high from epoch 1 | Underfitting | Higher LR, larger model, check data |
| Val loss bouncy, train smooth | Val set too small or noisy labels | Larger val set, better labels |

**Bottom panel -- validation metric:** F1 for binary (higher = better),
MSE for regression (lower = better). Dashed line marks the best checkpoint
epoch. An automatic diagnosis annotation appears at the bottom.

### comparison plot (multi-run)

Overlaid val metric curves from multiple runs. The stdout table shows: run
name, best epoch, best metric, class counts, and imbalance ratio.

---

## 4. LLM rating pipeline

The LLM rater replaces noisy human integer ratings with consistent
continuous 0.0-1.0 quality scores. This fixes the label noise problem
identified in DIAGNOSTICS_FINDINGS.md.

### Step 1: Dry-run to test

```bash
python3 ml/llm_rater.py --provider gemini --source webcam --dry-run
```

Processes 5 images and prints results without writing anything.

### Step 2: Rate the webcam archive

```bash
python3 ml/llm_rater.py \
  --provider gemini \
  --source webcam \
  --output-csv ml/artifacts/llm_ratings/initial_ratings.csv \
  --write-to-db
```

`--write-to-db` persists `llm_quality` back to `webcam_snapshots` so it
is available for the disagreement UI and future exports.

`--skip-rated` resumes from where you left off if interrupted.

### Step 3: Rate external (Flickr) images

```bash
python3 ml/llm_rater.py \
  --provider gemini \
  --source external \
  --output-csv ml/artifacts/llm_ratings/external_ratings.csv \
  --write-to-db
```

Writes directly to `external_images.llm_quality` (column already exists
in the schema). Only images with `llm_quality IS NULL` are processed.

### Step 4: Validate against human labels

```bash
python3 ml/validate_llm_ratings.py \
  --ratings-csv ml/artifacts/llm_ratings/initial_ratings.csv
```

**Pass/fail gate:** Pearson correlation > 0.80 means proceed. Below that,
refine the LLM prompt before trusting the labels for training.

Outputs:

- Pearson r, Spearman r, MAE, binary agreement rate
- Scatter plot: `ml/artifacts/llm_ratings/validation_scatter.png`

### Step 5: Train with LLM labels

```bash
python ml/run_experiment.py --config ml/configs/v3_regression_llm_labels.yaml
```

Or with Flickr external data included:

```bash
python ml/run_experiment.py --config ml/configs/v3_regression_llm_with_external.yaml
```

### LLM rater CLI reference

| Flag | Default | Description |
|------|---------|-------------|
| `--provider` | `gemini` | LLM provider: `gemini` or `openai` |
| `--model` | per-provider default | Model name (e.g. `gemini-2.0-flash`, `gpt-4o-mini`) |
| `--source` | `webcam` | Image source: `webcam`, `external`, or `all` |
| `--output-csv` | timestamped path | Where to write ratings CSV |
| `--write-to-db` | false | Also persist ratings to Postgres |
| `--skip-rated` | false | Skip images already in the output CSV (resume) |
| `--dry-run` | false | Process 5 images, print results, do not write |
| `--rpm` | 15 | Rate limit (requests per minute) |
| `--limit` | all | Max images to process |
| `--database-url` | `$DATABASE_URL` | Postgres connection string |
| `--api-key` | `$GEMINI_API_KEY` / `$OPENAI_API_KEY` | LLM API key |

---

## 5. Flickr scraper

Supplements webcam data with curated sunset images from Flickr. Addresses
the class imbalance problem (only 646 positive examples out of 3,284).

### Scrape sunset images

```bash
python3 ml/flickr_scraper.py \
  --query sunset sunrise "golden hour" \
  --max-images 2000
```

### Scrape negative examples

```bash
python3 ml/flickr_scraper.py \
  --query "cloudy sky" overcast "night sky" \
  --max-images 500 \
  --category negative
```

### Dry-run (preview without downloading)

```bash
python3 ml/flickr_scraper.py --query sunset --max-images 100 --dry-run
```

### Local-only (no Firebase upload)

```bash
python3 ml/flickr_scraper.py --query sunset --max-images 50 --local-only
```

Images save to `ml/artifacts/external_images/flickr/`.

The scraper automatically skips duplicates (matched by `source` +
`source_id`), so interrupted runs can be resumed by rerunning the same
command.

Scraped images are **not usable for training until LLM-rated.** Run the
LLM rater with `--source external` after scraping.

Full scraper documentation: `ml/EXTERNAL_DATA_SCRAPER.md`

---

## 6. Config schema reference

Every experiment config YAML has these sections:

```yaml
run:
  name: v3_regression_llm_labels    # identifies this experiment
  seed: 20260212                    # reproducibility seed
  notes: "Description of this run"
  tags: [v3, regression, llm]       # for filtering/search

data:
  label_source: manual_only         # manual_only | public_aggregate
  target_type: regression           # binary | regression
  binary_threshold: 4.0             # only for binary target
  min_rating_count: 1               # minimum human ratings per snapshot
  include_external: false           # merge Flickr images into manifest
  external_categories: [sunset, negative]
  llm_ratings_csv: ""               # path to LLM ratings CSV (overrides labels)
  label_merge_strategy: human_only  # human_only | llm_only | human_override | weighted_average
  llm_weight: 0.7                   # weight for weighted_average strategy
  splits:
    seed: 20260212
    train_pct: 70
    val_pct: 15
    test_pct: 15

model:
  name: resnet18                    # resnet18 | mobilenet_v3_small
  epochs: 30
  batch_size: 32
  learning_rate: 0.0001
  lr_schedule: none                 # none | cosine
  early_stopping_patience: 0        # 0 = disabled, 5 = recommended
  head_dropout: 0.0                 # 0.0 = disabled, 0.3 = recommended

imbalance:
  class_weighting: none             # none | balanced | manual
  sampler: none                     # none | weighted
  manual_weights:                   # only when class_weighting: manual
    neg: 1.0
    pos: 1.0

augmentation:
  profile: off                      # off | light | medium

cropping:
  strategy: random_resized          # random_resized | center | resize_only
  scale_min: 0.95
  scale_max: 1.0

performance:
  num_workers: 0                    # 0 = safest, 4 = faster
  pin_memory: false
  prefetch_factor: 2
  persistent_workers: false

subset:
  max_train_samples: 0              # 0 = all, >0 = cap for fast pilots
  max_val_samples: 0

image_cache:
  enabled: true
  cache_dir: ml/artifacts/image_cache
  precache: true

metrics:
  decision_threshold: 0.5           # binary: classification threshold
  threshold_sweep: false            # evaluate at multiple thresholds
  threshold_sweep_start: 0.1
  threshold_sweep_end: 0.9
  threshold_sweep_step: 0.1
```

---

## 7. Evaluation metrics

### Binary classification

| Metric | What it tells you |
|--------|------------------|
| F1 | Harmonic mean of precision and recall. Single summary number. |
| Precision | Of everything the model called "great," what fraction actually was? |
| Recall | Of all actual great sunsets, what fraction did the model catch? |
| AUC | Area under the ROC curve. Threshold-independent ranking quality. |
| Balanced accuracy | Average of per-class accuracies. Handles imbalance better than raw accuracy. |
| Confusion matrix | Raw counts: TP, TN, FP, FN. |

For the "archive great sunsets" use case, **recall > 0.80** is the primary
target. Missing a great sunset (FN) is worse than capturing a mediocre
one (FP).

### Regression

| Metric | What it tells you |
|--------|------------------|
| MAE | Average absolute error in quality score. Target: < 0.15. |
| RMSE | Root mean squared error. Penalizes large errors more. |
| R² | Fraction of variance explained. 0.0 = useless, 1.0 = perfect. Target: > 0.70. |
| Pearson r | Linear correlation between predicted and actual. |
| Spearman r | Rank correlation. Does the model rank sunsets in the right order? |
| Threshold sweep | Derived binary metrics at multiple thresholds on the regression output. |

### How to read an eval report

Reports are at `<run_dir>/eval/eval_report.json`. Key fields:

```json
{
  "target_type": "regression",
  "num_samples": 500,
  "mae": 0.13,
  "rmse": 0.18,
  "r2": 0.74,
  "pearson_r": 0.86,
  "spearman_r": 0.83,
  "threshold_sweep": [
    {"threshold": 0.5, "f1": 0.81, "recall": 0.88, "precision": 0.75},
    {"threshold": 0.7, "f1": 0.79, "recall": 0.72, "precision": 0.87}
  ]
}
```

For regression, also check `eval/predictions.csv` to see individual
predictions, and generate a scatter plot via `plot_diagnostics.py`.

---

## 8. Label merge strategies

When LLM ratings are available alongside human ratings, the export
pipeline supports several merge strategies via `--label-merge-strategy`:

| Strategy | Behavior |
|----------|----------|
| `human_only` | Use human `calculated_rating` only. Default, backwards-compatible. |
| `llm_only` | Use LLM `llm_quality` for all images with LLM ratings. |
| `human_override` | Use human rating where available (3+ raters), LLM otherwise. |
| `weighted_average` | Blend: `llm_weight * llm + (1-llm_weight) * human`. Default weight: 0.7. |

These are set in the YAML config under `data.label_merge_strategy`.

---

## 9. ONNX export and deployment

### Export from an experiment run (recommended)

```bash
# Binary model
python ml/export_onnx_versioned.py \
  --run-dir ml/artifacts/experiments/<binary_run_dir> \
  --target-type binary \
  --model-name resnet18

# Regression model
python ml/export_onnx_versioned.py \
  --run-dir ml/artifacts/experiments/<regression_run_dir> \
  --target-type regression \
  --model-name resnet18
```

Outputs:

- `ml/artifacts/models/binary_resnet18/<version_tag>/model.onnx`
- `ml/artifacts/models/regression_resnet18/<version_tag>/model.onnx`

The script prints the env var values you need for production.

### Production env vars

```bash
AI_SCORING_MODE=onnx
AI_ONNX_BINARY_MODEL_PATH=ml/artifacts/models/binary_resnet18/<version_tag>/model.onnx
AI_ONNX_REGRESSION_MODEL_PATH=ml/artifacts/models/regression_resnet18/<version_tag>/model.onnx
AI_BINARY_MODEL_VERSION=<version_tag>
AI_REGRESSION_MODEL_VERSION=<version_tag>
```

If ONNX cannot load, the scorer falls back to baseline mode.

---

## 10. Speed tuning playbook

Use this order to iterate quickly while keeping final results reliable:

1. **Pilot run** (`epochs: 3`) for config sanity and rough ranking
2. **Shortlist** 1-2 candidate configs
3. **Full run** (`epochs: 10-30`) for final comparison
4. **Compare** only full runs for conclusions

```bash
# Pilot (fast iteration)
python ml/run_training.py --config ml/configs/v2_mild_crop_balanced_pilot.yaml

# Full run (final metric comparison)
python ml/run_training.py --config ml/configs/v2_mild_crop_balanced.yaml
```

Performance settings for faster runs:

```yaml
performance:
  num_workers: 4       # parallel data loading
  pin_memory: true     # helps with CUDA
  prefetch_factor: 2
  persistent_workers: true

image_cache:
  enabled: true        # avoid repeated URL downloads
  cache_dir: ml/artifacts/image_cache
  precache: true       # download all images before training starts
```

`subset.max_train_samples` and `subset.max_val_samples` can cap data
for ultra-fast pilots.

---

## 11. Recommended operating sequence

For someone starting from scratch or iterating on a new model version:

```bash
# 0. Environment
python3 -m venv .venv && source .venv/bin/activate
pip install -r ml/requirements.txt

# 1. Run database migrations (once)
psql $DATABASE_URL -f database/migrations/20260417_external_images.sql
psql $DATABASE_URL -f database/migrations/20260417_add_llm_quality_to_snapshots.sql

# 2. Dry-run the LLM rater
python3 ml/llm_rater.py --provider gemini --source webcam --dry-run

# 3. Rate the full webcam archive
python3 ml/llm_rater.py \
  --provider gemini --source webcam \
  --output-csv ml/artifacts/llm_ratings/initial_ratings.csv \
  --write-to-db

# 4. Rate Flickr images (if scraper has been run)
python3 ml/llm_rater.py \
  --provider gemini --source external \
  --output-csv ml/artifacts/llm_ratings/external_ratings.csv \
  --write-to-db

# 5. Validate LLM ratings (gate: Pearson > 0.80)
python3 ml/validate_llm_ratings.py \
  --ratings-csv ml/artifacts/llm_ratings/initial_ratings.csv

# 6. Train with LLM labels (webcam only)
python3 ml/run_experiment.py \
  --config ml/configs/v3_regression_llm_labels.yaml

# 7. Train with LLM labels + Flickr external data
python3 ml/run_experiment.py \
  --config ml/configs/v3_regression_llm_with_external.yaml

# 8. Compare webcam-only vs webcam+flickr
python3 ml/compare_experiments.py \
  --run-dirs \
    ml/artifacts/experiments/<webcam_only_run> \
    ml/artifacts/experiments/<with_external_run>

# 9. Export best model to ONNX
python3 ml/export_onnx_versioned.py \
  --run-dir ml/artifacts/experiments/<best_run> \
  --target-type regression \
  --model-name resnet18
```

---

## 12. Known issues and constraints

### Production scoring mismatch

The deployed ONNX model in `aiScoring.ts` currently feeds a metadata
feature vector, not a 224x224 image tensor. Models trained on images will
not produce correct scores in production until that runtime path is
updated (Phase 4 of the LLM Teacher plan).

### Domain shift (Flickr vs webcam)

Flickr photos are high-resolution, intentionally composed, often
post-processed. Webcam snapshots are low-res, fixed-angle, auto-exposure.
Mitigations:

- Track `source` column in manifests. Evaluate metrics per source.
- Consider augmenting Flickr images to simulate webcam quality.
- Weight webcam examples higher in loss if Flickr-trained model
  underperforms on webcam test data.

### Class imbalance

Current webcam data: 80% negative, 20% positive (4.1:1 ratio). Use
`class_weighting: balanced` for binary runs. For regression with LLM
labels, imbalance is less of an issue since the target is continuous.

### Small validation set

723 images in the current val split. Loss curves will bounce. Interpret
trends, not individual epoch values. Early stopping with patience 4-5
smooths this out.

---

## 13. Artifact locations

| What | Where |
|------|-------|
| Experiment runs | `ml/artifacts/experiments/<timestamp>_<name>/` |
| Dataset manifests | `ml/artifacts/datasets/` |
| Model checkpoints | `ml/artifacts/models/` |
| ONNX models | `ml/artifacts/models/<type>_<arch>/<version>/model.onnx` |
| Comparison reports | `ml/artifacts/reports/` |
| Diagnostic plots | `<run_dir>/plots/` |
| LLM ratings | `ml/artifacts/llm_ratings/` |
| Scraper run logs | `ml/artifacts/scraper_runs/` |
| Image cache | `ml/artifacts/image_cache/` |
| Experiment configs | `ml/configs/` |

---

## 14. Glossary

| Term | Meaning |
|------|---------|
| **manifest** | CSV file listing images with their labels, splits, and metadata. The input to `train.py`. |
| **target_type** | `binary` (is it a great sunset? 0 or 1) or `regression` (how great? 0.0-1.0). |
| **label_source** | Where labels come from: `manual_only` (human ratings), `public_aggregate` (crowd), or LLM ratings via CSV. |
| **split** | Train/val/test partition. Deterministic by `webcam_id` to prevent data leakage. |
| **checkpoint** | Saved model weights (`best.pt`). Captured at the epoch with the best validation metric. |
| **early stopping** | Stop training when val loss hasn't improved for N consecutive epochs. Prevents overfitting. |
| **cosine LR** | Learning rate starts at the configured value and decays smoothly to near-zero over the training run. |
| **head dropout** | Random dropout on the classifier head during training. Slows memorization. |
| **class weighting** | Upweights underrepresented classes in the loss function so the model pays attention to rare examples. |
| **threshold sweep** | Evaluates the model at multiple decision thresholds to find the best precision/recall trade-off. |
| **ONNX** | Open format for deploying ML models. Used in production (`aiScoring.ts`). |
| **LLM rater** | Vision LLM that assigns continuous 0.0-1.0 quality scores to sunset images. Replaces noisy human labels. |
| **domain shift** | Difference between Flickr photos (high quality, composed) and webcam stills (low quality, fixed angle). |
