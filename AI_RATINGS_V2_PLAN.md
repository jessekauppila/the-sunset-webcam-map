# AI Ratings V2 Plan

## Goal

Evolve from baseline AI scoring infrastructure to a reproducible ONNX model lifecycle using public/manual snapshot ratings as training labels.

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

- Build a script to export labeled snapshots from:
  - `webcam_snapshots`
  - `webcam_snapshot_ratings`
- Save dataset manifests (CSV/JSONL) with:
  - `snapshot_id`
  - image URL/path
  - label source/value
  - split (`train|val|test`)
- Store manifest artifact path/version in `model_training_runs`.

## Phase 3: ONNX Training Lifecycle

- Train model externally (Python project) and export `.onnx`.
- Version model artifacts with immutable IDs.
- Register released model in app config:
  - `AI_MODEL_VERSION`
  - threshold policy for storing snapshots.

## Phase 4: Inference Integration Upgrade

- Replace baseline scorer in `app/api/cron/update-windy/lib/aiScoring.ts`.
- Keep existing scorer interface:
  - output `rawScore`, `aiRating`, `modelVersion`.
- Continue writing:
  - latest webcam score (`webcams.ai_rating`, `webcams.ai_model_version`)
  - inference history (`snapshot_ai_inferences`).

## Phase 5: Evaluation Loop

- Compare model predictions to public ratings:
  - calibration vs `calculated_rating`
  - disagreement rate by phase/time
- Use disagreement samples to prioritize manual review and next training run.
