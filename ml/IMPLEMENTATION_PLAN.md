# Implementation Plan: LLM Teacher + Continuous Regression Pipeline

Date: April 2026
Prereqs: Read DIAGNOSTICS_FINDINGS.md and LLM_TEACHER_AND_EXTERNAL_DATA_PLAN.md first.

This document is the step-by-step build plan an agent should follow to
implement the 4-phase architecture. Each step lists the exact files to
create or modify, what to change, and how to verify it works.

---

## Phase 1: LLM labels existing webcam archive

**Goal:** Run every existing webcam snapshot through a vision LLM to get a
consistent, continuous 0.0–1.0 sunset quality score. This replaces noisy
human integer ratings as the training target.

### Step 1.1 — Create `ml/llm_rater.py`

A standalone CLI script that:

1. Connects to Postgres (same `DATABASE_URL` pattern as `export_dataset.py`)
2. Queries all snapshots that have a `firebase_url` (the public image URL)
3. For each image, sends it to the LLM with a structured rating prompt
4. Writes results to a CSV and optionally back to the database

**Inputs:**
- `--database-url` or `DATABASE_URL` env var
- `--provider`: `gemini` (default) or `openai`
- `--model`: model name (default `gemini-2.0-flash` or `gpt-4o-mini`)
- `--api-key` or env var (`GEMINI_API_KEY` / `OPENAI_API_KEY`)
- `--output-csv`: path to write results (default `ml/artifacts/llm_ratings/ratings_<timestamp>.csv`)
- `--batch-size`: how many to process per run (default: all, for resumability)
- `--skip-rated`: if set, skip snapshots that already have an LLM rating in the output CSV (for resume)
- `--dry-run`: process 5 images and print results without writing

**LLM prompt** (send as system + user with image):

```
Analyze this webcam image and return a JSON object:

{
  "is_sunset": <boolean - is a sunset or sunrise visible?>,
  "quality": <float 0.0-1.0 - sunset quality rating>,
  "confidence": <float 0.0-1.0 - your confidence in this rating>,
  "has_clouds": <boolean - are dramatic clouds present?>,
  "color_palette": <string - brief description of dominant sky colors>,
  "obstruction": <string|null - "rain on lens", "fog", "building", or null>
}

Quality scale:
  0.00 = no sunset/sunrise visible at all
  0.10 = barely any color, mostly gray or dark
  0.30 = weak sunset, minimal color
  0.50 = decent sunset, some color in the sky
  0.70 = good sunset, vivid colors
  0.85 = great sunset, dramatic sky with rich colors
  0.95 = spectacular, once-in-a-lifetime sunset

Return ONLY the JSON object.
```

**Output CSV columns:**
```
snapshot_id, firebase_url, llm_quality, llm_is_sunset, llm_confidence,
llm_has_clouds, llm_color_palette, llm_obstruction, llm_model,
llm_provider, rated_at, human_calculated_rating
```

The `human_calculated_rating` column is included so we can compute
correlation between LLM and human ratings in the same file.

**Error handling:**
- Retry up to 3 times on API errors with exponential backoff
- Skip and log images that fail after retries (404, corrupt, etc.)
- Write a `_failures.csv` alongside the main output with snapshot_id and error

**Rate limiting:**
- Gemini: 15 RPM on free tier, 1000 RPM on paid. Add configurable `--rpm` flag.
- OpenAI: 500 RPM on tier 1. Same `--rpm` flag.
- Implement with a simple `time.sleep(60/rpm)` between calls.

**Dependencies to add to `ml/requirements.txt`:**
```
google-generativeai>=0.8
openai>=1.40
```

### Step 1.2 — Validation script: `ml/validate_llm_ratings.py`

Before trusting LLM labels for training, validate them against human
consensus. This script:

1. Loads the LLM ratings CSV
2. Filters to snapshots that have human `calculated_rating` with 3+ raters
   (high-confidence human labels)
3. Normalizes human ratings to 0.0–1.0 (divide by 5)
4. Computes:
   - Pearson correlation between LLM quality and normalized human rating
   - Spearman rank correlation
   - Mean absolute error
   - Agreement on binary threshold (LLM >= 0.7 vs human >= 0.8)
   - Scatter plot saved to `ml/artifacts/llm_ratings/validation_scatter.png`
5. Prints pass/fail: correlation > 0.80 = proceed, otherwise refine prompt

**Inputs:**
- `--ratings-csv`: path to LLM ratings CSV
- `--min-human-raters`: minimum rating_count for inclusion (default 3)
- `--output-dir`: where to save plots and report

### Step 1.3 — Run Phase 1

```bash
# Step 1: Rate all existing snapshots
python3 ml/llm_rater.py \
  --provider gemini \
  --model gemini-2.0-flash \
  --output-csv ml/artifacts/llm_ratings/initial_ratings.csv

# Step 2: Validate against human labels
python3 ml/validate_llm_ratings.py \
  --ratings-csv ml/artifacts/llm_ratings/initial_ratings.csv
```

**Success criteria:** Pearson correlation > 0.80 with human consensus.

---

## Phase 2: Train on continuous LLM labels

**Goal:** Retrain the model using continuous 0.0–1.0 LLM quality scores
as the regression target, with early stopping, LR decay, and dropout.

### Step 2.1 — Modify `ml/train.py`

Three changes, each small and isolated:

#### 2.1a — Add early stopping

Add `--early-stopping-patience` argument (default 0 = disabled). Track
best val loss. If val loss has not improved for `patience` consecutive
epochs, stop training and keep the best checkpoint.

Where to add it:
- New CLI arg in `parse_args()`
- In the epoch loop (after line 479 in current code), add patience counter
- When triggered, break out of the epoch loop and print a message

#### 2.1b — Add cosine LR schedule

Add `--lr-schedule` argument with choices `none` (default), `cosine`.
When `cosine`, wrap the optimizer with
`torch.optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=args.epochs)`.

Where to add it:
- New CLI arg in `parse_args()`
- After optimizer creation (line 392), create scheduler if requested
- At end of each epoch, call `scheduler.step()`
- Log current LR in the epoch history dict

#### 2.1c — Add dropout on classifier head

Add `--head-dropout` argument (float, default 0.0). When > 0, replace
the single `nn.Linear` head with `nn.Sequential(nn.Dropout(p), nn.Linear(...))`.

Where to add it:
- New CLI arg in `parse_args()`
- In `build_model()` (lines 155–168), wrap the final layer

### Step 2.2 — Modify `ml/export_dataset.py`

Add a new `--label-source llm` option that:

1. Reads the LLM ratings CSV instead of querying the database for human
   ratings
2. Uses the `llm_quality` column (already 0.0–1.0) as `label_value`
3. Still uses webcam-grouped splits (joins on `snapshot_id` → `webcam_id`
   from the database)
4. Sets `target_type` to `regression` automatically when `llm` source

Alternatively, add a simpler `--llm-ratings-csv` flag that overrides
`label_value` with LLM scores for matching snapshot_ids, keeping the
existing query for metadata.

### Step 2.3 — Modify `ml/run_experiment.py`

Wire the new train.py arguments through the experiment config YAML:

```yaml
# New fields in model section:
model:
  name: resnet18  # or efficientnet_b0 later
  epochs: 30
  batch_size: 32
  learning_rate: 0.0001
  lr_schedule: cosine        # NEW
  early_stopping_patience: 5 # NEW
  head_dropout: 0.3          # NEW
```

Add corresponding CLI args to the `train_cmd` list in `run_experiment.py`.

### Step 2.4 — Modify `ml/evaluate.py`

For regression mode, add:
- Pearson and Spearman correlation coefficients
- R-squared
- Per-bucket accuracy (how well does the model separate 0.0–0.3 vs
  0.3–0.6 vs 0.6–1.0?)
- Derived binary metrics at configurable thresholds (for the "should we
  capture this?" decision)

### Step 2.5 — Create new experiment config

`ml/configs/v3_regression_llm_labels.yaml`:

```yaml
run:
  name: v3_regression_llm_labels
  seed: 20260212
  notes: >
    First regression run using LLM-generated continuous labels.
    Includes early stopping, cosine LR decay, and head dropout.
  tags: [v3, regression, llm_labels, early_stopping, cosine_lr]

data:
  label_source: llm
  llm_ratings_csv: ml/artifacts/llm_ratings/initial_ratings.csv
  target_type: regression
  binary_threshold: 4.0   # only used if deriving binary post-hoc
  min_rating_count: 1
  splits:
    seed: 20260212
    train_pct: 70
    val_pct: 15
    test_pct: 15

model:
  name: resnet18
  epochs: 30
  batch_size: 32
  learning_rate: 0.0001
  lr_schedule: cosine
  early_stopping_patience: 5
  head_dropout: 0.3

imbalance:
  class_weighting: none   # not applicable for regression
  sampler: none

augmentation:
  profile: light

cropping:
  strategy: random_resized
  scale_min: 0.95
  scale_max: 1.0

performance:
  num_workers: 0
  pin_memory: false
  prefetch_factor: 2
  persistent_workers: false

subset:
  max_train_samples: 0
  max_val_samples: 0

image_cache:
  enabled: true
  cache_dir: ml/artifacts/image_cache
  precache: true

metrics:
  decision_threshold: 0.7
  threshold_sweep: true
  threshold_sweep_start: 0.3
  threshold_sweep_end: 0.9
  threshold_sweep_step: 0.05
```

### Step 2.6 — Run Phase 2

```bash
python3 ml/run_experiment.py --config ml/configs/v3_regression_llm_labels.yaml
```

**Success criteria:**
- Regression MAE < 0.15 on test set
- Derived binary recall > 0.80 at threshold 0.7
- Val loss does not diverge (early stopping should catch it)
- Loss curves show clean convergence without the overfitting pattern
  from DIAGNOSTICS_FINDINGS.md

---

## Phase 3: Human-in-the-loop corrections

**Goal:** Use the existing swipe rating UI to flag LLM–human
disagreements and feed corrections back into training.

### Step 3.1 — Create `ml/report_llm_disagreements.py`

Compare LLM quality scores against human ratings for snapshots where both
exist. Output a ranked list of the worst disagreements — these are the
images where human review would be most valuable.

**Output:**
- CSV with columns: `snapshot_id`, `firebase_url`, `llm_quality`,
  `human_rating_normalized`, `disagreement` (absolute diff),
  `llm_is_sunset`, `human_label`
- Sorted by `disagreement` descending
- Top 100 saved as a review queue

### Step 3.2 — Expose disagreement queue in the swipe UI

The existing `SwipeSnapshotGallery` and `RatingPanel` components already
load snapshots from `/api/snapshots`. Add a new query mode:

- `GET /api/snapshots?mode=disagreements` — returns snapshots where
  LLM and human ratings disagree most, so the user can review and
  correct them through the existing rating flow.

This requires:
- A new column on `webcam_snapshots`: `llm_quality` (float, nullable)
- A migration to add it
- The `/api/snapshots` route handler to support the new mode
- The LLM rater (Step 1.1) to optionally write `llm_quality` back to
  the database

### Step 3.3 — Retrain with merged labels

When enough human corrections exist (50+ disagreements reviewed), retrain:

1. For snapshots with human corrections post-LLM rating, use human rating
2. For everything else, use LLM rating
3. This creates a "best of both" label set: LLM for volume and
   consistency, human for precision on hard cases

Implement as a `--label-merge-strategy` flag in `export_dataset.py`:
- `llm_only`: use LLM ratings for all
- `human_override`: use human rating where available, LLM otherwise
- `weighted_average`: blend human and LLM (configurable weight)

---

## Phase 4: LLM as ongoing oracle for edge cases

**Goal:** In production, when the deployed ONNX model has low confidence
on a webcam image, call the LLM for a second opinion.

### Step 4.1 — Modify `aiScoring.ts` for real image inference

This is the biggest single change. Replace the metadata feature vector
with actual image tensor inference:

1. Download the webcam preview image (URL is already available from Windy)
2. Resize to 224x224, normalize to [0,1] float32
3. Create a [1, 3, 224, 224] ONNX tensor
4. Run inference through the regression model
5. Output is a single float (0.0–1.0 quality score)

The `normalizeScore` function already handles the 0–1 to 0–5 mapping.
The `scoreSingleModelWithOnnx` function needs to accept an image URL
instead of (or in addition to) a `WindyWebcam` metadata object.

**Key consideration:** This runs on Vercel serverless. Image download +
ONNX inference needs to stay under the function timeout. ResNet18 on
CPU takes ~20ms for inference; image download is the variable. Consider:
- Using the Windy preview URL (already a small image, ~200x150px)
- Resizing with `sharp` (already in many Next.js deployments)
- Caching the ONNX session (already implemented)

### Step 4.2 — Add LLM fallback for low-confidence scores

When the ONNX model's regression output is in the "uncertain" range
(e.g., 0.35–0.65), optionally call the LLM for a second opinion:

```typescript
const onnxScore = await scoreWithOnnx(webcam, imageUrl);

if (onnxScore.rawScore > 0.35 && onnxScore.rawScore < 0.65) {
  const llmScore = await scoreWithLlm(imageUrl);
  // Use LLM score, log the disagreement for future training
}
```

This keeps LLM API costs near zero — only ambiguous images trigger a
call. At 300 webcams/day, maybe 10–15% fall in the uncertain range =
~45 LLM calls/day = ~$0.005/day.

### Step 4.3 — Log LLM oracle calls for retraining

Every LLM oracle call should be logged to `snapshot_ai_inferences` with:
- `model_type: 'llm_oracle'`
- `model_version`: the LLM model name
- `raw_score`: the LLM quality score

These become high-value training examples for the next retrain cycle —
they're the images the model found hardest, now with LLM labels.

---

## File change summary

### New files to create

| File | Phase | Purpose |
|------|-------|---------|
| `ml/llm_rater.py` | 1 | Send images to vision LLM, get structured ratings |
| `ml/validate_llm_ratings.py` | 1 | Correlate LLM vs human ratings, pass/fail check |
| `ml/report_llm_disagreements.py` | 3 | Find worst LLM–human disagreements for review |
| `ml/configs/v3_regression_llm_labels.yaml` | 2 | Experiment config for regression with LLM labels |
| `database/migrations/YYYYMMDD_add_llm_quality.sql` | 3 | Add `llm_quality` column to `webcam_snapshots` |

### Existing files to modify

| File | Phase | Change |
|------|-------|--------|
| `ml/requirements.txt` | 1 | Add `google-generativeai`, `openai` |
| `ml/train.py` | 2 | Add early stopping, cosine LR, dropout |
| `ml/export_dataset.py` | 2 | Add `llm` label source option |
| `ml/run_experiment.py` | 2 | Wire new train.py args through YAML config |
| `ml/evaluate.py` | 2 | Add correlation metrics for regression |
| `app/api/cron/update-windy/lib/aiScoring.ts` | 4 | Real image inference + LLM fallback |
| `app/api/snapshots/route.ts` | 3 | Add `mode=disagreements` query |

---

## Dependency on existing infrastructure

Everything in Phases 1–3 uses **existing infrastructure**:

- Postgres connection: same `DATABASE_URL` as `export_dataset.py`
- Image URLs: `firebase_url` on `webcam_snapshots` (already public)
- Training pipeline: `train.py` → `evaluate.py` → `export_onnx.py`
  (already works for regression)
- Rating UI: `SwipeSnapshotGallery` + `RatingPanel` (already works)
- Experiment runner: `run_experiment.py` (already works)

Phase 4 requires changes to the Next.js app but uses existing patterns
(ONNX runtime is already loaded, session caching exists).

---

## Recommended implementation order

```
Week 1:
  ├─ Step 1.1: Build llm_rater.py
  ├─ Step 1.2: Build validate_llm_ratings.py
  └─ Step 1.3: Run on existing archive, validate correlation

Week 2:
  ├─ Step 2.1: Add early stopping + cosine LR + dropout to train.py
  ├─ Step 2.2: Add LLM label source to export_dataset.py
  ├─ Step 2.3: Wire through run_experiment.py
  ├─ Step 2.4: Add regression metrics to evaluate.py
  └─ Step 2.5: Create v3 config and run experiment

Week 3:
  ├─ Step 3.1: Build disagreement reporter
  ├─ Step 3.2: Add disagreement queue to swipe UI
  └─ Step 3.3: Review disagreements, retrain with merged labels

Week 4 (optional):
  ├─ Step 4.1: Wire real image inference in aiScoring.ts
  ├─ Step 4.2: Add LLM oracle fallback
  └─ Step 4.3: Log oracle calls for retraining
```

Phase 1 is the foundation. If LLM correlation is poor (< 0.80), stop
and refine the prompt before proceeding. Everything downstream depends
on the LLM producing consistent, meaningful quality scores.

---

## How to hand this to an agent

Give the agent these three files in order:

1. `ml/DIAGNOSTICS_FINDINGS.md` — context on current model problems
2. `ml/LLM_TEACHER_AND_EXTERNAL_DATA_PLAN.md` — strategy and rationale
3. `ml/IMPLEMENTATION_PLAN.md` — this file, the step-by-step build plan

Tell the agent: "Start with Phase 1, Step 1.1. Build `ml/llm_rater.py`
following the spec in IMPLEMENTATION_PLAN.md."
