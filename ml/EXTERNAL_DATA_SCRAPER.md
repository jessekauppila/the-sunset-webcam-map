# External Data Scraper

Scrapes sunset and sunrise images from Flickr (and potentially other
sources) to supplement the webcam training dataset. This addresses the
class imbalance problem identified in
[DIAGNOSTICS_FINDINGS.md](DIAGNOSTICS_FINDINGS.md): only 646 of 3,284
training images are positive (great sunset) examples.

---

## Why external data?

Webcams capture whatever is happening, and most of the time it is not a
great sunset. Curated photo sites like Flickr contain thousands of images
that people specifically chose to share because the sunset was beautiful.
Scraping these gives us a natural source of positive examples that our
webcam pipeline will never produce at scale.

**Target:** 2,000-5,000 externally sourced images to supplement existing
positives.

## Architecture

```
Flickr API
    │
    ▼
flickr_scraper.py
    ├─ Search by tags (sunset, sunrise, golden hour)
    ├─ Filter by Creative Commons license
    ├─ Download images
    ├─ Upload to Firebase Storage (external_images/flickr/{id}.jpg)
    └─ Insert metadata into Postgres (external_images table)
         │
         ▼
export_dataset.py --include-external
    ├─ UNION webcam_snapshots + external_images
    ├─ Unified manifest CSV with source column
    └─ Same format consumed by train.py
```

External images are stored in a **separate Postgres table**
(`external_images`) but use the same Firebase Storage bucket under a
different path prefix. The export pipeline merges them via
`--include-external` into a single manifest that `train.py` reads
without any changes.

## Prerequisites

1. **Flickr API key** (free, non-commercial):
   https://www.flickr.com/services/apps/create/apply

2. **Environment variables:**

```bash
export FLICKR_API_KEY="your-key-here"
export DATABASE_URL="postgresql://user:pass@host:port/dbname"
export FIREBASE_STORAGE_BUCKET="your-bucket.firebasestorage.app"

# Optional: for Firebase uploads
export GOOGLE_APPLICATION_CREDENTIALS="/path/to/service-account.json"
```

3. **Database migration** (run once):

```bash
psql $DATABASE_URL -f database/migrations/20260417_external_images.sql
```

4. **Python dependencies:**

```bash
pip install -r ml/requirements.txt
```

## Usage

### Preview what would be scraped (dry run)

```bash
python3 ml/flickr_scraper.py \
  --query sunset \
  --max-images 100 \
  --dry-run
```

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

### Save images locally (no Firebase upload)

Useful for testing or when Firebase credentials are unavailable:

```bash
python3 ml/flickr_scraper.py \
  --query sunset \
  --max-images 50 \
  --local-only
```

Images save to `ml/artifacts/external_images/flickr/`.

### Resume an interrupted scrape

The scraper automatically skips images that already exist in the database
(matched by `source` + `source_id`). Just rerun the same command:

```bash
python3 ml/flickr_scraper.py \
  --query sunset \
  --max-images 2000
```

## CLI reference

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

## Flickr license IDs

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

## Database schema

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

## Integration with training pipeline

After scraping and LLM-rating (see
[LLM_TEACHER_AND_EXTERNAL_DATA_PLAN.md](LLM_TEACHER_AND_EXTERNAL_DATA_PLAN.md)),
include external images in training manifests:

```bash
python3 ml/export_dataset.py \
  --label-source manual_only \
  --target-type regression \
  --include-external
```

The manifest CSV will include a `source` column (`webcam`, `flickr`,
etc.) so you can evaluate metrics separately per source:

```python
import pandas as pd
df = pd.read_csv("manifest_test.csv")
webcam_only = df[df["source"] == "webcam"]
external_only = df[df["source"] != "webcam"]
```

## Domain shift considerations

Flickr photos differ from webcam stills: higher resolution, intentional
composition, often post-processed. Mitigations are documented in
[LLM_TEACHER_AND_EXTERNAL_DATA_PLAN.md](LLM_TEACHER_AND_EXTERNAL_DATA_PLAN.md#domain-shift-webcam-stills-vs-flickr-photos)
and include:

- Tracking source in manifests for separate evaluation
- Augmenting external images to simulate webcam quality
- Weighting webcam examples higher in loss
- Using external data primarily for "what makes a great sunset" signal

## Run summaries

Each scrape run writes a JSON summary to
`ml/artifacts/scraper_runs/flickr_<timestamp>.json` with download counts,
skip counts, and error counts.

## Adding other sources

The database table and export pipeline support multiple sources. To add
Unsplash or Pexels scraping in the future:

1. Create a new scraper script (e.g. `ml/unsplash_scraper.py`)
2. Insert rows with `source = 'unsplash'` or `source = 'pexels'`
3. `export_dataset.py --include-external` will automatically pick them up

## Cost

| Item | Count | Cost |
|------|-------|------|
| Flickr API calls | ~5,000 | Free |
| Image downloads | ~5,000 | Free |
| Firebase Storage | ~5 GB | Free tier covers this |
| LLM rating (Phase 2) | ~5,000 | ~$0.50 (Gemini Flash) |
| **Total** | | **< $1** |
