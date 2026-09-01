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

- **N** — no usable sky: sky absent or only a sliver at the frame edge, fully
  obstructed/fogged/rained out, or full dark. *(Not "no sunset is happening" —
  the queue is drawn from the sunset window, so that is true of almost every
  frame and carries no information. See the 1-vs-N section below.)*
- **1** — a readable sky in twilight light, with no colour in it: flat gray
  overcast, blue hour. (≈ Claude 0.0–0.10)
- **2** — trace of color, weak and washed out; you'd scroll past it. (≈ 0.30)
- **3** — real sunset color, unremarkable. The honest middle — use it freely,
  don't round up. Colour you can name, in a frame that still reads dark.
  (≈ 0.50)
- **4** — the warm light **carries the frame**: the sky is the brightest thing
  in it, not merely the least dark thing. Crosses the line into "show this."
  (≈ 0.70–0.85)
- **5** — dramatic/spectacular; the reason the project exists. Genuinely rare.
  (≈ 0.95)

The 3-vs-4 line is the one that decides a training label and the one the
operator is measurably least consistent on (80% churn — see **Boundary
sharpening** below). Anchor frames for it live in that section; open them
before a sitting.

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

## Boundary sharpening — anchor frames (measured 2026-08-31)

The `retest_v1` sitting re-rated 146 already-labeled frames blind
(`ml/artifacts/reports/retest_v1_ceiling.json`). It settled the ceiling
question — self-Pearson 0.673 vs the model's 0.697, so global metrics are
done — but the confusion matrix also says exactly **where** the operator
disagrees with himself, and those two places are fixable.

**The only churn that reaches a model is `is_sunset` and `rating ≥ 4`.**
A 4↔5 wobble costs nothing (both are the positive class); so does 2↔3. Only
two boundaries change a training label. Re-weighted to the gold corpus's own
composition (N 59.8%, 1: 6.2%, 2: 7.6%, 3: 11.2%, 4: 10.6%, 5: 4.5%):

| stratum | corpus weight | retest n | flips `is_sunset` | flips `rating ≥ 4` |
|---|---|---|---|---|
| N | 59.8% | 40 | 5% | 0% |
| 1 | 6.2% | 47 | **45%** | 0% |
| 2 | 7.6% | 14 | 14% | 14% |
| 3 | 11.2% | 15 | 13% | 13% |
| **4** | 10.6% | 15 | 47% | **80%** |
| 5 | 4.5% | 15 | 7% | 33% |
| **corpus-weighted** | | 146 | **13.6%** | **12.6%** |

Two conclusions, and they point in different directions:

- **Rating 4 is the noisiest label in the set.** Four in five frames rated 4
  come back with the opposite `rating ≥ 4` training label. Restricted to the
  current rubric regime (originals labeled 2026-08-26 → 08-30, excluding the
  2026-08-08 cohort below), it is still 4 of 7 — and every one of those drops
  to a **3**, never to N. This is a real boundary problem and the anchors
  below are the fix.
- **The 1/N line is a coin flip (45%), but it only feeds the frozen detection
  head.** Every one of the retest's 35 detection disagreements is either a
  1↔N call (21) or a 2026-08-08 frame (14) — zero residual: on the 39 frames
  that are neither, agreement is 39/39. See "The 1-vs-N line" below.

### The 3-vs-4 line — what a 4 actually looks like

Every anchor is a real frame from `retest_v1`, with the retest's own second
call. Nothing here is invented; open them side by side before a sitting.

**The cleanest pair — same camera, same framing, four days apart**
(webcam 28999873, "Kohtla-Jarve linn › North: Kohtla-Nõmme", both
captured 22:0x local):

| | frame | second call | what to look at |
|---|---|---|---|
| **4** | snapshot **124555** | rated **5** on retest | a broad saturated orange band that is the **brightest thing in the frame** — it lights the horizon well above the terrain line |
| **3** | snapshot **123667** | rated **3** on retest | same camera, same hour: a gray cloud deck with a thin dull orange line at the horizon only. Color is *present*, the frame still reads dark |

The variable is isolated: same scene, same optics, same time of day. The
difference is not *whether* there is color, it is whether the warm light
**carries the frame**.

> **The test: is the sky the brightest thing in the frame, or just the least
> dark thing in it?** A 4's warm band reads as a light source. A 3 has colour
> you can name but the frame still reads as a dark scene.

**Held as 4 on retest (use these as the floor of the category):**

- snapshot **123658** (webcam 28836338, Orebić Riva ferry, Korčula) — clean unbroken
  orange → peach → blue gradient across the whole sky. No drama, no
  structure, nothing spectacular; it is a 4 on brightness and saturation
  alone. *This is the frame to compare a candidate against.*
- snapshot **85211** (webcam 7439776, Northern Saskatchewan) — a low warm sun band
  over snow. Sparse and plain, still unmistakably lit.

**Rated 4, came back 3 (these are the ones the anchors have to catch):**

- snapshot **121809** (beach + palm) — mauve and pink, but dim and murky;
  the frame reads as night with tint.
- snapshot **120494** (cloud sea) — a dusty pink band over fog. Pretty
  structure, low luminance. **Structure is not brightness** — an interesting
  shape does not lift a 3 to a 4.
- snapshot **125073** (lake at dusk) — pastel wash over a dark foreground.
- snapshot **123667** — the pair frame above.

The common error is clear from the four of them: **being drawn in by an
interesting scene and rating the composition rather than the light.** The
existing habit "judge the sky, not the framing" already says this; these
four are what violating it looks like.

**The 4/5 line barely matters** — it never changes a training label — so do
not agonise over it. For reference, snapshot **122617** (saturated orange
wash, silhouetted trees, dark cloud bar) was originally a 5 and came back a
4; either call trains the model identically.

### The 1-vs-N line — a definition problem, not an anchor problem

45% of rating-1 frames flip to N on a second pass. The cause is in the
definition: **1** currently means "a sunset event is happening but the frame
has nothing," which asks about the *sun's position* — information the frame
does not contain.

**Tested and rejected: showing solar elevation in the queue.** The obvious
fix is to put the sun's altitude on screen and turn the judgment into a
lookup. Measured on these 146 frames, it does not work — solar elevation
does not separate the calls at all:

| | n | median elevation | inside −8°…+6° |
|---|---|---|---|
| 1 → 1 (held) | 17 | −7.6° | 71% |
| 1 → N (flipped) | 21 | −6.9° | 67% |
| retest = N (all) | 71 | −6.6° | 61% |
| retest = sunset (all) | 75 | −6.3° | 69% |

A twilight-window rule would have agreed with the operator's own second call
on 25 of 47 rating-1 frames — 53%, i.e. chance. The reason is structural:
the queue is *already* drawn from the sunset window, so "is a sunset event
occurring" is true for nearly every frame in it by construction and carries
no information. **Do not build the solar readout.**

What the operator is actually deciding, read off the frames, is whether
there is a **usable sky** in the picture:

- snapshot **123236** (pre-dawn harbour, held as **1**) — sky visible, water
  and air clearly lit by blue hour, simply no warm colour.
- snapshot **125460** (warehouse roof, flipped to **N**) — a building fills
  the frame; the sky is a pale strip at the top edge. Incidental, not
  readable.

So state the boundary as something visible:

> **N** — the frame gives you no usable sky: sky absent or filling only a
> sliver, fully obstructed/fogged/rained out, or full dark.
> **1** — a readable sky in twilight light, with no colour in it.

This is a cheap edit and it makes the call reproducible. Its value is
limited, though: rating 1 is 6.2% of the corpus, so 45% churn is only ~2.8%
label noise, and it lands entirely on the **detection head, which is frozen
and already at the operator's own reliability** (self-F1 0.807 vs the head's
~0.80). Fix the definition because a coin-flip label is worth fixing; do not
expect a metric to move.

### Anchor frame links

| snapshot | role | frame |
|---|---|---|
| 124555 | 4 → retest 5 — the bright anchor | [open](https://storage.googleapis.com/sunrisesunset-32a25.firebasestorage.app/snapshots/28999873/1787167854413.jpg) |
| 123667 | 4 → retest 3 — the pair frame | [open](https://storage.googleapis.com/sunrisesunset-32a25.firebasestorage.app/snapshots/28999873/1786821350825.jpg) |
| 123658 | 4 → retest 4 — the floor of the category | [open](https://storage.googleapis.com/sunrisesunset-32a25.firebasestorage.app/snapshots/28836338/1786818653303.jpg) |
| 85211 | 4 → retest 4 | [open](https://storage.googleapis.com/sunrisesunset-32a25.firebasestorage.app/snapshots/7439776/1773495333618.jpg) |
| 121809 | 4 → retest 3 | [open](https://storage.googleapis.com/sunrisesunset-32a25.firebasestorage.app/snapshots/5973565/1786203942870.jpg) |
| 120494 | 4 → retest 3 | [open](https://storage.googleapis.com/sunrisesunset-32a25.firebasestorage.app/snapshots/13588772/1785793569005.jpg) |
| 125073 | 4 → retest 3 | [open](https://storage.googleapis.com/sunrisesunset-32a25.firebasestorage.app/snapshots/4600867/1787364061527.jpg) |
| 122617 | 5 → retest 4 — the 4/5 line, costs nothing | [open](https://storage.googleapis.com/sunrisesunset-32a25.firebasestorage.app/snapshots/29232682/1786473955296.jpg) |
| 123236 | 1 → retest 1 — readable sky, no colour | [open](https://storage.googleapis.com/sunrisesunset-32a25.firebasestorage.app/snapshots/4769517/1786679148223.jpg) |
| 125460 | 1 → retest N — sky is a sliver | [open](https://storage.googleapis.com/sunrisesunset-32a25.firebasestorage.app/snapshots/12987447/1787515304495.jpg) |
| 83222 | 2026-08-08 cohort: rated 4, retest N | [open](https://storage.googleapis.com/sunrisesunset-32a25.firebasestorage.app/snapshots/2270/1773467305230.jpg) |
| 115440 | 2026-08-08 cohort: rated 4, retest N — no sky in frame | [open](https://storage.googleapis.com/sunrisesunset-32a25.firebasestorage.app/snapshots/2942798/1784403058361.jpg) |
| 107023 | 2026-08-08 cohort: rated 4, retest N | [open](https://storage.googleapis.com/sunrisesunset-32a25.firebasestorage.app/snapshots/28819232/1782073875683.jpg) |

### ⚠️ The 2026-08-08 cohort — 592 labels on a different scale

The retest's single largest source of disagreement is one labeling session.
Of the 24 frames from **2026-08-08** that were originally rated 2/3/4/5,
**zero came back at the same rating and every one of them moved down** —
7 of 8 "4"s came back **N**. From the same session, N labels are 94% stable
(31/33), so this is not memory decay; the positive scale specifically was
shifted.

Three independent signals agree the *original* labels are the wrong ones:

1. Claude, a wholly separate instrument, scores all seven of the 4 → N
   frames at `llm_quality` 0.00–0.05 with `llm_is_sunset = false`.
2. The frames themselves are not borderline. Snapshot **83222** is flat gray
   overcast sea with no sky colour whatsoever; **115440** is a close-up of a
   breaking wave with **no sky in frame at all**; **107023** is a blown-out,
   out-of-focus beach. These are N under any reading of the scale.
3. Every move was downward. Twenty-four of twenty-four in one direction is
   not noise.

**Size the cohort carefully — the session was mostly Flickr.** Its 592
labels split as webcam 452 `N` + **24 positives**, and Flickr 36 `N` + 80
positives (76 of those rated 5). The retest draws webcam frames only, so:

| | n | retested | verdict |
|---|---|---|---|
| webcam positives | 24 | **24 (all)** | every one overturned |
| webcam `N` | 452 | 33 | 94% stable — leave alone |
| Flickr positives | 80 | **0** | **untested; probably fine** |
| Flickr `N` | 36 | 0 | untested |

So the evidenced contamination is **24 labels, not 104** — of which **10
cross the `rating ≥ 4` line** and 12 flip `is_sunset`. Against 1,237 webcam
`≥ 4` gold labels that is **0.8%**, not the 6.1% a naive count of the whole
cohort suggests. A curated Flickr sunset photograph rated 5 is most likely
*correct*; do not "correct" frames no second pass has actually seen.

Excluding the whole cohort raises measured quality self-Pearson 0.673 →
**0.751** and detection self-F1 0.807 → **0.853**, but that is a statement
about the retest sample, not a forecast of model gain.

**Applied by `ml/apply_label_corrections.py`** (dry-run by default), which
copies the retest ratings onto the 24 gold rows, archiving each original into
`manual_label_supersessions` in the same transaction. No new sitting was
needed — the retest had already re-rated exactly those frames blind. Expect
**no measurable change in any GLOBAL metric** from 24 labels in 9,118 — but
see the ordering note below: one per-camera calibration multiplier does move.
It is worth doing
because the labels are demonstrably wrong and the corrections were already
paid for.

> **⚠️ Ordering: apply these corrections BEFORE the per-camera calibration
> evidence pass.** The corrections are not self-contained — the calibration
> lane's `ml/audit_camera_errors.py --emit-evidence` reads exactly these
> `manual_labels` rows to build a durable evidence table, and 4 of the 12
> `is_sunset` flips are frames the shipping head shows. Emitting first would
> archive those 4 rows with the wrong `is_negative` and they would not
> self-correct later.
>
> Correct order: migrations (`20260831_manual_label_supersessions.sql`,
> `20260831_snapshot_intake_reason.sql`, `20260901_camera_calibration.sql`)
> → `ml/apply_label_corrections.py --apply` → `--emit-evidence`.
>
> Verified jointly with the calibration lane on 2026-09-01, replayed over the
> 9,118 frozen frames in `ml/artifacts/reports/audit_frames_v1.csv`
> (arithmetic only, no rescoring needed): false-shows 169 → **173**,
> operator-N 5,538 → **5,550**, tempered set **17 → 17 with an empty symmetric
> difference**. No camera is newly tempered — of the 15 cameras sitting at
> exactly 2 false-shows, none cross. But one already-tempered offender does
> move: **webcam 3914190 goes 5 → 6 false-shows and its multiplier shifts
> 0.750 → 0.727.** So "no metric moves" is false at the per-camera level even
> though it holds for set membership and for every global metric.
>
> The rule that makes this safe (≥3 false-shows across ≥2 distinct capture
> days, so a single corrected frame can never temper a camera) belongs to the
> calibration lane — see
> `docs/superpowers/specs/2026-08-31-per-camera-calibration-design.md` and
> `docs/superpowers/plans/2026-09-01-per-camera-calibration-leg1.md` for the
> constants rather than trusting a copy here. Both land via that lane's PR;
> if the path 404s, it has not merged yet.

*Adjacent, not addressed here:* Flickr supplies 194 of the 1,431 `rating ≥ 4`
gold labels (13.6% of the positive class). Given the standing "Flickr is
fine-tune poison" finding from v4, whether hand-labeled Flickr gold belongs
in the fine-tune export at all is worth its own decision.


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
