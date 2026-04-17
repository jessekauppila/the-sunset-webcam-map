# LLM Teacher Model + External Sunset Dataset Plan

Date: April 2026
Context: Follows from DIAGNOSTICS_FINDINGS.md. Addresses class imbalance
(only 646 positive examples), label noise at the binary threshold, and the
path to a production-grade sunset quality model.

---

## Problem summary

Our current training data comes entirely from webcam snapshots rated by
humans through a swipe UI. This creates two problems the diagnostics
identified as root causes of overfitting:

1. **Class imbalance.** 80% of snapshots are "not great" because webcams
   capture whatever is happening, and most of the time it is not a
   spectacular sunset. We have only 646 positive examples.
2. **Label noise.** Human ratings cluster around 2.5–3.5. The binary
   threshold (4.0) slices through ambiguous images, giving the model
   conflicting labels for visually similar inputs.

Both problems are **data problems**, not model problems. More epochs,
fancier architectures, and hyperparameter sweeps will not fix them.

---

## Strategy: two moves that fix the data

### Move 1 — Scrape external sources for high-quality sunset images

Curated photo sites (Flickr, Unsplash, Pexels) contain thousands of images
that people specifically chose to photograph and share because the sunset
was beautiful. This is a natural source of positive examples that our
webcam pipeline will never produce at scale.

**Target:** 2,000–5,000 externally sourced sunset images to supplement the
existing 646 positives.

### Move 2 — Use a vision LLM to rate every image on a continuous scale

Instead of relying on noisy human 1–5 integer ratings converted to binary,
use a vision LLM (Gemini 2.0 Flash or GPT-4o-mini) to produce a
consistent, continuous 0.0–1.0 quality score for every image — both the
scraped external images and our existing webcam snapshots.

---

## Why a continuous 0.0–1.0 scale instead of binary or integer 1–5

| Scale | Problem |
|-------|---------|
| Binary (0/1) | Images near the threshold get randomly assigned. This is the label noise our diagnostics identified. |
| Integer 1–5 | Human raters cluster at 2–4. Very few 1s and 5s. Effective scale is really 2–4 with sparse extremes. |
| Continuous 0.0–1.0 | LLMs provide fine-grained scores (0.72 vs 0.78). No threshold noise. Regression loss works naturally. You can always derive binary later by picking a threshold on the output. |

You can always go from continuous to binary, but not the other way around.

---

## External data sources

### Primary: Flickr API

- Free API key (non-commercial use)
- Search by tags: `sunset`, `sunrise`, `golden hour`, `sky colors`
- Filter by license: Creative Commons (CC-BY, CC-BY-SA, CC0)
- Filter by `sort=interestingness-desc` to get the best images first
- Metadata available: tags, description, favorites count, views
- Rate limit: 3,600 requests/hour (more than enough)

### Secondary: Unsplash API

- Free for non-commercial (50 req/hour on demo key)
- High-quality curated photos
- Search endpoint: `/search/photos?query=sunset`
- All images are free to use (Unsplash license)

### Tertiary: Pexels API

- Free API key, 200 req/hour
- Search endpoint with `sunset` query
- All images are free to use (Pexels license)

### Negative examples

We already have plenty of negatives from webcam snapshots. But for balance
in the external set, also scrape:
- `cloudy sky` / `overcast` / `gray sky` — no sunset
- `night sky` / `dark sky` — too late for sunset
- `daytime sky` / `blue sky` — too early for sunset

This ensures the model learns "not a sunset" from diverse sky conditions,
not just from webcam artifacts.

---

## LLM rating pipeline

### Which model to use

| Model | Cost per image | Quality | Recommendation |
|-------|---------------|---------|----------------|
| Gemini 2.0 Flash | ~$0.0001 (free tier available) | Good | **Use this.** Cheapest, structured output, free tier covers initial runs. |
| GPT-4o-mini | ~$0.0003 | Good | Solid alternative if Gemini is unavailable. |
| GPT-4o | ~$0.003 | Slightly better | 10x the cost. Not worth it for this task. |
| Claude 3.5 Haiku | ~$0.0004 | Good | Comparable to GPT-4o-mini. |

**We do NOT need separate models for binary vs quality rating.** A single
cheap call returns both. The binary question ("is there a sunset?") is
trivial for any vision model — there is no quality gap between cheap and
expensive models on that sub-task. For the aesthetic quality score, the
gap between GPT-4o-mini and GPT-4o is small (they agree within ±0.1 on
most images). Consistency matters more than precision here, and a single
model is inherently consistent with itself.

### Rating prompt

```
Analyze this image and return a JSON object with these fields:

- is_sunset (boolean): Is there a visible sunset or sunrise in this image?
- quality (float 0.0-1.0): Rate the sunset/sunrise quality where:
    0.0 = no sunset visible, just sky/clouds/darkness
    0.1 = barely any color, mostly gray
    0.3 = weak sunset, minimal color
    0.5 = decent sunset, some color in the sky
    0.7 = good sunset, vivid colors
    0.85 = great sunset, dramatic sky with rich colors
    0.95 = spectacular, once-in-a-lifetime sunset
- confidence (float 0.0-1.0): How confident are you in this rating?
- has_clouds (boolean): Are there clouds adding drama to the scene?
- color_palette (string): Brief description of dominant colors.
- obstruction (string|null): If the view is partially blocked, what by?
  (e.g. "rain on lens", "fog", "building", null if clear)

Return ONLY the JSON object, no other text.
```

### Validation step

Before bulk-rating, run a calibration check:
1. Select 100 images that have reliable human ratings (5+ raters, strong
   consensus).
2. Run them through the LLM.
3. Compute Pearson correlation between LLM `quality` and human
   `calculated_rating` (normalized to 0–1).
4. If correlation > 0.80, proceed. If not, refine the prompt.

---

## Pipeline architecture

```
┌─────────────────────────────────────────────────────────┐
│  Step 1: Scrape                                         │
│                                                         │
│  flickr_scraper.py                                      │
│    ├─ Search Flickr API for sunset/sunrise tags          │
│    ├─ Filter by license (CC-BY, CC0)                    │
│    ├─ Download images to ml/artifacts/external_images/  │
│    └─ Write metadata CSV (source_url, license, tags)    │
│                                                         │
│  Also scrape negatives (cloudy, night, daytime sky)     │
└───────────────────────┬─────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────┐
│  Step 2: LLM Rate                                       │
│                                                         │
│  llm_rater.py                                           │
│    ├─ Load images (external + existing webcam snapshots) │
│    ├─ Send each to Gemini Flash / GPT-4o-mini           │
│    ├─ Parse structured JSON response                    │
│    ├─ Write ratings CSV:                                │
│    │   image_path, is_sunset, quality, confidence,      │
│    │   has_clouds, color_palette, obstruction,          │
│    │   source (external|webcam), llm_model, timestamp   │
│    └─ Retry/skip on failures                            │
└───────────────────────┬─────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────┐
│  Step 3: Merge into training manifests                  │
│                                                         │
│  Extend export_dataset.py (or new merge_datasets.py):   │
│    ├─ Load existing webcam manifest                     │
│    ├─ Load external ratings CSV                         │
│    ├─ Normalize all labels to 0.0–1.0 continuous scale  │
│    │   (webcam: calculated_rating / 5.0)                │
│    │   (external: quality field directly)               │
│    ├─ Mark source column (webcam|external)              │
│    ├─ Apply webcam-grouped splits as before             │
│    │   (external images get their own split group)      │
│    └─ Write unified manifest CSVs                       │
└───────────────────────┬─────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────┐
│  Step 4: Train on unified dataset                       │
│                                                         │
│  train.py (regression mode, 0.0–1.0 target):            │
│    ├─ Use continuous quality as target (not binary)     │
│    ├─ Add early stopping (patience=4)                   │
│    ├─ Add cosine LR decay                               │
│    ├─ Add dropout on classifier head                    │
│    └─ Evaluate with MAE + correlation, not just F1     │
│                                                         │
│  Binary decisions derived post-hoc:                     │
│    quality >= 0.7 → "great sunset" for archiving        │
│    quality >= 0.5 → "decent sunset" for display         │
└───────────────────────┬─────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────┐
│  Step 5: Deploy via ONNX (existing path)                │
│                                                         │
│  export_onnx.py → aiScoring.ts                          │
│    ├─ Wire up actual image tensor inference              │
│    │   (replace current metadata feature vector)        │
│    ├─ Output: continuous 0.0–1.0 score                  │
│    ├─ Apply threshold for snapshot capture decisions     │
│    └─ $0 ongoing inference cost                         │
└─────────────────────────────────────────────────────────┘
```

---

## Domain shift: webcam stills vs Flickr photos

This is the biggest risk. Flickr sunset photos are:
- Taken with DSLRs/phones by skilled photographers
- Composed intentionally (rule of thirds, foreground interest)
- Often post-processed (saturation boost, HDR)

Our webcam snapshots are:
- Low-resolution fixed-position cameras
- Uncomposed (whatever the camera points at)
- No post-processing, often with compression artifacts

### Mitigation strategies

1. **Train on both, but track source.** Include a `source` column in the
   manifest. Evaluate metrics separately on webcam-only vs external-only
   test sets. If the model scores well on Flickr but poorly on webcams,
   the domain gap is real.

2. **Augment external images to look more like webcams.** Apply transforms
   that simulate webcam quality:
   - JPEG compression artifacts (quality 30–60)
   - Resolution downscale to webcam-typical sizes
   - Slight color desaturation
   - Random crop to simulate fixed camera framing

3. **Weight webcam examples higher in loss.** Since production inference
   runs on webcam images, webcam training examples should matter more.
   A 2:1 or 3:1 webcam-to-external weight ratio prevents the model from
   overfitting to Flickr aesthetics.

4. **Use external data primarily for the "what makes a great sunset"
   signal, not the "what does a webcam look like" signal.** The model
   needs to learn two things: (a) what sunset colors and cloud patterns
   look great, and (b) what webcam images look like. External data
   teaches (a). Webcam data teaches (b). Both are needed.

---

## Cost estimates

| Item | Count | Unit cost | Total |
|------|-------|-----------|-------|
| Flickr API calls (search + info) | ~5,000 | Free | $0 |
| Image downloads (Flickr) | ~5,000 | Free | $0 |
| LLM rating — external images | 5,000 | $0.0001 (Gemini Flash) | $0.50 |
| LLM rating — existing webcam archive | ~4,000 | $0.0001 | $0.40 |
| GPU training time (local or Colab) | 1–2 hours | Free (local) or $0 (Colab free tier) | $0 |
| **Total** | | | **< $1** |

If using GPT-4o-mini instead of Gemini Flash, multiply LLM costs by ~3x.
Still under $3 total.

---

## Implementation order

### Phase 1: LLM rater on existing data (no scraping needed)

Build `llm_rater.py` and run it on the ~4,000 existing webcam snapshots
that already have human ratings. This:
- Validates the LLM prompt against known human labels
- Produces continuous 0.0–1.0 labels for immediate retraining
- Costs < $0.50
- Fixes the label noise problem without any new images

### Phase 2: Flickr scraper + LLM rating

Build `flickr_scraper.py`, download 2,000–5,000 sunset images, rate them
with the validated LLM prompt. This:
- Fixes the class imbalance problem
- Provides diverse high-quality positive examples
- Costs < $0.50

### Phase 3: Unified training

Merge datasets, retrain with regression target, add early stopping + LR
decay + dropout. Compare against current best (F1 0.83 binary) using both
regression metrics (MAE, correlation) and derived binary metrics (F1,
recall) at various thresholds.

### Phase 4: Production deployment

Wire up real image tensor inference in `aiScoring.ts` to replace the
current metadata feature vector. Deploy the regression ONNX model. The
output is a continuous 0.0–1.0 score used for:
- Snapshot capture decisions (quality >= threshold)
- Gallery sorting/ranking
- Display to users

---

## Key decisions for the implementing agent

1. **Start with Gemini 2.0 Flash** for the LLM rater. It has a free tier
   and supports structured JSON output natively. Fall back to GPT-4o-mini
   if Gemini is unavailable or produces poor results.

2. **Use continuous 0.0–1.0 regression**, not binary classification. The
   diagnostics show binary threshold noise is a top root cause of
   overfitting. Continuous labels eliminate this entirely.

3. **Phase 1 first.** Rate existing data before scraping. This validates
   the approach with zero new infrastructure.

4. **Track domain source.** Every image in the training set must be tagged
   as `webcam` or `external`. Evaluate separately. If external-trained
   model does not generalize to webcams, apply the domain shift mitigations
   above.

5. **Do not use the expensive LLM (GPT-4o).** The quality gap on aesthetic
   judgment is not worth 10x the cost. If in doubt, run a 50-image
   comparison between GPT-4o-mini and GPT-4o — expect correlation > 0.85.

---

## Files to create

| File | Purpose |
|------|---------|
| `ml/llm_rater.py` | Send images to vision LLM, get structured ratings, write CSV |
| `ml/flickr_scraper.py` | Search Flickr API, download images, write metadata CSV |
| `ml/merge_datasets.py` | Combine webcam + external manifests into unified training set |
| `ml/configs/v3_regression_llm_labels.yaml` | Experiment config for regression with LLM labels |

Existing files to modify:

| File | Change |
|------|--------|
| `ml/train.py` | Add early stopping, cosine LR decay, dropout on classifier head |
| `ml/export_dataset.py` | Support 0.0–1.0 normalization option for label values |
| `app/api/cron/update-windy/lib/aiScoring.ts` | Wire up real image tensor inference (Phase 4) |

---

## Success criteria

- LLM ratings correlate > 0.80 with human consensus ratings on the
  existing webcam archive
- Unified model (webcam + external) achieves regression MAE < 0.12 on
  webcam-only test set
- Derived binary recall > 0.85 at threshold 0.7 (catching most great
  sunsets)
- Total cost stays under $5 for the entire pipeline
