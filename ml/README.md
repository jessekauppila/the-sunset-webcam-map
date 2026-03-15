# ML Runbook (Manual First, Public Ready)

This directory contains the V2 model workflow:

- export dataset manifests with deterministic splits
- train/evaluate PyTorch models
- export ONNX artifacts
- generate disagreement reports

## Code map

- `ml/export_dataset.py`: build deterministic manifests from DB labels
- `ml/train.py`: train transfer-learning baseline and save best checkpoint
- `ml/evaluate.py`: evaluate checkpoint on frozen test split
- `ml/export_onnx.py`: export checkpoint to ONNX + smoke test with onnxruntime
- `ml/export_onnx_versioned.py`: export ONNX into versioned artifact folders from run directories
- `ml/report_disagreements.py`: compare AI predictions vs human labels
- `ml/run_experiment.py`: single-entrypoint config-driven export/train/eval runner
- `ml/run_training.py`: convenience launcher that resolves `DATABASE_URL` and runs experiments
- `ml/compare_experiments.py`: aggregate multiple experiment runs into comparison reports
- `ml/common/splits.py`: deterministic webcam-group split logic
- `ml/common/labels.py`: binary/regression label mapping rules
- `ml/common/io.py`: shared artifact I/O helpers

## 1) Environment setup

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r ml/requirements.txt
or
python -m pip install --upgrade pip
python -m pip install -r ml/requirements.txt

```

`DATABASE_URL` must be available in your shell for export/report scripts.

## Database credentials for ML exports

`ml/run_experiment.py` starts with `ml/export_dataset.py`, which requires `DATABASE_URL`.
If this variable is missing, the run fails before training starts.

### Quick setup for current terminal session

```bash
source .venv/bin/activate
python ml/run_training.py --config ml/configs/v2_baseline.yaml
```

`ml/run_training.py` loads `DATABASE_URL` in this order:

1. `--database-url` argument (if provided)
2. existing `DATABASE_URL` in shell
3. `DATABASE_URL` entry in `.env.local` (or `--env-file`)

This avoids shell `source` issues and works even if `.env.local` contains spacing around `=`.

### Optional explicit DB override

```bash
python ml/run_training.py \
  --config ml/configs/v2_baseline.yaml \
  --database-url 'postgresql://USER:PASSWORD@HOST:PORT/DBNAME'
```

### Optional custom env file path

```bash
python ml/run_training.py \
  --config ml/configs/v2_baseline.yaml \
  --env-file /path/to/local.env
```

### Where to find USER/PASSWORD/HOST/PORT/DBNAME

- Open your managed Postgres provider dashboard (this project docs reference Neon).
- Open the database connection details page.
- Copy the connection string values into `DATABASE_URL`.

For this repo, `.env*` files are ignored by git, so keep credentials there and do not commit secrets.

Torch stack note:

- This repo currently pins `torch==2.2.2` and `torchvision==0.17.2`
  in `ml/requirements.txt` for local compatibility.

## Unified experiment workflow (recommended)

For reproducible ML experiments, use one config file per run and a single runner command.

### Why this is the preferred workflow

- one source of truth for data/model/metrics/transforms
- fair A/B comparisons (only one changed variable at a time)
- complete artifact logging for reporting and reproducibility
- easier iteration on professor-style suggestions

### Config location and templates

- baseline config: `ml/configs/v2_baseline.yaml`
- no-crop A/B config: `ml/configs/v2_no_crop_ab.yaml`
- mild-crop + balanced weighting: `ml/configs/v2_mild_crop_balanced.yaml`
- no-crop + balanced weighting: `ml/configs/v2_no_crop_balanced.yaml`
- mild-crop + balanced weighting pilot (`epochs: 3`): `ml/configs/v2_mild_crop_balanced_pilot.yaml`
- no-crop + balanced weighting pilot (`epochs: 3`): `ml/configs/v2_no_crop_balanced_pilot.yaml`

### Run one experiment from one config

```bash
python ml/run_experiment.py --config ml/configs/v2_baseline.yaml
```

Outputs are stored in:

- `ml/artifacts/experiments/<timestamp>_<run_name>/`

Each run folder includes:

- `config.input.yaml`
- `config.resolved.json`
- `run_manifest.json`
- `dataset/export_meta.json`
- `train/train_summary.json`
- `eval/eval_report.json`

### Compare multiple experiments

```bash
python ml/compare_experiments.py \
  --run-dirs \
    ml/artifacts/experiments/<run_a> \
    ml/artifacts/experiments/<run_b>
```

This writes:

- `ml/artifacts/reports/experiment_compare.json`
- `ml/artifacts/reports/experiment_compare.csv`

## Config schema reference (single run)

Top-level config sections:

- `run`: run name, seed, notes, tags
- `data`: label source, target type, thresholds, split settings
- `model`: model architecture and optimization hyperparameters
- `imbalance`: class weighting and optional weighted sampler controls
- `augmentation`: profile selection (`off`, `light`, `medium`)
- `cropping`: strategy (`random_resized`, `center`, `resize_only`) and crop scales
- `performance`: DataLoader throughput settings (`num_workers`, `pin_memory`, `prefetch_factor`, `persistent_workers`)
- `subset`: optional fast-iteration sample caps (`max_train_samples`, `max_val_samples`)
- `image_cache`: optional local cache for URL-based images
- `metrics`: decision threshold and optional threshold sweep settings

## Speed tuning playbook

Use this order to iterate quickly while keeping final results reliable:

1. pilot run (`epochs: 3`) for config sanity and rough ranking.
2. shortlist 1-2 candidate configs.
3. full run (`epochs: 10`) for final comparison.
4. compare only full runs for conclusions.

### Pilot vs full run examples

```bash
# Pilot (fast iteration)
python ml/run_training.py --config ml/configs/v2_mild_crop_balanced_pilot.yaml

# Full run (final metric comparison)
python ml/run_training.py --config ml/configs/v2_mild_crop_balanced.yaml
```

### Where to set `model.epochs: 3`

In your experiment YAML under `model`:

```yaml
model:
  name: resnet18
  epochs: 3
  batch_size: 32
  learning_rate: 0.0001
```

### Performance settings in config

```yaml
performance:
  num_workers: 4
  pin_memory: true
  prefetch_factor: 2
  persistent_workers: true

subset:
  max_train_samples: 0
  max_val_samples: 0

image_cache:
  enabled: true
  cache_dir: ml/artifacts/image_cache
  precache: true
```

Notes:
- `num_workers: 0` is safest default but slower.
- `pin_memory: true` usually helps when CUDA is used.
- `subset.max_*` values > 0 enable quick pilot subsets.
- `image_cache.enabled: true` avoids repeated URL downloads.

## How to include more data

The exporter queries DB rows each run, so new labeled snapshots are picked up automatically.
The data filters are controlled by config under `data`:

- `label_source` (`manual_only` or `public_aggregate`)
- `min_rating_count` (minimum number of ratings per snapshot)
- `binary_threshold` (for binary target mapping)

If you added ~4000 more labeled snapshots, rerun experiments with updated `min_rating_count` if needed.
Example defaults for broader inclusion use `min_rating_count: 1`.

## How to use weighting when you do not know class counts

Use automatic balancing first:

- set `imbalance.class_weighting: balanced`
- keep `imbalance.sampler: none` initially

This computes loss weights from train split counts automatically at train time.

After a run, check:

- `.../dataset/<timestamp>/export_meta.json` -> `target_distribution.train`
- `.../train/train_summary.json` -> `train_class_counts` and `effective_class_weights`

These files tell you both the class counts and the exact weights applied.

If you later want fixed manual weights:

- set `imbalance.class_weighting: manual`
- set `imbalance.manual_weights.neg` and `imbalance.manual_weights.pos` to numeric values

### Professor-suggestion mapping

- **Loss function weighting**
  - config: `imbalance.class_weighting`
  - options: `none`, `balanced`, `manual`
  - manual values: `imbalance.manual_weights.neg`, `imbalance.manual_weights.pos`
- **Machine learning measuring performance**
  - config: `metrics.*`
  - binary reports include precision/recall/F1/AUC, confusion, balanced accuracy
  - threshold sweep supported for threshold sensitivity analysis
- **Unbalanced data/classes**
  - config: `imbalance.class_weighting`, `imbalance.sampler`
  - dataset export metadata includes per-split target distribution
- **Augmentation**
  - config: `augmentation.profile` (`off|light|medium`)
- **Cropping**
  - config: `cropping.strategy` and crop scale bounds
  - no-crop policy uses `strategy: resize_only`

## No-crop A/B experiment guide

Goal: test whether random cropping is harming sunset-signal learning.

1. Run baseline (A):

```bash
python ml/run_experiment.py --config ml/configs/v2_baseline.yaml
```

2. Run no-crop variant (B):

```bash
python ml/run_experiment.py --config ml/configs/v2_no_crop_ab.yaml
```

3. Compare both runs:

```bash
python ml/compare_experiments.py \
  --run-dirs \
    ml/artifacts/experiments/<baseline_run_dir> \
    ml/artifacts/experiments/<no_crop_run_dir>
```

Interpretation guidance for binary target:

- prioritize `f1`, `recall`, `balanced_accuracy`, and `fn` count
- if no-crop reduces false negatives and improves recall/F1 consistently, prefer no-crop
- run multiple seeds for stronger conclusions before locking the default

## Mild-crop vs no-crop (balanced) quick run

```bash
python ml/run_training.py --config ml/configs/v2_mild_crop_balanced.yaml
python ml/run_training.py --config ml/configs/v2_no_crop_balanced.yaml
python ml/compare_experiments.py --run-dirs \
  ml/artifacts/experiments/<mild_crop_run_dir> \
  ml/artifacts/experiments/<no_crop_run_dir>
```

Read these for decisions:

- `ml/artifacts/reports/experiment_compare.json` / `.csv`
- per-run `eval/eval_report.json` (F1, recall, confusion, threshold sweep)
- per-run `dataset/.../export_meta.json` (class mix in train/val/test)

Also inspect speed/debug fields in `train/train_summary.json`:

- `num_workers`, `pin_memory`, `prefetch_factor`, `persistent_workers`
- `max_train_samples`, `max_val_samples`
- `cache_state_before_train`, `cache_state_after_train`, `cache_warmup_train`
- `total_runtime_sec`, `epoch_times_sec`

## 2) Export dataset manifests (manual-only default)

What this step does:

- reads labeled snapshot rows from Postgres (`DATABASE_URL`)
- maps each rating to the training target (`binary` or `regression`)
- assigns deterministic train/val/test split by `webcam_id` (prevents leakage)
- writes timestamped manifests used by training/evaluation

```bash
python ml/export_dataset.py \
  --label-source manual_only \
  --target-type binary \
  --seed 20260212 \
  --min-rating-count 2
```

This writes:

- `manifest_full.csv`
- `manifest_train.csv`
- `manifest_val.csv`
- `manifest_test.csv`

under a timestamped folder in `ml/artifacts/datasets/`.

To include public labels later:

```bash
python ml/export_dataset.py \
  --label-source public_aggregate \
  --target-type binary \
  --min-rating-count 3
```

## 3) Train model

What this step does:

- loads images from manifest rows (`image_path_or_url`), from local paths or URLs
- initializes transfer-learning backbone (default `resnet18`)
- trains for N epochs on train split and validates each epoch on val split
- saves the best checkpoint (`best.pt`) based on validation metric
- writes run history/metrics to `train_summary.json`

```bash
python ml/train.py \
  --train-manifest ml/artifacts/datasets/<run>/manifest_train.csv \
  --val-manifest ml/artifacts/datasets/<run>/manifest_val.csv \
  --target-type binary \
  --model-name resnet18
```

Outputs:

- `ml/artifacts/models/best.pt`
- `ml/artifacts/models/train_summary.json`

## 4) Evaluate model on test split

What this step does:

- loads the saved checkpoint (`best.pt`)
- runs inference on the frozen test split (`manifest_test.csv`)
- computes task metrics (binary: precision/recall/F1/AUC, regression: MAE/RMSE)
- writes report artifact to `ml/artifacts/reports/eval_report.json`

```bash
python ml/evaluate.py \
  --test-manifest ml/artifacts/datasets/<run>/manifest_test.csv \
  --checkpoint ml/artifacts/models/best.pt \
  --target-type binary \
  --model-name resnet18 \
  --decision-threshold 0.5
```

Output:

- `ml/artifacts/reports/eval_report.json`

## 5) Export ONNX and verify locally

Recommended: use versioned ONNX paths (do not overwrite `model.onnx` every run).

### Versioned export from experiment runs (recommended)

Binary:

```bash
python ml/export_onnx_versioned.py \
  --run-dir ml/artifacts/experiments/<binary_run_dir> \
  --target-type binary \
  --model-name resnet18
```

Regression:

```bash
python ml/export_onnx_versioned.py \
  --run-dir ml/artifacts/experiments/<regression_run_dir> \
  --target-type regression \
  --model-name resnet18
```

This writes artifacts under:

- `ml/artifacts/models/binary_resnet18/<version_tag>/model.onnx`
- `ml/artifacts/models/regression_resnet18/<version_tag>/model.onnx`

By default, `<version_tag>` is the run folder name (timestamp + run name), which
keeps naming consistent with experiment artifacts and supports easy rollback.

After each command, the script prints `env_hint` values for `AI_ONNX_*_MODEL_PATH`
and `AI_*_MODEL_VERSION`.

If you trained via `run_training.py`/`run_experiment.py`, export from the
experiment checkpoint path:

```bash
python ml/export_onnx.py \
  --checkpoint ml/artifacts/experiments/<run_dir>/train/best.pt \
  --target-type binary \
  --model-name resnet18 \
  --output ml/artifacts/models/binary_resnet18/model.onnx
```

For regression, use a regression run checkpoint:

```bash
python ml/export_onnx.py \
  --checkpoint ml/artifacts/experiments/<regression_run_dir>/train/best.pt \
  --target-type regression \
  --model-name resnet18 \
  --output ml/artifacts/models/regression_resnet18/model.onnx
```

Note: binary and regression require separate trained checkpoints.

```bash
python ml/export_onnx.py \
  --checkpoint ml/artifacts/models/best.pt \
  --target-type binary \
  --model-name resnet18 \
  --output ml/artifacts/models/model.onnx
```

Outputs:

- `ml/artifacts/models/model.onnx`
- `ml/artifacts/models/model.meta.json`

For dual-model runtime (binary + regression), export both:

```bash
python ml/export_onnx.py \
  --checkpoint ml/artifacts/models/best.pt \
  --target-type binary \
  --model-name resnet18 \
  --output ml/artifacts/models/binary_resnet18/model.onnx

python ml/export_onnx.py \
  --checkpoint ml/artifacts/models/regression_resnet18/best.pt \
  --target-type regression \
  --model-name resnet18 \
  --output ml/artifacts/models/regression_resnet18/model.onnx
```

Recommended dual export flow after experiment runs:

```bash
python ml/export_onnx.py \
  --checkpoint ml/artifacts/experiments/<binary_run_dir>/train/best.pt \
  --target-type binary \
  --model-name resnet18 \
  --output ml/artifacts/models/binary_resnet18/model.onnx

python ml/export_onnx.py \
  --checkpoint ml/artifacts/experiments/<regression_run_dir>/train/best.pt \
  --target-type regression \
  --model-name resnet18 \
  --output ml/artifacts/models/regression_resnet18/model.onnx
```

Versioned dual export (preferred):

```bash
python ml/export_onnx_versioned.py \
  --run-dir ml/artifacts/experiments/<binary_run_dir> \
  --target-type binary \
  --model-name resnet18

python ml/export_onnx_versioned.py \
  --run-dir ml/artifacts/experiments/<regression_run_dir> \
  --target-type regression \
  --model-name resnet18
```

## 6) Runtime integration notes

App scorer keeps stable output contract:

- `rawScore`
- `aiRating`
- `modelVersion`

Runtime env vars:

- `AI_SCORING_MODE=baseline|onnx`
- `AI_MODEL_VERSION=<version>`
- `AI_ONNX_MODEL_PATH=<absolute-or-workspace-relative-path>`
- `AI_BINARY_MODEL_VERSION=<version>`
- `AI_REGRESSION_MODEL_VERSION=<version>`
- `AI_ONNX_BINARY_MODEL_PATH=<absolute-or-workspace-relative-path>`
- `AI_ONNX_REGRESSION_MODEL_PATH=<absolute-or-workspace-relative-path>`

Why version vars matter:

- binary and regression outputs are written separately to DB and inference history
- version strings label each model's output for audit/debug comparisons
- snapshot inference rows use `model_version` in their unique key, so stable/versioned names are required

Example dual-model env setup:

```bash
AI_SCORING_MODE=onnx
AI_ONNX_BINARY_MODEL_PATH=ml/artifacts/models/binary_resnet18/<version_tag>/model.onnx
AI_ONNX_REGRESSION_MODEL_PATH=ml/artifacts/models/regression_resnet18/<version_tag>/model.onnx
AI_BINARY_MODEL_VERSION=<version_tag>
AI_REGRESSION_MODEL_VERSION=<version_tag>
```

If ONNX cannot load, scorer falls back to baseline mode.

## 7) Disagreement reporting

```bash
python ml/report_disagreements.py \
  --model-version <version> \
  --limit 200
```

Output:

- `ml/artifacts/reports/disagreement_report.json`

Suggested next command sequence (to start using this)

1) Create Python env + install:

```bash
python3 -m venv .venv && source .venv/bin/activate && pip install -r ml/requirements.txt
```

2) Export dataset (manual-first):

```bash
python3 ml/export_dataset.py --label-source manual_only --target-type binary --seed 20260212 --min-rating-count 1
```

3) Train:

```bash
python ml/train.py --train-manifest <...>/manifest_train.csv --val-manifest <...>/manifest_val.csv --target-type binary --model-name resnet18
```

Example:

```bash
python ml/train.py \
  --train-manifest ml/artifacts/datasets/20260213_002518/manifest_train.csv \
  --val-manifest ml/artifacts/datasets/20260213_002518/manifest_val.csv \
  --target-type binary \
  --model-name resnet18

  python ml/train.py \
  --train-manifest ml/artifacts/datasets_regression/20260213_042144/manifest_train.csv \
  --val-manifest ml/artifacts/datasets_regression/20260213_042144/manifest_val.csv \
  --target-type regression \
  --model-name resnet18 \
  --output-dir ml/artifacts/models/regression_resnet18
```

4) Evaluate:

```bash
python ml/evaluate.py \
  --test-manifest ml/artifacts/datasets_regression/20260213_042144/manifest_test.csv \
  --checkpoint ml/artifacts/models/regression_resnet18/best.pt \
  --target-type regression \
  --model-name resnet18 \
  --output ml/artifacts/reports/eval_report_regression.json
```

Example:

```bash
python ml/evaluate.py \
  --test-manifest ml/artifacts/datasets/20260213_002518/manifest_test.csv \
  --checkpoint ml/artifacts/models/best.pt \
  --target-type binary \
  --model-name resnet18 \
  --decision-threshold 0.5
```

```bash
python ml/evaluate.py \
  --test-manifest ml/artifacts/datasets_regression/20260213_042144/manifest_test.csv \
  --checkpoint ml/artifacts/models/regression_resnet18/best.pt \
  --target-type regression \
  --model-name resnet18 \
  --output ml/artifacts/reports/eval_report_regression.json
```

5) Export ONNX:

```bash
python ml/export_onnx.py --checkpoint ml/artifacts/models/best.pt --target-type binary --model-name resnet18 --output ml/artifacts/models/model.onnx
```

Progress bars:

- `export_dataset.py`, `train.py`, `evaluate.py`, and `export_onnx.py` show progress bars by default
- pass `--no-progress` if you want quieter logs
