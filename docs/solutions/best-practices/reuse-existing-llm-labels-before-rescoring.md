---
title: Check for existing LLM labels before paying to re-score a corpus
date: 2026-06-09
category: docs/solutions/best-practices
module: ml-scoring
problem_type: best_practice
component: ml_data_pipeline
severity: medium
applies_when:
  - About to run Claude (or any paid LLM) to score/label a corpus of images or text
  - Planning or estimating spend for a "score X with Claude" task
  - The corpus may have been scored before to produce training labels
  - Writing a plan whose cost gate is "needs Anthropic spend approval"
tags: [ml, llm-labels, claude, cost, data-provenance, flickr, external-images, planning]
---

# Check for existing LLM labels before paying to re-score a corpus

## Context

A Phase 3 plan carried a unit (U6) gated on "needs Anthropic spend approval for
Claude-over-Flickr." The gate was a phantom: the Flickr corpus had **already**
been scored by Claude — those exact labels are what the v4 regression model was
trained on. The plan was about to budget (and seek approval for) work that was
finished months earlier, and would have re-paid for ~5.7k LLM calls.

The trap is structural: training labels and "let's score this for the app" feel
like different tasks, so the second one gets planned from scratch without
checking whether the first already produced the data.

## Guidance

Before planning, estimating, or running any LLM-scoring pass over a corpus,
**look for labels that already exist**. Check, in order:

1. **The DB columns.** Any `llm_*` columns on the relevant table
   (`external_images.llm_quality`, `llm_is_sunset`, `llm_model`, `llm_rated_at`,
   …). A populated `llm_rated_at` + `llm_model` is proof a paid pass already ran.
2. **The on-disk rating exports.** `ml/artifacts/llm_ratings/ratings_<ts>.csv` —
   these are the durable record of every LLM scoring pass (record_id,
   source_table, image_url, llm_quality, llm_is_sunset, llm_model, …), and
   survive even if the DB rows were dropped.
3. **The training manifests.** `ml/artifacts/experiments/<run>/dataset/<ts>/manifest_*.csv`
   carry `label_source` + `label_value`; `label_source = "llm"` means the
   `label_value` IS the Claude score. If a model trained on the corpus, the
   labels exist by definition — `export_dataset.py` builds manifests from
   `external_images WHERE llm_quality IS NOT NULL`.

Only the **missing** judges need a run. For Flickr that was the *model* (ONNX
regression/binary) score, not Claude — so the remaining work is a TS model
backfill (zero LLM spend), and the "Anthropic spend approval" gate disappears.

## Why This Matters

- **Cost.** Re-scoring a corpus you already paid to score is pure waste; the
  ~5.7k Flickr calls here were already spent in May.
- **Consistency.** Reusing the existing labels keeps the app's "Claude judge"
  identical to the one the model trained against (`claude-sonnet-4-5`). A fresh
  re-score could drift (different model version/prompt) and silently change what
  "Claude says" means relative to training.
- **Plan correctness.** A spend gate that doesn't actually exist distorts
  sequencing and approvals. Removing it turned Phase 3 from "blocked on spend
  approval" into "pure code + one env flip."

## When to Apply

Any time a plan or task says "score / rate / label X with an LLM," and X is a
corpus (not a single new item). Especially when X overlaps a training set — if a
model was trained on it, the labels are findable.

## Examples

**Concrete instance (Flickr).** The Claude scores were found in two places:

```
# Durable on-disk record — 5,747 Flickr images, claude-sonnet-4-5
ml/artifacts/llm_ratings/ratings_20260512_204416.csv
#   columns: record_id, source_table='external', image_url, llm_quality,
#            llm_is_sunset, llm_confidence, llm_model, rated_at, ...

# In the DB (populated at the 2026-05-13 training export)
SELECT count(*) FROM external_images
WHERE source = 'flickr' AND llm_quality IS NOT NULL;   -- ~5,767
```

**The verify-or-reimport gate** that replaced the spend gate:

```sql
-- If this returns ~5,767, the labels are intact — reuse them.
-- If it returns 0, the DB rows were lost; re-import from the CSV above
-- (still no Claude spend) rather than re-running the rater.
SELECT count(*) FROM external_images
WHERE source = 'flickr' AND llm_quality IS NOT NULL;
```

Related: the `ml/llm_rater.py --source external --write-to-db` path is what
*originally* populated these — re-running it is the expensive thing this practice
exists to avoid when the data is already present.
