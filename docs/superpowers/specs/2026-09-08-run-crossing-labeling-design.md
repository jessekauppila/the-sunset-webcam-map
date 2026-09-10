---
title: "Run-crossing labeling — rating a sunset by where it changes, not what it scores"
date: 2026-09-08
status: design, not approved
---

# Run-crossing labeling

Label a camera's evening by marking the few frames where it **crosses** a
boundary, instead of assigning an absolute rating to every frame. Five marks
per run replace forty ratings, and each mark is a comparison between adjacent
frames under fixed framing rather than a recall of a scale.

This document is a design. Nothing here is built.

---

## Why this and not anything else

Every measurement in the model program points at the same binding constraint.
`2026-08-29-two-scale-model-STATE.md` records it: both heads sit at or above
the operator's own reproducibility, so the limit on rating quality is not the
model, not the volume of labels, and not any covariate.

| operator test–retest, `retest_v1` | value |
|---|---|
| quality self-Pearson | 0.673 |
| detection self-F1 | 0.807 |

And the noise decomposes. Only two label boundaries ever reach a model, because
only two cross a training threshold:

| corpus-weighted label noise | value |
|---|---|
| `is_sunset` flips | 13.6% |
| `rating ≥ 4` flips | 12.6% |

A 2↔3 or 4↔5 wobble costs nothing. So the only work that can improve rating is
work that makes those two boundaries more reproducible.

**Crossing marks attack exactly that.** Within a run the framing is fixed and
the frames are minutes apart, so the operator compares two adjacent images
rather than recalling where a 4 begins. Comparison is the standard remedy for
rater inconsistency on an absolute scale.

**And it is the only proposal that can move the ceiling rather than measure
against it.** The 0.673 / 0.807 figures are test–retest on *absolute ratings*.
If crossing marks reproduce better than absolute ratings do, the ceiling itself
rises and there is headroom again. Every other thread is permanently capped by
those two numbers.

---

## The finding that changes collection

The archive already holds runs. Measured 2026-09-08, sunset phase, last 150
days:

| sunset runs | count |
|---|---|
| 4+ frames within a 30–150 minute window | 1,876 |
| of those, 6+ frames | 1,071 |
| distinct cameras | 1,045 |
| completely unlabeled | 1,729 |

**But those runs are model-selected subsequences, not evenings.** Intake
composition inside the 6+ frame runs, last 45 days:

| intake reason | frames |
|---|---|
| `disagreement` | 4,864 |
| `kiosk_bin` | 2,209 |
| null (pre-column) | 1,842 |
| `high_rated` | 94 |
| `scene_capture` | 81 |
| `trickle` | 66 |

A frame enters the archive mainly because the two heads disagreed about it. The
N-to-1 crossing is precisely where both heads agree that nothing is there, so
those frames are the **least** likely to have been retained. The boundary
carrying 21 of the 35 ceiling disagreements is the one the intake filter drops.

This is the archive-drift failure the `SAVE_RANDOM_TRICKLE_RATE` control arm
exists to counter, and at 2% that arm is far too sparse to rebuild runs from —
886 trickle frames over 45 days across a thousand cameras.

**Consequence, and it splits the work cleanly:**

- Derived labels from archive runs are **not trustworthy training data**. The
  gaps between retained frames are non-random and unbounded.
- The **reproducibility experiment is still valid on them**, because it
  compares the same operator against himself on the same frames. Sampling bias
  does not confound a self-agreement measurement.

So the archive funds the experiment, and new collection funds the labels.

---

## Leg 0 — collect uniform runs

Add an intake reason `run`. A bounded panel of cameras retains **every scored
frame in both solar windows** on every day, regardless of model score.

**Both phases, not sunset only.** A run is one camera and one solar event, so a
panel camera produces two runs a day: a sunrise and a sunset. Three reasons,
and the first is the one that decides it.

- The two boundaries this whole design exists to sharpen, `is_sunset` and
  `rating >= 4`, are not sunset-specific. A sunrise crossing teaches them the
  same thing, and the corpus is measurably short of sunrise: the leaderboard
  fix of 2026-09-08 found the Best Sunsets top hundred was half sunrises, which
  is what a phase-blind archive looks like from the outside.
- The panel runs in reverse through a sunrise, so the same camera under the
  same framing supplies a rising arc and a falling one. That is a stronger
  anchor pair than two sunsets, and it costs one boolean.
- The Instagram prelude bank wants alternating sunrise and sunset carousels and
  has no other source of whole, unclipped runs. Sunset-only capture funds half
  a feed.

- **Panel size: 60 cameras.** At the 10-minute cron cadence and a ~90 minute
  window that is roughly 9 frames per camera-event. Two events a day is ~1,080
  frames/day and ~32k/month. Current `disagreement` intake alone ran ~32k
  frames in seven days, so the panel is still under a quarter of what the
  archive already takes, and the flag turns it off without a deploy.
- **Panel selection:** cameras with the most operator-confirmed events and
  stable framing, spread across longitude so runs land at different UTC hours.
  Seeded once from `manual_labels`, stored explicitly, not recomputed per tick.
  The seed reads `manual_labels.is_sunset`, which is the operator saying a sky
  event happened, not a phase. Sunrise-good cameras are already in it.
- **Fixed panel, slow rotation.** The anchor-pair value comes from the *same*
  camera under different skies. Camera diversity is already abundant elsewhere
  in the corpus.
- **Behind a runtime flag** (`scripts/set-runtime-flag.mjs`) so it can be
  turned off without a deploy.

`intake_reason = 'run'` keeps these frames separable forever, which is the
whole point of that column.

**The capture gate is camera membership, never phase.** Nothing in the persist
path asks which event this is, so retaining both phases is the absence of a
filter rather than a second code path. Two things follow, and both are easy to
get wrong later:

- `webcam_snapshots.phase` is stamped `'sunset'` unconditionally at
  `app/api/cron/update-cameras/route.ts:340`, and the reason is structural, not
  laziness: Windy scoring runs earlier in the tick than the sunrise/sunset
  classification step, so at write time the phase is genuinely not known yet.
  That column is therefore wrong on roughly half the panel's rows. Nothing here
  reads it and nothing here should — run identity comes from geometry via
  `solarPhaseAt`, which is also the standing finding that the stored phase is
  17% wrong anyway. Left alone deliberately. Fixing it means reordering the
  cron, which is a separate decision with its own blast radius.
- "Evening" throughout the plan is shorthand for one solar event. `runKey` is
  already keyed on camera, phase and local solar date, and already has a test
  keeping a camera's sunrise and sunset apart on the same day.

### Timing

Leg 0 touches the `update-cameras` cron. The show is Friday 2026-09-12 and the
freeze is Wednesday 09-10. **Build it now, merge it after the show.** Four lost
evenings of clean runs is cheap; a broken cron during show week is not.

---

## Leg 1 — the crossing queue

A new mode in the Hard Examples surface that serves a **whole run** as a
filmstrip and captures five marks.

### The five marks

| mark | question |
|---|---|
| `sky_in` | first frame with usable sky |
| `sky_out` | last frame with usable sky |
| `carry_in` | first frame where the warm light carries the frame |
| `carry_out` | last such frame |
| `peak` | the best frame in the run |

Every mark is nullable, and null is a real answer: an evening that never
develops usable sky has no `sky_in`, and an evening that never reaches a 4 has
no `carry_in`. A queue that cannot record "it never crossed" would silently
invent crossings.

### Order and blinding

Marks are captured in the order above, boundaries first and `peak` last, so the
spectacular frame does not anchor the boundary judgments. No model scores, no
Claude scores, and no prior-pass marks are visible while marking. Blind is the
default everywhere else in this project and there is no reason to break it here.

### What the marks derive

| region | derived label |
|---|---|
| before `sky_in`, after `sky_out` | `is_sunset = false` |
| `sky_in` → `carry_in`, `carry_out` → `sky_out` | `is_sunset = true`, `rating < 4` |
| `carry_in` → `carry_out` | `is_sunset = true`, `rating ≥ 4` |

That is exactly the two labels that reach a model, and nothing else. The
derivation deliberately produces **no** 1/2/3 distinction, because that
distinction has been measured to cost the model nothing.

### Storage

- New table `run_crossings`, keyed by run, pass number and rater.
- **Never written to `manual_labels`.** Derived labels are correlated within a
  run; `manual_labels` rows are treated as independent everywhere downstream.
  Pooling them would repeat the mistake `docs/ml/label-provenance.md` exists to
  prevent.
- Derived per-frame labels are computed at **export** time from crossings and
  carry their own label source, so a training run includes or excludes them by
  flag rather than by archaeology.

### Run identity

A run needs a real identity, materialized once.

- A run is **camera + phase + solar window**, not camera + a fixed UTC offset.
  The `captured_at - interval '6 hours'` grouping used in the probe above is
  wrong for any camera whose sunset straddles UTC midnight, and would split one
  evening into two runs.
- Splits already group by `webcam_id`, and a run lives inside one camera, so
  runs cannot straddle train and test. Nothing about the existing split logic
  needs to change.

---

## The pre-registered question

**Do crossing marks reproduce better than absolute ratings?** Registered before
any second pass exists, in the style the model program already uses.

- Second pass over the same runs, blind, at least 14 days after the first.
- For each crossing, measure the displacement in frames between passes, and
  convert it to the implied `is_sunset` and `rating ≥ 4` flip rate over the
  frames of the run.
- **Bar:** the flip rates must beat the absolute-rating baselines of
  `is_sunset` 13.6% and `rating ≥ 4` 12.6%. Gains under 2 percentage points
  count as a wash, consistent with every other bar in this program.
- **If the bar fails:** the method does not help, the ceiling stands, and no
  derived label ever enters training. That outcome is a real result and closes
  the question cheaply.

The second-pass mechanism must exist in the schema from day one. It is the
whole experiment, and `manual_label_retests` is the precedent for keeping a
second pass physically separate from the first.

---

## Non-goals

- **No model training in this work.** No retrain is proposed or justified until
  the bar above is cleared.
- **No weather join.** Cloud cover is retrievable retroactively from ERA5 for
  any coordinate and hour, so it is not time-sensitive. It is demoted to a
  sampling aid, used only if the run panel needs stratifying so that 200 runs
  are not all one weather regime.
- **Runs never enter eval draws.** Evaluation stays a random frame draw from
  the ordinary distribution. Correlated frames would collapse the effective
  sample size and make a confirmation set lie.
- **Custom-camera capture with locked exposure is a later leg.** Windy cameras
  auto-expose, so brightness is normalized across a run and the "sky is the
  brightest thing in the frame" test is not photometrically pure. This does not
  block anything, because the operator and the model both judge the rendered
  frame. It does mean the *tightest* anchor pairs still want own hardware, at
  seconds apart under locked exposure rather than ten minutes apart under auto.

---

## Open decisions

1. **Panel size.** Recommending 60 cameras on the cost arithmetic above.
2. **Whether derived labels ever train anything.** Recommending this stays
   undecided until the reproducibility bar is settled. If crossings turn out to
   be a better *measuring* instrument than a labeling one, that is still a win,
   because it would give a cheaper ceiling test than a full retest sitting.
