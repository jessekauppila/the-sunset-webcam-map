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
- `ml/report_disagreements.py`: compare AI predictions vs human labels
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

Torch stack note:

- This repo currently pins `torch==2.2.2` and `torchvision==0.17.2`
  in `ml/requirements.txt` for local compatibility.

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
AI_ONNX_BINARY_MODEL_PATH=ml/artifacts/models/binary_resnet18/model.onnx
AI_ONNX_REGRESSION_MODEL_PATH=ml/artifacts/models/regression_resnet18/model.onnx
AI_BINARY_MODEL_VERSION=binary-v1
AI_REGRESSION_MODEL_VERSION=regression-v1
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
