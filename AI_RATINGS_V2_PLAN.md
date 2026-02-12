# AI Ratings V2 Plan

## Goal

Evolve from baseline AI scoring infrastructure to a reproducible ONNX model lifecycle using public/manual snapshot ratings as training labels.

## V2 Stack Decision

Use `PyTorch + torchvision + ONNX export` for V2 model training and deployment.

Why this stack for this project:
- strong CV transfer-learning ecosystem
- straightforward local training on a laptop/GPU
- predictable ONNX export path for local cron inference
- clear separation between training code (Python) and runtime scoring (Next.js/Node)

## Phase 1: Training Provenance Tables

Add two tables to track exactly which labels were used for each trained model:

- `model_training_runs`
  - `id`
  - `model_version` (unique)
  - `trained_at`
  - `params_json` (hyperparameters/config)
  - `notes`
- `model_training_snapshot_labels`
  - `id`
  - `training_run_id` (FK)
  - `snapshot_id` (FK)
  - `label_source` (`calculated_rating`, `manual_seed`, etc.)
  - `label_value`
  - `included_at`
  - unique `(training_run_id, snapshot_id)`

## Phase 2: Dataset Export Workflow

Build a deterministic dataset export script (Python) with the following outputs:

- Input tables:
  - `webcam_snapshots`
  - `webcam_snapshot_ratings`
- Output artifact files:
  - `manifest_full.csv` (all candidate samples)
  - `manifest_train.csv`
  - `manifest_val.csv`
  - `manifest_test.csv`
- Required manifest columns:
  - `snapshot_id`
  - `firebase_url` or local cached image path
  - `label_source`
  - `label_value`
  - `split` (`train`, `val`, `test`)
  - optional metadata: `phase`, `captured_at`, `rating_count`

Label strategy for V2:
- primary label: `webcam_snapshots.calculated_rating`
- optional binary target derived in export:
  - `is_good = (calculated_rating >= 4.0)`

Data quality gates in export:
- exclude rows with missing/invalid image URL
- exclude rows with insufficient label confidence (configurable; e.g. rating_count < 2)
- deduplicate by `snapshot_id`

Persist provenance:
- store dataset artifact path/hash and export parameters in `model_training_runs.params_json`
- insert each selected `(training_run_id, snapshot_id, label_source, label_value)` into `model_training_snapshot_labels`

## Phase 3: ONNX Training Lifecycle

### Minimum Viable Training Pipeline (PyTorch -> ONNX)

1. **Create training workspace**
   - Add `ml/` folder in repo with:
     - `ml/train.py`
     - `ml/export_dataset.py`
     - `ml/evaluate.py`
     - `ml/export_onnx.py`
     - `ml/requirements.txt`
     - `ml/configs/v2_baseline.yaml`

2. **Export dataset manifest**
   - Run `export_dataset.py` to query DB and emit train/val/test manifests.
   - Freeze split assignment with a fixed random seed for reproducibility.

3. **Download/cache images locally**
   - Build a local image cache directory from manifest URLs.
   - Log failed downloads and drop those rows from the active manifest.

4. **Define baseline model**
   - Start with transfer learning using a small torchvision backbone (e.g. `resnet18` or `mobilenet_v3_small`).
   - Replace final head for chosen target:
     - binary classification (`is_good`) or
     - regression (`0-5` score).

5. **Train baseline**
   - Use train split with augmentations (light crop/flip/color jitter).
   - Validate each epoch on val split.
   - Save best checkpoint by validation metric.

6. **Evaluate before export**
   - Run `evaluate.py` on test split.
   - Record metrics:
     - classification: AUC/F1/precision-recall
     - regression: MAE/RMSE + bucket calibration

7. **Export to ONNX**
   - Export best checkpoint to `model.onnx` with fixed input shape.
   - Verify exported model loads and runs with `onnxruntime` on sample tensors.

8. **Calibrate runtime score mapping**
   - Define mapping from raw output to app score (`0-5`) and store in config.
   - Define model-specific threshold policy (initial default: `>= 4.0`).

9. **Version and register release**
   - Assign immutable model version (e.g. `sunset_v2_2026_02_12`).
   - Save artifact metadata (path/hash/config) in `model_training_runs`.
   - Set app runtime env/config:
     - `AI_MODEL_VERSION=<version>`
     - threshold policy for capture gate.

10. **Run integration smoke test**
   - Swap scorer implementation in `app/api/cron/update-windy/lib/aiScoring.ts`.
   - Validate one end-to-end cron run:
     - webcam AI fields update
     - inference rows write
     - capture gate behavior matches threshold.

### Phase 3 Definition of Done
- ONNX artifact exists and passes local runtime check.
- Model version + training metadata are stored.
- Cron integration works with the new model interface and no runtime failures.

## Phase 4: Inference Integration Upgrade

- Replace baseline scorer in `app/api/cron/update-windy/lib/aiScoring.ts`.
- Keep existing scorer interface:
  - output `rawScore`, `aiRating`, `modelVersion`.
- Continue writing:
  - latest webcam score (`webcams.ai_rating`, `webcams.ai_model_version`)
  - inference history (`snapshot_ai_inferences`).

## Phase 5: Evaluation Loop

### Ongoing Evaluation Loop

- Compare model predictions to human labels each cycle:
  - calibration vs `calculated_rating`
  - disagreement rate (`abs(ai_rating - calculated_rating)`) by:
    - `phase` (sunrise/sunset)
    - time buckets
    - webcam region/source
- Create a disagreement review set:
  - top N largest disagreements
  - random sample near threshold boundary (3.7-4.3)
- Manually review and prioritize high-value relabeling.
- Feed reviewed samples back into next training run via dataset export.
- Track metrics by `model_version` to verify improvement, not just change.

### Phase 5 Definition of Done (per cycle)
- Evaluation report generated for current model version.
- Disagreement review set produced and triaged.
- Next-run training backlog prepared from reviewed samples.
