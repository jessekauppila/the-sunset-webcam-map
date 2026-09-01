---
title: "Quality ceiling measurement and labeling roadmap"
date: 2026-08-30
status: Phase 0 answered 2026-08-31 (ceiling reached); failure-mode track active
---

# Quality ceiling & labeling roadmap

> **Status: Phase 0 RUN AND ANSWERED (2026-08-31) — CEILING REACHED.**
> Self-Pearson **0.673** vs the model's 0.697 (gap −0.024 ≤ 0.10) and
> detection self-F1 **0.807** vs the head's ~0.80. Report:
> `ml/artifacts/reports/retest_v1_ceiling.json` (146 of 150 re-rated).
> **Phase 1's big labeling push is CANCELLED** and Phase 2 with it, per the
> pre-registered rule below. The failure-mode track is now the whole plan.
>
> The follow-up analysis decomposed the ceiling rather than accepting it:
> all 35 detection disagreements are either a 1↔N call (21) or a frame from
> the 2026-08-08 session (14), with **zero residual** — 39/39 agreement on
> everything else. See the STATE doc's "PHASE 0 VERDICT" block and
> `docs/ml/rating-rubric.md` "Boundary sharpening" for the anchors and the
> numbers. Side items 1–3 below are all **DONE** (2026-08-31).
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

## Phase 1 — Detection-gated quality labeling push ❌ CANCELLED 2026-08-31

**Phase 0 said no headroom (gap −0.024).** Kept for the record; do not
execute. If a future measurement reopens it, the design below stands.

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

## Phase 2 — Quality head retrain ❌ CANCELLED with Phase 1 (2026-08-31)

The pre-registered bar and confirmation-draw discipline below remain the
template for **any** future retrain, including one trained on corrected
labels rather than more labels — see the STATE doc's gate note.

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
- **Silhouette 4s** — ⛔ **BLOCKED upstream, measured 2026-08-31.** The
  custom-cam corpus is 1,719 frames from a single ~2-hour bring-up burst on
  2026-06-13 (camera on its side, pointed into a tree, half-occluded), one
  paired camera, nothing since 2026-06-14, and zero manual labels. There is
  nothing to label. The model's 0.005–0.081 scores on those frames are
  *correct*, so they are not even an exhibit of the blind spot. Reopens when
  a custom camera has banked golden-hour frames across multiple evenings —
  that is the hardware thread, not an ML wiring job.
- **The 3/4 boundary** — ✅ **the live failure mode, and now the sharpest
  lever.** 80% of frames rated 4 flip their `rating >= 4` training label on
  retest, always drifting down to a 3. Anchors picked from the retest itself
  are in `docs/ml/rating-rubric.md`; the two boundary tests render on-glass
  in the queue legend.
- **The 2026-08-08 cohort** — ✅ **CORRECTED 2026-08-31.** The session was
  mostly Flickr: 592 labels = webcam 452 N + **24 positives**, Flickr 36 N +
  80 positives. The retest is webcam-only, so it overturned all 24 webcam
  positives (**10 crossing `rating >= 4`, 0.8% of the 1,237 webcam >= 4 gold
  labels**) and left the 80 Flickr positives untested — those are probably
  fine and were deliberately NOT touched. No sitting was needed: the retest
  ratings already existed. Applied with `ml/apply_label_corrections.py`,
  archiving originals to `manual_label_supersessions`. Expect no metric
  movement from 24 labels in 9,118.
- **Per-camera error audit** — webcam 3656741 fooled both heads twice an hour
  apart; find the other cameras like it and characterize what they share.
- **Below-gate rendering** — product intent is "show every image, just
  small"; STATE's design note stands (gate currently *hides* 10–15/25 of the
  operator's rating-1 frames; they should render minimal instead).

## Side items ✅ ALL DONE 2026-08-31

1. **Random trickle-save intake — DONE.** `SAVE_RANDOM_TRICKLE_RATE = 0.02`
   (1 in 50) in `masterConfig.ts`, applied in the `update-cameras` save gate
   *without looking at the score*, so the archive keeps receiving an unbiased
   stream as a control against the model-gated feedback loop. Rows are stamped
   `webcam_snapshots.intake_reason` (`'disagreement' | 'high_rated' |
   'trickle' | 'all_rated'`) — migration
   `database/migrations/20260831_snapshot_intake_reason.sql`. The stamp is the
   point: without it a trickle row is indistinguishable from a high-rated one
   and the control arm is unrecoverable. Gated reasons take precedence, so
   `'trickle'` marks only frames nothing else would have caught. ~80 extra
   rows/day at current volume.

   **⚠️ Deploy ordering: the migration MUST be applied before this code
   ships.** `insertWindyDisagreementSnapshot` now names `intake_reason`
   unconditionally; without the column every snapshot persist throws, and the
   call site swallows it as a warning — the Hard Examples queue would silently
   stop receiving frames.

2. **`SNAPSHOT_SYSTEM_README.md` retention claim — DONE.** The file claimed a
   7-day auto-delete in five places. Nothing has ever been deleted:
   `CLEANUP_ENABLED = false` and `vercel.json` schedules no cleanup cron. Added
   a "Retention — what actually happens" section, corrected each claim in
   place, and reframed the storage/record estimates as per-week growth for a
   window that never closes.

3. **Leaderboard instrument drift — DOCUMENTED (behaviour unchanged).** The
   route comment claimed COALESCE(llm_quality, ai_regression_score) had "no
   scale discontinuity". Measured over the whole archive, that is false:

   | column | n | mean | p99 | max |
   |---|---|---|---|---|
   | `llm_quality` | 46,079 | 0.188 | 0.720 | 0.880 |
   | `ai_regression_score` | 60,646 | 0.432 | 0.809 | 1.000 |

   On the 46,079 frames carrying both, means are 0.188 vs 0.405 and the two
   correlate at only **r = 0.454**. Claude campaigns stopped 2026-07-31, so the
   all-time top 100 is now **98 model-ranked, 2 Claude-ranked** — the public
   board is effectively "best sunsets since August." Left as-is deliberately
   (this item was "not urgent"), with the fix written down: rank everything on
   `ai_regression_score`. Every Claude-rated frame already carries a model
   score (46,079 of 46,079), so it is a single-instrument re-rank with no
   coverage loss, onto the better instrument (Pearson 0.697 vs 0.514 against
   operator truth). Changing what the public board shows wants its own call.

## Explicit non-goals

- No detection-head retraining or threshold re-derivation (gate stays 0.55).
- No Flickr in fine-tune data; no new Flickr collection for training.
- No Claude re-rating spend (parked, per STATE's pre-registration).
- No waiting on image accumulation — the archive is already the big pool.
