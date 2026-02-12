# AI Ratings V2 Plan (Manual First, Public Ready)

## Goal

Build a reproducible PyTorch to ONNX training workflow that starts with manually rated snapshots and can later include public ratings without redesigning the pipeline.

## V2 Stack Decision

Use `PyTorch + torchvision + ONNX export` for V2 model development and deployment.

Why this stack:
- strong computer vision ecosystem and community support
- practical transfer-learning workflow with limited data
- reliable ONNX export path for local cron inference
- clean separation between training code (Python) and runtime scoring (Next.js/Node)

## Can this support manual-only now and public later?

Yes.
- Stage 1 (now): train using only manually rated snapshots.
- Stage 2 (later): include public ratings.

The key is to keep a `label_source` field in dataset manifests and apply export filters:
- now: `label_source = manual_only`
- later: `label_source IN (manual_only, public_aggregate)`

## Why Phase 2 and Phase 3 both mention dataset export

- Phase 2 builds the export system and data contracts.
- Phase 3 runs that export each training cycle.

This is intentional: build the tool once, reuse every run.

## Plain-language glossary

- **Transfer learning**: start from a model pre-trained on general image data, then fine-tune it on your sunset dataset.
- **Final head**: the last model layer that maps learned features to your output target.
- **Binary classification**: predict `good` vs `not_good`.
- **Regression**: predict continuous score (for example, `0-5`).
- **Train split**: data used to fit model weights.
- **Validation split (val)**: data used during training to pick the best checkpoint and avoid overfitting.
- **Test split**: held-out data used only for final evaluation.
- **Augmentations**: small random transforms (crop/flip/color jitter) to improve robustness.
- **Epoch**: one full pass through the train split.
- **Checkpoint**: saved model state during training.
- **ONNX export**: convert trained model to portable `.onnx` for runtime inference.
- **Calibration**: map raw model output to meaningful app score semantics.

## Phase 1: Training provenance tables

Add two tables to make each model run auditable:

- `model_training_runs`
  - `id`
  - `model_version` (unique)
  - `trained_at`
  - `params_json` (seed, split rules, label filters, artifact hashes, etc.)
  - `notes`
- `model_training_snapshot_labels`
  - `id`
  - `training_run_id` (FK)
  - `snapshot_id` (FK)
  - `label_source`
  - `label_value`
  - `included_at`
  - unique `(training_run_id, snapshot_id)`

## Phase 2: Dataset export workflow

Build deterministic export script(s) in `ml/export_dataset.py`.

Input tables:
- `webcam_snapshots`
- `webcam_snapshot_ratings`

Required outputs:
- `manifest_full.csv`
- `manifest_train.csv`
- `manifest_val.csv`
- `manifest_test.csv`

Required manifest columns:
- `snapshot_id`
- `webcam_id`
- `image_path_or_url`
- `label_source`
- `label_value`
- `split` (`train|val|test`)
- optional: `phase`, `captured_at`, `rating_count`

Data quality gates:
- exclude rows with missing/broken image URL
- exclude low-confidence labels (for example `rating_count < 2` now, `>= 3` for public aggregate later)
- deduplicate by `snapshot_id`

Provenance persistence:
- write export parameters and artifact metadata to `model_training_runs.params_json`
- write selected labels to `model_training_snapshot_labels`

## Dataset splitting policy (deterministic and leakage-safe)

### Split ratios
- train: 70%
- val: 15%
- test: 15%

### Fixed seed
- use one fixed seed for split assignment (example: `20260212`)
- do not change seed unless intentionally creating a new benchmark generation

### Deterministic assignment
- assign split from stable IDs, not runtime randomness
- use group-level key `webcam_id` to avoid near-duplicate leakage
- hash rule:
  - `bucket = hash(webcam_id + seed) % 100`
  - `0-69 => train`, `70-84 => val`, `85-99 => test`

### Leakage guardrails
- same `webcam_id` must not appear in multiple splits
- keep test split frozen for fair version-to-version comparison
- append new samples using same seed/rule; do not reshuffle old data

### Test set governance
- test set is evaluation-only
- never use test for training, threshold tuning, augmentation tuning, or early stopping

## Phase 3: ONNX training lifecycle

### Minimum viable training pipeline (PyTorch -> ONNX, 10 steps)

1. **Create training workspace**
   - Add `ml/` folder:
     - `ml/export_dataset.py`
     - `ml/train.py`
     - `ml/evaluate.py`
     - `ml/export_onnx.py`
     - `ml/requirements.txt`
     - `ml/configs/v2_baseline.yaml`

2. **Export manifests**
   - Run `export_dataset.py` with fixed seed and selected `label_source`.
   - Save full/train/val/test manifests.

3. **Cache images locally**
   - Download image URLs to local cache.
   - Remove failed downloads from active manifests.

4. **Define baseline model**
   - Start with small pretrained backbone (`resnet18` or `mobilenet_v3_small`).
   - Replace final head for target:
     - binary (`is_good`) for v1
     - regression (`0-5`) later

5. **Train**
   - Train on train split with light augmentations.
   - Validate each epoch on val split.

6. **Select best checkpoint**
   - Save best checkpoint by validation metric.

7. **Evaluate on test split**
   - classification: AUC, F1, precision, recall
   - regression: MAE, RMSE, calibration buckets

8. **Export to ONNX**
   - Export best checkpoint to `model.onnx` using fixed input shape.
   - Verify with `onnxruntime` on sample tensors.

9. **Calibrate runtime mapping**
   - Define raw-output-to-app-score mapping (`0-5`).
   - Define model-specific capture threshold (initially `>= 4.0`).

10. **Version and register release**
   - Assign immutable version (example: `sunset_v2_2026_02_12`).
   - Persist model metadata in `model_training_runs`.
   - Configure runtime with selected model version and threshold policy.

### Phase 3 definition of done
- ONNX artifact exists and passes runtime smoke checks.
- Model version and training metadata are persisted.
- End-to-end cron inference succeeds with no runtime errors.

## Recommended first target (v1)

Start with binary `good/not_good`.

Why:
- easier to train and explain
- threshold behavior is straightforward
- lower label-volume requirement than regression

Move to regression later after label volume and quality are high enough.

## Phase 4: Inference integration upgrade

- Replace baseline logic in `app/api/cron/update-windy/lib/aiScoring.ts` with ONNX inference.
- Keep scorer contract stable:
  - `rawScore`
  - `aiRating`
  - `modelVersion`
- Continue writing:
  - webcam latest fields (`webcams.ai_rating`, `webcams.ai_model_version`)
  - inference history (`snapshot_ai_inferences`)

## Phase 5: Evaluation loop

Per cycle:
- compare AI predictions vs human labels (`calculated_rating`)
- measure disagreement: `abs(ai_rating - calculated_rating)`
- slice disagreement by phase/time/region/source
- review top disagreements + near-threshold samples (for example `3.7-4.3`)
- prioritize manual review and feed reviewed samples into next run

### Phase 5 definition of done
- evaluation report exists for current `model_version`
- disagreement review set is generated and triaged
- next training backlog is prepared

## Appendix: SQL + pseudocode (deterministic split export)

### SQL skeleton (candidate rows)

```sql
SELECT
  s.id AS snapshot_id,
  s.webcam_id,
  s.firebase_url AS image_path_or_url,
  s.phase,
  s.captured_at,
  s.calculated_rating AS label_value,
  COUNT(r.id)::int AS rating_count
FROM webcam_snapshots s
LEFT JOIN webcam_snapshot_ratings r
  ON r.snapshot_id = s.id
WHERE s.firebase_url IS NOT NULL
  AND s.calculated_rating IS NOT NULL
GROUP BY
  s.id, s.webcam_id, s.firebase_url, s.phase, s.captured_at, s.calculated_rating;
```

### SQL skeleton (manual-only, now)

```sql
SELECT
  s.id AS snapshot_id,
  s.webcam_id,
  s.firebase_url AS image_path_or_url,
  s.phase,
  s.captured_at,
  s.calculated_rating AS label_value,
  COUNT(r.id)::int AS rating_count,
  'manual_only'::text AS label_source
FROM webcam_snapshots s
LEFT JOIN webcam_snapshot_ratings r
  ON r.snapshot_id = s.id
WHERE s.firebase_url IS NOT NULL
  AND s.calculated_rating IS NOT NULL
GROUP BY
  s.id, s.webcam_id, s.firebase_url, s.phase, s.captured_at, s.calculated_rating;
```

### SQL skeleton (public aggregate, later)

```sql
SELECT
  s.id AS snapshot_id,
  s.webcam_id,
  s.firebase_url AS image_path_or_url,
  s.phase,
  s.captured_at,
  s.calculated_rating AS label_value,
  COUNT(r.id)::int AS rating_count,
  'public_aggregate'::text AS label_source
FROM webcam_snapshots s
JOIN webcam_snapshot_ratings r
  ON r.snapshot_id = s.id
WHERE s.firebase_url IS NOT NULL
  AND s.calculated_rating IS NOT NULL
GROUP BY
  s.id, s.webcam_id, s.firebase_url, s.phase, s.captured_at, s.calculated_rating
HAVING COUNT(r.id) >= 3;
```

### Pseudocode: deterministic split assignment

```python
SEED = 20260212

def stable_bucket(group_key: str, seed: int) -> int:
    h = sha256(f"{group_key}|{seed}".encode("utf-8")).hexdigest()
    return int(h[:8], 16) % 100

def assign_split(webcam_id: int) -> str:
    bucket = stable_bucket(str(webcam_id), SEED)
    if bucket < 70:
        return "train"
    elif bucket < 85:
        return "val"
    return "test"
```

### Pseudocode: export flow

```python
rows = query_candidate_rows_from_db()
manifest = []

for row in rows:
    if not row.image_path_or_url:
        continue
    if row.label_value is None:
        continue
    if row.rating_count is not None and row.rating_count < MIN_RATING_COUNT:
        continue

    split = assign_split(row.webcam_id)

    manifest.append({
        "snapshot_id": row.snapshot_id,
        "webcam_id": row.webcam_id,
        "label_source": row.label_source,
        "label_value": row.label_value,
        "split": split,
        "image_path_or_url": row.image_path_or_url,
        "phase": row.phase,
        "captured_at": row.captured_at,
        "rating_count": row.rating_count,
    })

write_csv("manifest_full.csv", manifest)
write_csv("manifest_train.csv", [r for r in manifest if r["split"] == "train"])
write_csv("manifest_val.csv", [r for r in manifest if r["split"] == "val"])
write_csv("manifest_test.csv", [r for r in manifest if r["split"] == "test"])

params_json = {
    "seed": SEED,
    "split_rule": "hash(webcam_id, seed) -> 70/15/15",
    "min_rating_count": MIN_RATING_COUNT,
    "label_sources": LABEL_SOURCES,
    "artifact_paths": [...],
}
persist_training_run_metadata(params_json)
```

### Binary vs regression export labels

```python
y_reg = label_value
y_bin = 1 if label_value >= 4.0 else 0
```
