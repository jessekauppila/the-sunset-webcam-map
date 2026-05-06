# ML Pipeline Operating Guide

Last updated: April 2026

This is the single reference for operating the sunset webcam ML pipeline.
It covers everything from environment setup through production deployment,
including the LLM labeling system, Flickr scraper, experiment workflow,
diagnostic interpretation, and historical findings.

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

### Why continuous 0.0-1.0 instead of binary or integer 1-5

| Scale | Problem |
|-------|---------|
| Binary (0/1) | Images near the threshold get randomly assigned. This is the label noise the diagnostics identified. |
| Integer 1-5 | Human raters cluster at 2-4. Very few 1s and 5s. Effective scale is really 2-4 with sparse extremes. |
| Continuous 0.0-1.0 | LLMs provide fine-grained scores (0.72 vs 0.78). No threshold noise. Regression loss works naturally. Binary decisions are derived post-hoc by picking a threshold on the output. |

You can always go from continuous to binary, but not the other way around.

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

`run_training.py` resolves `DATABASE_URL` in this order:

1. `--database-url` argument (if provided)
2. Existing `DATABASE_URL` in shell
3. `DATABASE_URL` entry in `.env.local` (or `--env-file`)

### Database migrations

Run these once before first use:

```bash
# External images table (for Flickr scraper)
psql $DATABASE_URL -f database/migrations/20260417_external_images.sql

# LLM quality column on webcam snapshots (for LLM rater --write-to-db)
psql $DATABASE_URL -f database/migrations/20260417_add_llm_quality_to_snapshots.sql
```

### Torch stack note

This repo currently pins `torch==2.2.2` and `torchvision==0.17.2` in
`ml/requirements.txt` for local compatibility.

---

## 2. Running an experiment (the standard workflow)

Every experiment is driven by a single YAML config file. This is the
recommended workflow for all model training.

### Why this is the preferred workflow

- One source of truth for data/model/metrics/transforms
- Fair A/B comparisons (only one changed variable at a time)
- Complete artifact logging for reporting and reproducibility
- Easier iteration on professor-style suggestions

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

`run_experiment.py` runs `plot_diagnostics.py` automatically after eval,
so you do not need to run it manually for new experiments.

---

## 3. Understanding the diagnostic plots

### label_distribution.png

**Left panel -- raw rating histogram:** shows where human ratings (1-5)
fall across train/val/test splits.

What to look for:

- Clustering around 2.5-3.5 means most images were rated "average." The
  model will tend to predict average and struggle with extremes.
- Thin bars at 1, 4.5, 5 means you have few "definitive" examples. The
  model cannot learn clear boundaries between great and mediocre.
- Splits should look similar in shape (same distribution train vs val vs
  test), otherwise your split was not representative.

**Right panel -- target label distribution (binary runs):** class 0 vs
class 1 counts per split.

What to look for:

- A 4:1 or greater ratio between negative and positive means significant
  imbalance. Without weighting, the model can achieve ~80% accuracy by
  always predicting negative.
- The x-axis annotation shows the effective class weights used. If
  `class_weighting: balanced`, the positive class is upweighted
  proportionally. If `class_weighting: none`, the model sees raw
  imbalance.
- For "archive great sunsets," recall on class 1 (positives) is the key
  metric. If you miss a great sunset, it is gone. A false alarm
  (capturing a mediocre one) is less costly.

### loss_curves.png

**Top panel -- train vs val loss:**

| Pattern | Meaning | What to try |
|---------|---------|-------------|
| Both lines go down together | Healthy learning | More epochs or more data |
| Train down, val up (diverging) | Overfitting | Fewer epochs, add dropout, more data |
| Both flat/high from epoch 1 | Underfitting | Higher LR, larger model, check data |
| Val loss bouncy, train smooth | Val set too small or noisy labels | Larger val set, better labels |

**Bottom panel -- validation metric:**

- Binary: val F1 (higher = better; 1.0 is perfect, 0.0 is random)
- Regression: val MSE (lower = better)

The dashed vertical line marks the epoch where the best checkpoint was
saved. If the best checkpoint is at a very early epoch (e.g. 3 of 10),
you may be wasting training time -- the model peaked early. If it is at
the final epoch, more epochs might still help.

The small annotation at the bottom of the figure gives an automatic
diagnosis (overfitting warning, healthy, or modest gap).

### comparison plot (multi-run)

Overlaid val metric curves from multiple runs. Use this to compare:

- Crop strategies (random_resized vs center vs resize_only)
- Class weighting (none vs balanced)
- Augmentation profiles (off vs light vs medium)
- Number of epochs

A stdout table is also printed with: run name, best epoch, best metric,
class counts, and imbalance ratio.

### What to do after looking at the plots

1. If label distribution shows clustering at 2.5-3.5: consider LLM labels
   (continuous 0.0-1.0 scale) or labeling more definitive examples (1s
   and 5s).

2. If loss curves show overfitting: try fewer epochs, add dropout
   (`head_dropout: 0.3`), enable early stopping
   (`early_stopping_patience: 5`), or get more training images.

3. If class imbalance is very high (>5:1): try `imbalance.sampler: weighted`
   in addition to `class_weighting: balanced` and compare val recall.

---

## 4. LLM rating pipeline

The LLM rater replaces noisy human integer ratings with consistent
continuous 0.0-1.0 quality scores. This fixes the label noise problem
identified in the baseline diagnostics (see Appendix A).

### Which LLM model to use

The rater supports three providers: Anthropic Claude, Google Gemini,
and OpenAI. **Important: Claude.ai Pro and ChatGPT Plus are chat-app
subscriptions, not API access.** You need an API key from each
provider's developer console (separate billing).

| Model | Cost per image | Quality on aesthetics | Recommendation |
|-------|---------------|----------------------|----------------|
| Claude 3.5 Sonnet | ~$0.005 | Best at nuanced aesthetic judgment | Pick this if you have Anthropic credits and want the most "tasteful" ratings. |
| Claude 3.5 Haiku | ~$0.001 | Very good, faster | **Default for `--provider anthropic`.** Best balance of quality and cost. |
| GPT-4o | ~$0.003 | Excellent | Solid alternative. |
| GPT-4o-mini | ~$0.0003 | Good | **Default for `--provider openai`.** Cheap and capable. |
| Gemini 2.0 Flash | ~$0.0001 (free tier available) | Good | **Default for `--provider gemini`.** Free tier covers ~1,500 images/day. |

For ~4,000 webcam images: Sonnet $20, Haiku $4, GPT-4o-mini $1, Gemini
free tier $0.

A single call returns both the binary question ("is there a sunset?")
and the quality score. Consistency matters more than precision, and a
single model is inherently consistent with itself.

### LLM rating prompt

The rater sends each image with this structured prompt:

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

### Step 1: Dry-run with HTML report (visual sanity-check)

```bash
python3 ml/llm_rater.py --provider anthropic --source webcam --dry-run
```

Defaults to **20 images, evenly spread across your dataset** (so you
see variety, not just the first 20 chronologically). Generates a
self-contained HTML report with thumbnails, ratings, and human-vs-LLM
agreement indicators.

The report opens in your browser — that's how you actually see whether
the LLM is making sensible aesthetic judgments before spending money on
the full archive.

**Larger sample for thorough review:**

```bash
python3 ml/llm_rater.py \
  --provider anthropic \
  --source webcam \
  --dry-run \
  --dry-run-count 100
```

**Sampling modes:**

- `--dry-run-sample-mode spread` (default) — evenly spaced indices, best for variety
- `--dry-run-sample-mode random` — uniform random sample
- `--dry-run-sample-mode sequential` — first N rows (fastest, biased)

The HTML report shows for each image:

- Thumbnail (loaded from Firebase URL)
- LLM quality score with a colored bar (red < 0.3, orange < 0.6, green ≥ 0.6)
- Sunset/clouds/confidence badges
- LLM's color description and any obstruction notes
- Human rating (if available) and agreement indicator:
  - GOOD (green) — within 0.15 of human
  - OK (orange) — within 0.30 of human
  - DISAGREE (red) — differs by more than 0.30

Cards are sorted by quality (high to low) so you can scan from the LLM's
"best sunsets" down to "no sunset visible" and gut-check the order.

### Step 2: Rate the webcam archive

```bash
python3 ml/llm_rater.py \
  --provider anthropic \
  --source webcam \
  --output-csv ml/artifacts/llm_ratings/initial_ratings.csv \
  --write-to-db
```

`--write-to-db` persists `llm_quality` back to `webcam_snapshots` so it
is available for the disagreement UI and future exports.

`--skip-rated` resumes from where you left off if interrupted.

For Anthropic API tier 1, you can safely set `--rpm 50`. For Gemini
free tier, leave the default `--rpm 14`.

### Step 3: Rate external (Flickr) images

```bash
python3 ml/llm_rater.py \
  --provider anthropic \
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

Validation uses ONLY webcam snapshots (which have both LLM and human
ratings). Flickr images have no human ground truth to validate against.

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
| `--provider` | `gemini` | LLM provider: `anthropic`, `gemini`, or `openai` |
| `--model` | per-provider default | Model name (e.g. `claude-haiku-4-5`, `gemini-2.0-flash`, `gpt-4o-mini`) |
| `--source` | `webcam` | Image source: `webcam`, `external`, or `all` |
| `--output-csv` | timestamped path | Where to write ratings CSV |
| `--write-to-db` | false | Also persist ratings to Postgres |
| `--skip-rated` | false | Skip images already in the output CSV (resume) |
| `--dry-run` | false | Sample N images and generate an HTML report; do not write to DB |
| `--dry-run-count` | 20 | How many images to sample in dry-run mode |
| `--dry-run-sample-mode` | `spread` | `spread` (evenly spaced), `random`, or `sequential` |
| `--dry-run-html` | auto path | Override the HTML report output path |
| `--rpm` | 14 | Rate limit (requests per minute) |
| `--limit` | all | Max images to process |
| `--download-timeout` | 30s | Per-image HTTP download timeout |
| `--api-timeout` | 60s | Per-image LLM API call timeout |
| `--verbose` | false | Print per-step progress and timing for each image |
| `--database-url` | `$DATABASE_URL` or `.env.local` | Postgres connection string |
| `--api-key` | per-provider env var or `.env.local` | `$ANTHROPIC_API_KEY`, `$GEMINI_API_KEY`, or `$OPENAI_API_KEY` |
| `--env-file` | `.env.local` | Dotenv file to read API keys + `DATABASE_URL` from when not in shell env |

### Provider-specific notes

**Anthropic Claude:**
- Set `ANTHROPIC_API_KEY` in your shell or in `.env.local` at the
  project root — `llm_rater.py` will auto-load it. (Get one at
  console.anthropic.com.)
- Default model: `claude-haiku-4-5` (vision-capable, ~$1 / MTok input,
  ~$5 / MTok output as of 2026). The earlier `claude-3-5-haiku-latest`
  alias was retired; use `claude-haiku-4-5` going forward.
- Use `--model claude-sonnet-4-5` for the highest-quality (but pricier)
  ratings.
- Claude does not have a native JSON response mode; the rater strips
  any markdown fences from the response before parsing.

**Gemini:**
- Set `GEMINI_API_KEY` (get one at aistudio.google.com)
- Free tier: 15 RPM, 1,500 requests/day
- Default model: `gemini-2.0-flash`

**OpenAI:**
- Set `OPENAI_API_KEY` (get one at platform.openai.com)
- Default model: `gpt-4o-mini`
- Uses native JSON response mode, lowest detail image setting (cheap)

---

## 5. Flickr scraper

Supplements webcam data with curated sunset images from Flickr. Addresses
the class imbalance problem (only 646 positive examples out of 3,284).

External images are stored in a separate Postgres table (`external_images`)
but use the same Firebase Storage bucket under a different path prefix
(`external_images/flickr/{id}.jpg`). The export pipeline merges them via
`--include-external` into a single manifest that `train.py` reads without
any changes.

### Scrape sunset images

```bash
python3 ml/flickr_scraper.py \
  --query sunset sunrise "golden hour" "sky colors" \
  --max-images 2000
```

### Scrape negative examples

For balanced training, also scrape non-sunset sky images:

```bash
python3 ml/flickr_scraper.py \
  --query "cloudy sky" overcast "night sky" "blue sky" \
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

### Flickr scraper CLI reference

| Flag | Default | Description |
|------|---------|-------------|
| `--query` | (required) | One or more search terms |
| `--max-images` | 500 | Maximum total images to download |
| `--category` | `sunset` | Category label: `sunset` or `negative` |
| `--license-ids` | `4,5,9,10` | Flickr license IDs (CC-BY, CC-BY-SA, CC0, Public Domain) |
| `--sort` | `interestingness-desc` | Sort order for results |
| `--per-page` | 100 | Results per API page |
| `--dry-run` | false | Preview without downloading |
| `--local-only` | false | Save locally instead of Firebase |
| `--database-url` | `$DATABASE_URL` | Postgres connection string |
| `--firebase-bucket` | `$FIREBASE_STORAGE_BUCKET` | Firebase Storage bucket |
| `--flickr-api-key` | `$FLICKR_API_KEY` | Flickr API key |
| `--no-progress` | false | Suppress progress bars |

### Flickr license IDs

| ID | License | Included by default? |
|----|---------|---------------------|
| 4 | CC-BY 2.0 | Yes |
| 5 | CC-BY-SA 2.0 | Yes |
| 9 | CC0 1.0 (Public Domain Dedication) | Yes |
| 10 | Public Domain Mark | Yes |
| 1 | CC-BY-NC-SA 2.0 | No (non-commercial restriction) |
| 2 | CC-BY-NC 2.0 | No |
| 3 | CC-BY-NC-ND 2.0 | No |
| 6 | CC-BY-ND 2.0 | No (no-derivatives restriction) |

To include non-commercial licenses: `--license-ids 1,2,3,4,5,6,9,10`

### External images database schema

The `external_images` table (see
`database/migrations/20260417_external_images.sql`):

| Column | Type | Description |
|--------|------|-------------|
| `id` | bigserial | Primary key |
| `source` | text | `flickr`, `unsplash`, `pexels` |
| `source_id` | text | Original ID from source platform |
| `image_url` | text | Firebase Storage URL (or local path) |
| `firebase_path` | text | Storage path for cleanup |
| `original_url` | text | Where the image was downloaded from |
| `license` | text | License string (e.g. `cc-by-2.0`) |
| `title` | text | Image title |
| `description` | text | Image description |
| `tags` | text[] | Tags from source platform |
| `owner` | text | Photographer username |
| `width`, `height` | int | Image dimensions |
| `category` | text | `sunset` or `negative` |
| `llm_quality` | decimal | 0.000-1.000, filled by `llm_rater.py` |
| `llm_confidence` | decimal | 0.000-1.000 |
| `llm_model` | text | Which LLM rated this image |
| `llm_rated_at` | timestamptz | When the LLM rated this image |
| `scraped_at` | timestamptz | When this image was scraped |

Unique constraint on `(source, source_id)` prevents duplicate downloads.

### Including external data in training

After scraping and LLM-rating, include external images in manifests:

```bash
python3 ml/export_dataset.py \
  --label-source manual_only \
  --target-type regression \
  --include-external
```

The manifest CSV includes a `source` column (`webcam`, `flickr`, etc.)
so you can evaluate metrics separately per source:

```python
import pandas as pd
df = pd.read_csv("manifest_test.csv")
webcam_only = df[df["source"] == "webcam"]
external_only = df[df["source"] != "webcam"]
```

### Adding other sources

The database table and export pipeline support multiple sources. To add
Unsplash or Pexels scraping in the future:

1. Create a new scraper script (e.g. `ml/unsplash_scraper.py`)
2. Insert rows with `source = 'unsplash'` or `source = 'pexels'`
3. `export_dataset.py --include-external` will automatically pick them up

### Scraper run summaries

Each scrape run writes a JSON summary to
`ml/artifacts/scraper_runs/flickr_<timestamp>.json` with download counts,
skip counts, and error counts.

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

## 12. Domain shift: Flickr vs webcam

This is the biggest risk when mixing data sources.

**Flickr sunset photos** are taken with DSLRs/phones by skilled
photographers, composed intentionally, often post-processed (saturation
boost, HDR).

**Webcam snapshots** are low-resolution fixed-position cameras,
uncomposed, no post-processing, often with compression artifacts.

### Mitigation strategies

1. **Train on both, but track source.** Include a `source` column in the
   manifest. Evaluate metrics separately on webcam-only vs external-only
   test sets. If the model scores well on Flickr but poorly on webcams,
   the domain gap is real.

2. **Augment external images to look more like webcams.** Apply transforms
   that simulate webcam quality: JPEG compression artifacts (quality
   30-60), resolution downscale, slight color desaturation, random crop
   to simulate fixed camera framing.

3. **Weight webcam examples higher in loss.** Since production inference
   runs on webcam images, webcam training examples should matter more. A
   2:1 or 3:1 webcam-to-external weight ratio prevents the model from
   overfitting to Flickr aesthetics.

4. **Use external data primarily for the "what makes a great sunset"
   signal.** The model needs to learn two things: (a) what sunset colors
   and cloud patterns look great, and (b) what webcam images look like.
   External data teaches (a). Webcam data teaches (b). Both are needed.

---

## 13. Known issues and constraints

### Production scoring mismatch

The deployed ONNX model in `aiScoring.ts` currently feeds a metadata
feature vector, not a 224x224 image tensor. Models trained on images will
not produce correct scores in production until that runtime path is
updated (Phase 4 of the LLM Teacher plan).

### Class imbalance

Current webcam data: 80% negative, 20% positive (4.1:1 ratio). Use
`class_weighting: balanced` for binary runs. For regression with LLM
labels, imbalance is less of an issue since the target is continuous.

### Small validation set

723 images in the current val split. Loss curves will bounce. Interpret
trends, not individual epoch values. Early stopping with patience 4-5
smooths this out.

---

## 14. Artifact locations

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

## 15. Cost estimates

| Item | Count | Unit cost | Total |
|------|-------|-----------|-------|
| Flickr API calls (search + info) | ~5,000 | Free | $0 |
| Image downloads (Flickr) | ~5,000 | Free | $0 |
| Firebase Storage | ~5 GB | Free tier covers this | $0 |
| LLM rating -- external images | 5,000 | $0.0001 (Gemini Flash) | $0.50 |
| LLM rating -- existing webcam archive | ~4,000 | $0.0001 | $0.40 |
| GPU training time (local) | 1-2 hours | Free | $0 |
| **Total** | | | **< $1** |

If using GPT-4o-mini instead of Gemini Flash, multiply LLM costs by ~3x.
Still under $3 total.

---

## 16. Glossary

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
| **model card** | Auto-generated markdown report per experiment run with metrics, diagnosis, and interpretation. |

---

## Appendix A: Baseline diagnostic findings (April 2026)

Context: First diagnostic pass after professor consultation. 7 completed
experiment runs were analyzed (2 early baseline runs with ~22 samples
should be ignored, 4 full binary classification runs with 3,284 train
samples each, and 1 regression run).

The professor's three diagnostic questions:
1. How are labels distributed? (Is data clustered in the middle?)
2. What do the loss curves look like? (Are we overfitting?)
3. What is the class balance? (Are great sunsets underrepresented?)

### Finding 1: Significant class imbalance

| Class | Count | Share |
|-------|-------|-------|
| Negative (not a great sunset) | 2,638 | 80% |
| Positive (great sunset) | 646 | 20% |
| Ratio | 4.1:1 | |

Without correcting for imbalance, a model that always predicts "not
great" would be right 80% of the time. `class_weighting: balanced` was
used, which upweights positives ~4x in the loss (effective weights:
[0.62, 2.54]).

### Finding 2: Both best runs overfit -- more epochs will not help

**`v2_mild_crop_balanced`** (random resized crop, 10 epochs):

| Epoch | Train loss | Val loss | Val F1 |
|-------|-----------|----------|--------|
| 1 | 0.381 | 0.418 | 0.725 |
| 4 | 0.163 | 0.287 (val loss minimum) | 0.800 |
| 8 | 0.091 | 0.316 | 0.802 |
| 10 | 0.075 | 0.459 | 0.832 (best F1) |

Val loss hit its best at epoch 4 (0.287) then drifted up to 0.459 by
epoch 10 -- 60% worse. F1 still improved because the classification
threshold still works, but the model's probability estimates are
degrading.

**`v2_no_crop_balanced`** (no crop, 10 epochs):

| Epoch | Train loss | Val loss | Val F1 |
|-------|-----------|----------|--------|
| 1 | 0.387 | 0.339 | 0.782 |
| 2 | 0.235 | 0.315 | 0.834 (peaked here) |
| 3 | 0.178 | 0.526 | 0.748 |
| 10 | 0.069 | 0.514 | 0.743 |

Peaked at epoch 2. By epoch 10, F1 dropped back to 0.743 -- worse than
where it started. Running more epochs actively made the model worse.

### Finding 3: What 0.83 F1 actually means

F1 of 0.83 is decent for a first-pass model. Typical well-tuned image
classifiers on this kind of task reach 0.88-0.92 with better data and
regularization. For the "archive great sunsets" use case, recall is
the more important metric -- missing a great sunset is worse than
occasionally capturing a mediocre one.

### Root causes of overfitting (priority order)

1. **Val set is small (723 images).** A few hard images can swing the
   loss significantly, making it hard to know when the model has
   truly peaked.

2. **Label noise.** Ratings cluster around 2.5-3.5. Images near the
   binary threshold get conflicting labels. The model sees visually
   similar images with opposite labels.

3. **No learning rate decay.** A fixed LR the whole time means the
   optimizer keeps taking big steps even when it should be settling.

4. **No dropout or regularization.** The ResNet18 head has no dropout.
   The model can freely memorize training images.

### What would actually move the number

| Action | Expected impact | Difficulty |
|--------|----------------|------------|
| More labeled great sunsets (target: 1200+ positives) | High | Medium |
| Early stopping (patience 3-5 epochs) | Medium | Easy |
| Learning rate decay (cosine or step) | Medium | Easy |
| Dropout on the classifier head | Medium | Easy |
| Better binary threshold / LLM labels | High | Medium |
| Weighted random sampler + class weighting | Low-medium | Easy |

---

## Appendix B: Build log (April 17, 2026)

All changes are backwards-compatible. Existing binary training configs
and the Flickr scraper pipeline work exactly as before -- every new
feature is opt-in via new CLI flags or config fields that default to
the old behavior.

### New files created

| File | Purpose |
|------|---------|
| `ml/llm_rater.py` | Vision LLM rating script. Supports Gemini and OpenAI providers. Rates webcam and/or external images. CSV output + optional DB writeback. Resume via `--skip-rated`. |
| `ml/validate_llm_ratings.py` | Validates LLM ratings against human consensus. Pearson/Spearman correlation, MAE, binary agreement. Scatter plot. Pass/fail gate at Pearson > 0.80. |
| `ml/configs/v3_regression_llm_labels.yaml` | Experiment config: regression on LLM labels, cosine LR, early stopping (patience=5), dropout (0.3). |
| `ml/configs/v3_regression_llm_with_external.yaml` | Same as above + Flickr external images via `--include-external`. |
| `database/migrations/20260417_add_llm_quality_to_snapshots.sql` | Adds `llm_quality`, `llm_model`, `llm_rated_at` columns to `webcam_snapshots`. |

### Files modified

| File | What changed |
|------|-------------|
| `ml/requirements.txt` | Added `scipy>=1.13`, `google-generativeai>=0.8`, `openai>=1.40`. |
| `ml/train.py` | Added `--early-stopping-patience` (default 0), `--lr-schedule` (none/cosine), `--head-dropout` (default 0.0). Epoch history now includes `lr` field. Summary includes `epochs_completed`, `early_stopped_epoch`. |
| `ml/export_dataset.py` | Added `--llm-ratings-csv`, `--label-merge-strategy` (human_only/llm_only/human_override/weighted_average), `--llm-weight`. Export metadata tracks merge strategy and LLM override count. |
| `ml/run_experiment.py` | Wires `lr_schedule`, `early_stopping_patience`, `head_dropout`, `llm_ratings_csv`, `label_merge_strategy`, `llm_weight`, `include_external`, `external_categories` from YAML config to CLI args. |
| `ml/evaluate.py` | Regression mode now reports Pearson r, Spearman r, R², and derived binary threshold sweep. |

### Flickr scraper compatibility

The LLM rater works alongside the existing Flickr scraper:

- `llm_rater.py --source external` rates images in `external_images`,
  writing to the `llm_quality` column already in that table's schema.
- `llm_rater.py --source webcam` rates images in `webcam_snapshots`,
  using the new `llm_quality` column from the migration.
- `llm_rater.py --source all` rates both in one run.
- `export_dataset.py --include-external` merges external images into
  training manifests -- LLM ratings are picked up automatically.

### What remains (not yet built)

| Item | Status |
|------|--------|
| Run `llm_rater.py` on existing archive | Ready to run |
| Run `validate_llm_ratings.py` and check correlation | Ready to run |
| Run `v3_regression_llm_labels` experiment | Ready to run |
| Automated model card reports (`--report` flag) | Not started |
| Disagreement queue in swipe UI (`mode=disagreements`) | Not started |
| Real image inference in `aiScoring.ts` | Not started |
| LLM oracle fallback in `aiScoring.ts` | Not started |

---

## Appendix C: Build log (May 2, 2026) — Anthropic + dry-run HTML

Two enhancements to `llm_rater.py` to support a wider provider mix and
provide visual sanity-checking before spending money on a full archive
rating run.

### What changed

**Anthropic Claude support added.** `llm_rater.py` now supports three
providers: `anthropic`, `gemini`, `openai`. Default Anthropic model is
`claude-haiku-4-5` (vision-capable Haiku 4.5, replaces the deprecated
`claude-3-5-haiku-latest`). New env var: `ANTHROPIC_API_KEY`. Claude
does not have a native JSON response mode, so the rater strips
markdown code fences from the response before parsing.

**`.env.local` auto-loading.** `llm_rater.py` (and `run_training.py`)
now read `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `OPENAI_API_KEY`, and
`DATABASE_URL` from `.env.local` automatically when they are not set
in the shell. This matches how Next.js loads secrets, so the same
file works for both runtimes. Override with `--env-file <path>` or
explicit CLI flags. Implementation lives in
`ml/common/io.py::get_env_or_file`.

**Dry-run mode now generates an HTML report.** Previously `--dry-run`
processed 5 images and printed JSON; now it processes a configurable
sample (default 20) and writes a self-contained HTML file with image
thumbnails, ratings, and human-vs-LLM agreement indicators. Cards are
sorted by quality (high to low) so you can scan the model's "best
sunsets" down to "no sunset" and verify the order makes visual sense.

New CLI flags:

- `--dry-run-count` (default 20) — sample size
- `--dry-run-sample-mode` (default `spread`) — `spread`, `random`, or `sequential`
- `--dry-run-html` — override output path

The HTML report uses public Firebase URLs directly (no base64) so the
file stays small. Open it with `open <path>` after the dry-run
completes.

### Files modified

| File | What changed |
|------|-------------|
| `ml/llm_rater.py` | Added `rate_with_anthropic()`. Refactored provider dispatch into a `PROVIDER_RATE_FNS` map. Added `DEFAULT_MODELS` and `API_KEY_ENV` lookup tables. New `sample_rows()` helper for dry-run sample selection. New `render_dry_run_html()` generates the visual report. CLI replaced 5-image fixed dry-run with configurable sample size + HTML output. |
| `ml/requirements.txt` | Added `anthropic>=0.40`. |
| `ml/OPERATING_GUIDE.md` | Updated provider table to include Claude. Replaced the Step 1 dry-run section with HTML-report-first workflow. Added provider-specific notes section explaining API keys and model defaults. |

### Backwards compatibility

- All existing flags work identically. `--provider gemini` and
  `--provider openai` paths are unchanged.
- The default sample count is now 20 instead of 5, but you can set
  `--dry-run-count 5` to match old behavior.
- The HTML report is generated automatically during dry-runs; no flag
  is required to opt in. Stdout summary still prints.