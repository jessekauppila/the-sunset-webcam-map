---
title: "Quality ceiling measurement and labeling roadmap"
date: 2026-08-30
status: parked — deliberately not executing yet
---

# Quality ceiling & labeling roadmap

> **Status: Phase 0 BUILT (2026-08-30) — awaiting the operator sitting.**
> Implementation plan: `2026-08-30-retest-draw-implementation.md`, executed on
> branch `feat/retest-draw`. `retest_v1` is loaded (150 frames: 15 per rating
> 1–5, 40 N, 35 rating-1; seed 20260830) and the Hard Examples queue has a
> **Retest** toggle showing 0/150. Re-ratings land in `manual_label_retests`
> (never `manual_labels`); the export quarantine is scoped to `kind='draw'`
> (row counts verified unchanged: gold 8371+344, llm 58323). After the
> sitting: `.venv/bin/python ml/analyze_retest.py --sample-name retest_v1`
> prints the pre-registered verdict. Phases 1–2 remain gated on it.
>
> Companion to `2026-08-29-two-scale-model-STATE.md` (read that first — it
> holds the settled findings this plan builds on).

**Goal:** decide, with a measurement instead of a feeling, whether the rating
models have real headroom — and only then spend labeling effort where the
measurement says it pays.

## Decisions settled in the 2026-08-30 conversation (don't re-litigate)

1. **Detection head is frozen.** Three "improvements" (retrain, warm start ×2)
   failed to replicate on fresh operator draws; the old head is stable at
   0.776–0.816 F1 across four independent eval sets. The standing rule from
   STATE holds: any detection win not confirmed on a fresh operator draw is
   noise. Remaining detection work is failure modes, not the global metric.
2. **"Closer to 1" is not a coherent target until the ceiling is measured.**
   Both labels are subjective judgments; no model can agree with the operator
   more consistently than the operator agrees with himself. Self-correlation
   (test–retest) is the ceiling. Measuring it is Phase 0 and gates everything
   else. Intuition check, because it reads backwards: **high** self-consistency
   means **more** model work is justified (the gap is the model's fault);
   **low** self-consistency means the model is already near the best possible
   (the gap is label noise).
3. **Pearson ~0.68 and F1 ~0.80 are different metrics on different tasks** —
   the gap between them says nothing about the quality head "lagging."
4. **Flickr stays out of fine-tune data.** v4's positive class was 97.5%
   Flickr and it scored F1 0.08 against operator labels — it learned
   "beautiful composed photo," not "sunset from a fixed webcam." Flickr's
   5,767 rows stay in the LLM pretrain corpus only. Do not collect more for
   training; the product scores webcam frames.
5. **Images are not the constraint; labels are.** ~46k webcam rows banked,
   high-rated intake (`SAVE_HIGH_RATED_SNAPSHOTS`) adds more every 15 min.
   Nothing deletes anything (`CLEANUP_ENABLED = false`, no cron). Waiting to
   accumulate more images buys nothing.
6. **Same-camera-pool skew:** eval is already immune (splits group by
   `webcam_id`; eval draws use unseen cameras). The real bias is the
   **model-gated intake feedback loop** — frames are saved only when the
   incumbent model likes them or disagrees with Claude, so the archive drifts
   toward what the incumbent already understands. Mitigation is the
   trickle-save side item below, plus new custom cams adding unseen scenes.
7. **Claude re-rating spend stays PARKED** (pre-registered rule in STATE; the
   last quality win cost zero API spend).

---

## Phase 0 — Retest draw: measure the operator ceiling ⭐ gate for everything

One labeling sitting (~150 frames). Cheapest decisive experiment available.

**Draw.** ~150 frames the operator has already rated, served back **blind**
through the existing queue. Stratify so both questions get power:
- ~75 frames originally rated 1–5 (sunsets), oversampling 3/4/5 (they're
  scarce and they're where quality discrimination matters);
- ~75 from the N/1 boundary region (originals rated N or 1), where detection
  "misses" concentrate.
Original ratings date from 2026-08-07 → 08-30, so the time gap is already
weeks — acceptable for test–retest.

**Mechanics.** Same `label_samples` machinery as `random_ordinary_v1`: freeze
the draw with a seed (`ml/load_label_sample.py`), name it `retest_v1`, stamp
`origin = 'retest_v1'` in `manual_labels`. Blind mode on (no prior rating, no
judge scores visible). **Retest labels are measurement-only** — they are
duplicates of training rows and must never enter an export; keep the origin
separable and extend the export quarantine if needed.

**Measurements.**
- Quality self-Pearson + MAE on frames rated as a sunset both times.
- Detection self-agreement: N-vs-(1–5) percent agreement and Cohen's kappa;
  the F1-equivalent of the operator against his own earlier labels.
- Confusion matrix by original rating (where does the operator drift — 3↔4?
  N↔1?).

**Decision rules (pre-registered now, so we can't rationalize later):**
- Let `gap = self-Pearson − model Pearson` (model = 0.697 pooled / 0.63–0.70
  fresh-data range).
- **gap ≤ 0.10** → the global quality metric is near ceiling. Skip Phase 1's
  big push. Move to the failure-mode track.
- **gap > 0.10** → real headroom; Phase 1 is justified, with expected gain
  roughly bounded by the gap.
- Detection analog: if the operator's self-agreement F1-equivalent lands near
  0.80–0.85, the frozen detection head at 0.78–0.80 is *finished* and that
  conversation closes permanently.

## Phase 1 — Detection-gated quality labeling push (CONDITIONAL on Phase 0)

Only if the quality gap says headroom exists.

- Draw **1,000+** frames the live detection head scores **≥ 0.55**, from
  cameras outside every operator eval draw, excluding all `label_samples`
  frames (the existing export guard pattern). At the ~75% enrichment the gate
  provides, nearly every rating becomes a quality label instead of one in
  four.
- Name it `gated_quality_v1`; **training-only, forever** — a model-gated draw
  is biased by construction and must never grade the model that drew it.
  Never pool with random or hard-case sets.
- Queue is resumable; chew through it across sittings. 200-per-draw was a
  sitting size, not a design limit.
- **Label-volume curve:** retrain the quality head on 25% / 50% / 100% of the
  new labels. If the curve is still climbing at 100%, draw `gated_quality_v2`;
  if it's flat by 50%, stop labeling — the answer is architecture or ceiling,
  not volume.

## Phase 2 — Quality head retrain (CONDITIONAL on Phase 1)

- Proven recipe: backbone warm start from the LLM pretrain
  (`--init-backbone-checkpoint`), same seed discipline as the shipping head.
- **Pre-registered bar:** beat the shipping head's Pearson on a *fresh* random
  confirmation draw (`random_ordinary_v4`, ~200 frames, drawn after training,
  unseen cameras). Wash band +0.02, per the standing convention. Never pick a
  winner on the data it was selected on — that mistake has now been caught
  three times on the detection side.

## Failure-mode track (runs regardless of Phase 0's verdict)

This is where "we want this really good" actually lives once global metrics
are at ceiling:
- **Silhouette 4s** — the known quality blind spot; ties into the queued
  manual-rating-for-custom-cams work.
- **Per-camera error audit** — webcam 3656741 fooled both heads twice an hour
  apart; find the other cameras like it and characterize what they share.
- **Below-gate rendering** — product intent is "show every image, just
  small"; STATE's design note stands (gate currently *hides* 10–15/25 of the
  operator's rating-1 frames; they should render minimal instead).

## Side items (cheap, independent, no phase dependency)

1. **Random trickle-save intake.** Add a sampled unconditional save
   (~1-in-50 frames regardless of score) alongside `SAVE_HIGH_RATED_SNAPSHOTS`
   in the `update-cameras` save gate, so an unbiased stream keeps entering the
   archive and the intake feedback loop has a control arm.
2. **Fix `SNAPSHOT_SYSTEM_README.md`** — still claims a 7-day auto-delete
   that has never run (`ml/OPERATING_GUIDE.md` has the accurate description).
3. **Leaderboard instrument drift** — the board ranks
   `COALESCE(llm_quality, ai_regression_score)`; Claude campaigns stopped
   mid-July, so new frames compete on ONNX scores against old frames' Claude
   scores. Not urgent; decide eventually whether to re-rank on one instrument.

## Explicit non-goals

- No detection-head retraining or threshold re-derivation (gate stays 0.55).
- No Flickr in fine-tune data; no new Flickr collection for training.
- No Claude re-rating spend (parked, per STATE's pre-registration).
- No waiting on image accumulation — the archive is already the big pool.
