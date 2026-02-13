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

```bash
python ml/evaluate.py \
  --test-manifest ml/artifacts/datasets/<run>/manifest_test.csv \
  --checkpoint ml/artifacts/models/best.pt \
  --target-type binary \
  --model-name resnet18
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

## 6) Runtime integration notes

App scorer keeps stable output contract:

- `rawScore`
- `aiRating`
- `modelVersion`

Runtime env vars:

- `AI_SCORING_MODE=baseline|onnx`
- `AI_MODEL_VERSION=<version>`
- `AI_ONNX_MODEL_PATH=<absolute-or-workspace-relative-path>`

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

Create Python env + install:
python3 -m venv .venv && source .venv/bin/activate && pip install -r ml/requirements.txt

Export dataset (manual-first):
python3 ml/export_dataset.py --label-source manual_only --target-type binary --seed 20260212 --min-rating-count 1

Train:
python ml/train.py --train-manifest <...>/manifest_train.csv --val-manifest <...>/manifest_val.csv --target-type binary --model-name resnet18

Evaluate:
python ml/evaluate.py --test-manifest <...>/manifest_test.csv --checkpoint ml/artifacts/models/best.pt --target-type binary --model-name resnet18

Export ONNX:
python ml/export_onnx.py --checkpoint ml/artifacts/models/best.pt --target-type binary --model-name resnet18 --output ml/artifacts/models/model.onnx
