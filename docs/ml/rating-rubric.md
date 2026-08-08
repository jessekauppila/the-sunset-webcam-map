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
