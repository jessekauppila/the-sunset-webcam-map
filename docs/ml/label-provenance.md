---
title: "Label provenance — who rated what, on which scale"
date: 2026-08-29
status: reference
---

# Label provenance

Four separate label sets exist in this project. They were made by different
raters, on **different scales**, at different times. Mixing them without
knowing which is which has already produced one broken model (see
`docs/superpowers/specs/2026-08-28-v5-gold-label-retrain-design.md` §3, §11).

All counts measured against production **2026-08-29**.

---

## 1. Legacy hand ratings — `webcam_snapshot_ratings` ⚠️ RETIRED, INCOMPATIBLE

| | |
|---|---|
| **Rater** | Jesse, by hand, in the old blind queue |
| **When** | 2025-11-26 → 2026-06-07 (bulk in Feb–Mar 2026: 1,024 + 3,645) |
| **Volume** | 4,776 ratings on 4,749 distinct frames |
| **Scale** | `rating` 1–5 only. **No "not a sunset" option** — `is_sunset_verdict` is populated on exactly **1** row. |
| **Used by** | v2 models only (`--label-source manual_only` / `public_aggregate`). **Not** v3, v4 or v5. |

Rating histogram — and the reason this set cannot be merged with the current one:

| rating | 1 | 2 | 3 | 4 | 5 |
|---|---|---|---|---|---|
| n | **2,940** | 483 | 359 | 537 | 457 |

**62% of this set is rated 1**, mean 1.97. Because the old UI had no "N"
button, **rating 1 absorbed both "not a sunset at all" and "barely a sunset."**
In the current rubric those are two different labels (`N` vs `1`), and the
difference is exactly what the binary head keys on.

**Do not union this set with `manual_labels`.** Its 1s are not the current
rubric's 1s. It fed v2, v2 is retired, and that is where it should stay.

> **Does it need re-rating?** No — not for its own sake. The frames it covers
> are a subset of the archive and can simply be re-labeled through the current
> Hard Examples queue if they are ever wanted. There is no work to redo,
> because nothing downstream of v2 depends on it.

---

## 2. Operator gold labels — `manual_labels` ✅ CURRENT

| | |
|---|---|
| **Rater** | Jesse, in the Hard Examples queue |
| **When** | 2026-06-07 → 2026-08-29, but **8,501 of 8,564 (99.3%) in August 2026** |
| **Volume** | 8,564 (8,220 webcam + 344 Flickr) across 1,055 webcams |
| **Scale** | `is_sunset` boolean + `rating` 1–5 when true. `docs/ml/rating-rubric.md` |
| **Used by** | v5 (`--label-source gold`) |

**Consistency check — the drift worry is unfounded.** The rubric document was
written 2026-08-07. Splitting the set on that date:

| era | n | % rated N | 1s as % of sunsets | mean rating of sunsets |
|---|---|---|---|---|
| before 2026-08-07 | **63** | 95.2% | 0.0% | 2.67 |
| after 2026-08-07 | **8,501** | 58.3% | 14.8% | 3.03 |

Only 63 labels predate the written rubric, and 60 of those are `N`. For
practical purposes **the entire gold set was produced in one consistent
period under one rubric.** No re-rating is needed.

Selection bias to remember: **8,162 of 8,220 webcam labels (99.3%) came from
the disagreement queue**, so this set is the hardest ~15% of the corpus, not a
random sample. Only 8,281 of 55,414 imaged frames were ever flagged hard.

---

## 3. Claude webcam ratings — `webcam_snapshots.llm_*` ✅ CURRENT

| | |
|---|---|
| **Rater** | Claude, via `ml/llm_rater.py` |
| **Prompt** | `v2_extended` — **identical across both campaigns** |
| **Campaigns** | `claude-sonnet-4-5`: 29,705 (2026-05-07 → 05-09) · `claude-sonnet-5`: 16,374 (2026-07-31) |
| **Volume** | 46,079 rated webcam frames; `llm_is_sunset` populated on **100%** |
| **Scale** | `is_sunset` boolean + `quality` 0.0–1.0 |
| **Used by** | v3, v4 (quality only, via CSV); available to v5 via `--llm-label-source db` |

Both campaigns used the same prompt version, so Claude's criteria are
self-consistent. The two model versions are a judge change, not a rubric
change — `llm_model` is stamped per row if that ever needs isolating.

---

## 4. Claude Flickr ratings — `external_images.llm_*` ✅ CURRENT

| | |
|---|---|
| **Rater** | Claude (`claude-sonnet-4-5`), prompt `v2_extended` — same as the webcam campaign |
| **When** | 2026-05-12, one scrape and one rating run |
| **Volume** | 5,872 scraped, 5,767 rated (105 rating failures) |
| **Scale** | Same as §3 |
| **Used by** | v4 (dominated its positive class), available to v5 |

Every row keeps full identity: `source_id` (Flickr photo id, all distinct),
`original_url`, `owner`, `license`, plus a Firebase copy. Both URL forms still
resolve. Category is `sunset` for all 5,872 — **the `negative` category was
never scraped.**

---

## The part that matters: Jesse and Claude are NOT using the same criteria

`docs/ml/rating-rubric.md` presents an alignment between the two scales:

| Jesse | Claude quality |
|---|---|
| 1 | ≈ 0.0–0.10 |
| 2 | ≈ 0.30 |
| 3 | ≈ 0.50 |
| 4 | ≈ 0.70–0.85 |
| 5 | ≈ 0.95 |

**That mapping holds for the quality scale and breaks for the boolean.**

Claude is asked `is_sunset: <boolean — sunset OR sunrise visible?>` with
`0.00 = no sunset/sunrise visible at all`. Jesse's scale has **two** labels that
both land near Claude 0.0:

- **N** — not a sunset event at all → `is_sunset = false`
- **1** — a sunset event *is* happening but there is nothing to see (dusk over
  a field, faint warm line) → **`is_sunset = true`**

So a colourless dusk frame is `is_sunset = true, rating 1` to Jesse and
plausibly `is_sunset = false, quality 0.0` to Claude. **The two booleans answer
different questions**, and every comparison between them is confounded at the
bottom of the scale.

Measured consequences:

- On the 1,096 frames Jesse marked *not* a sunset, Claude called **141** sunsets.
- Across the 1,224-frame overlap the two disagreed **211** times.
- Scoring a Jesse-trained model against `llm_is_sunset` therefore **understates
  it**, by an amount nobody has measured.

### What to do about it

1. **Never treat `llm_is_sunset` as ground truth for an operator-trained
   model.** Use it for gross-failure detection only. The unconfounded
   measurement is an operator spot-check (handoff plan Task 5).
2. **Prefer the quality scales for cross-rater comparison** — they are
   genuinely aligned — and avoid comparing the two booleans.
3. **If the two ever need to agree on the boolean**, the cheaper fix is to
   change Claude's prompt so that "a sunset is occurring but there is no colour"
   returns `is_sunset: true, quality: 0.05`, matching Jesse's `1`. That means a
   re-rating run (~$35–45 for the full archive) and a new `prompt_version` —
   do not silently edit `RATING_PROMPT` without bumping it, since
   `llm_metadata.prompt_version` is what makes campaigns comparable.
4. **For the binary head, sidestep the whole problem**: train on a *rating
   threshold* (≥3 or ≥4) rather than either boolean. Both raters agree far
   better in that region, and it is what the product actually wants.
