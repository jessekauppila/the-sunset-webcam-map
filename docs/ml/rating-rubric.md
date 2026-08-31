---
title: "Manual label rubric — the 1–5 sunset quality scale"
date: 2026-08-07
status: reference
---

# Manual label rubric

The scale used when labeling frames in the **Hard Examples** queue. A condensed
version renders under the rating buttons in the UI
(`app/components/HardExamples/HardExamplesQueue.tsx`); this is the long form.

These labels are the operator gold set for v5 training (`manual_labels`), so the
only thing that matters is that the scale stays **consistent across sessions**.

## Mechanics

One keystroke captures both halves — the number *is* the "yes":

| Key | Writes to `manual_labels` |
|---|---|
| `1`–`5` | `is_sunset = true`, `rating = <key>` |
| `N` / `0` | `is_sunset = false`, `rating = NULL` |
| `space` | skip — no row written, frame stays in the queue |
| `z` | undo — deletes the row, frame returns to the queue |

Blind mode is ON by default: the judges stay hidden while you rate and reveal
after submit, so the label isn't anchored to the model's guess.

## The scale

- **N** — not a sunset event at all: daytime, night, indoor, lens fully
  fogged/rained out, or sky entirely obstructed.
- **1** — sunset is happening but the frame has nothing: flat gray overcast,
  zero color. (≈ Claude 0.0–0.10)
- **2** — trace of color, weak and washed out; you'd scroll past it. (≈ 0.30)
- **3** — real sunset color, unremarkable. The honest middle — use it freely,
  don't round up. (≈ 0.50)
- **4** — vivid; you'd stop and look. Crosses the line into "show this."
  (≈ 0.70–0.85)
- **5** — dramatic/spectacular; the reason the project exists. Genuinely rare.
  (≈ 0.95)

The `≈` values are the 0.0–1.0 anchors Claude is given in `RATING_PROMPT`
(`ml/llm_rater.py:77`), so operator labels and LLM scores stay comparable.

## Why 4 is the only boundary that matters

Ratings normalize as `(rating - 1) / 4` (`ml/export_dataset.py:62`), and the
binary head trains on `binary_threshold = 0.75` — which is **rating ≥ 4**:

| Rating | Normalized | Binary label |
|---|---|---|
| 1 | 0.00 | negative |
| 2 | 0.25 | negative |
| 3 | 0.50 | negative |
| 4 | **0.75** | **positive** |
| 5 | 1.00 | positive |

So the question on every frame is really: *would I want this surfaced on the
map?* Yes → 4 or 5. No → 1–3. The 2-vs-3 distinction only feeds a future
regression head; the 3-vs-4 line is what the shipped model learns.

## What the scale actually taught the model (measured 2026-08-29)

The v5 is-sunset head, trained on `is_sunset` (i.e. **rating ≥ 1**), scores the
gold test split like this — broken out by the operator rating:

| your rating | n | mean model score | % scored ≥ 0.5 |
|---|---|---|---|
| **N** (not a sunset) | 682 | 0.437 | **43%** |
| 1 | 57 | 0.658 | 67% |
| 2 | 100 | 0.812 | 83% |
| 3 | 137 | 0.936 | 97% |
| 4 | 135 | 0.974 | 99% |
| 5 | 54 | 0.983 | 100% |

**The model learned the rubric.** Its score rises monotonically with the
rating, and it is near-certain on 4s and 5s. The scale is doing its job as a
quality ordering.

**But `is_sunset` is the wrong training target for the product.** A rating of
1 means "a sunset event is occurring and there is nothing to see" — dusk light
over a field, a faint warm line on the horizon — and it writes
`is_sunset = true`. So the binary head is taught that dim, near-colourless
scenes are positives, and it generalizes that to ordinary frames: on a 2,000
frame sample of ordinary (non-hard-case) frames it fired on 54.7% against a
43.0% base rate, with precision 0.574. Raising the decision threshold does not
fix it — precision only reaches 0.637 at 0.90, and balanced accuracy stays flat
near 0.65 across the whole sweep.

This document already said the real question is *"would I want this surfaced on
the map?"* — that is the **rating ≥ 4** line, not `is_sunset`. The binary head
should be trained on a rating threshold, not on the boolean.

**Implication: no relabeling is needed.** The 1–5 ratings already encode the
distinction; only the label derivation in `ml/export_dataset.py` has to change
(`--binary-label-from is_sunset` → a rating-threshold mode). See
`docs/superpowers/specs/2026-08-28-v5-gold-label-retrain-design.md` §11.

### Where the rubric and Claude's prompt disagree

Claude's `RATING_PROMPT` (`ml/llm_rater.py`, prompt version `v2_extended`, also
quoted in `ml/OPERATING_GUIDE.md` §4) asks for `is_sunset: <boolean — sunset OR
sunrise visible?>` and anchors quality at `0.00 = no sunset/sunrise visible at
all`, `0.10 = barely any color, mostly gray or dark`.

That boolean is **not** the same question as this rubric's. A colourless dusk
is a **1** here (`is_sunset = true`) and is plausibly `is_sunset = false,
quality 0.0` to Claude. On the 1,096 frames the operator marked *not* a sunset,
Claude called 141 of them sunsets; on the 1,224-frame overlap the two disagreed
211 times in total. **Treat `llm_is_sunset` and operator `is_sunset` as
different measurements, not as agreement/disagreement on the same one.**

---

## Two habits that keep the set clean

1. **Judge the sky, not the framing.** A great sky behind a power line or
   through a smeared lens is still a great sky — this is the silhouette-sunset
   blind spot the manual labels exist to correct.
2. **Don't inflate 5.** If more than ~5% of labels are 5s, the top of the scale
   stops carrying information.

## Known inconsistency

`ml/validate_llm_ratings.py:78` normalizes human ratings as `rating / 5.0`
rather than `(rating - 1) / 4`. Only that validation script uses it, but its
human/LLM correlation numbers sit on a different footing than the training
labels.
