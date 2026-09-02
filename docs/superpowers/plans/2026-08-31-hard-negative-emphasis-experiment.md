---
title: "Hard-negative emphasis experiment — pre-registration"
date: 2026-08-31
status: PRE-REGISTERED before any training ran; do not edit the bar after results exist
---

# Hard-negative emphasis: pre-registered experiment

Follow-on to the per-camera audit (`docs/ml/2026-08-31-camera-error-audit.md`).
Jesse's direction: no hand-curated display exceptions (doesn't scale to
1000s of cameras); make the model itself as good as possible; and whatever
technique we use must be **repeatable and recorded** so it is applied the
same way next time.

## The technique (the durable part)

**Hard-negative emphasis**: operator-N frames that the current shipping
detection head false-shows are duplicated ×`FACTOR` in the training split
only. Defined by evidence, not camera lists:

- The emphasis set is **mined by the model itself** — rescore all
  operator-labeled frames through the shipping pair
  (`ml/audit_camera_errors.py --dump-frames`), take `is_sunset = false AND
  p_sunset >= gate`. Re-derivable by anyone, automatically covers new
  cameras and new failure classes as labels accumulate.
- Mechanism is **manifest row duplication via
  `ml/apply_hard_negative_emphasis.py`** — train.py is untouched, so the
  candidate differs from its baseline by exactly one thing. (train.py's
  `--sampler weighted` is class-inverse only; per-sample weights would be a
  training-code change and a second variable.)
- Emphasis applies to the **train split only**. Frames outside the training
  manifest (val/test cameras + quarantined eval draws) become the held-out
  class-effect measurement.
- Rule of thumb for FACTOR: emphasized effective share of the train split
  should land in the mid-single-digit percents. This run, measured before
  training: 8× on the **47** mined frames present in the frozen train
  manifest → 5,897 → 6,226 rows, **6.0% effective share**; the other **122**
  mined frames are outside the train manifest and form the held-out class
  set (`ml/artifacts/reports/hne_holdout_frames_v1.csv`). FACTOR 8 is a
  single-point choice, not tuned — tuning it would need its own
  pre-registered sweep.

## This run

- Baseline: `20260829_062437_v5_binary_gold` (the shipping detection head).
- Candidate: identical config (seed 20260212, resnet18, 60 epochs, bs 32,
  lr 1e-4 cosine, esp 15, dropout 0.3, light aug, random_resized 0.95–1.0,
  no class weighting, no sampler), identical frozen manifests from
  `ml/artifacts/experiments/20260829_062437_v5_binary_gold/dataset/20260829_062440/`,
  except `manifest_train.csv` → emphasized ×8.
- Run name: `v5_binary_gold_hne8`.

## Pre-registered bar (locked 2026-08-31, before training)

Scored through the verified pipeline only. ALL of:

1. **Class effect (the point):** on the held-out mined set (false-shown
   operator-N frames NOT in the training manifest), the candidate must
   false-show **at most half** as many as the shipping head at gate 0.55.
2. **No harm, pooled 500:** detection F1 ≥ **0.777** (shipping 0.797 minus
   the 0.02 wash band); composed false-shows ≤ **16/365**; operator-≥4
   shown ≥ **26/28**.
3. **Ship gate (standing rule, no exceptions):** confirmation on a **fresh
   operator draw** (`random_ordinary_v4`, ~200 frames, drawn after
   training) — no-harm bounds must hold there before anything deploys.
   This is the fourth detection-head change attempt; the three before it
   all died on fresh data.

## Decision rule (also pre-registered)

- **Bar clears** → hard-negative emphasis becomes a standing part of the
  detection recipe: every future detection train re-mines the emphasis set
  against the then-shipping head and applies the same script and factor.
  Record the verdict here and in STATE.
- **Bar fails** → the failure class lives below this model's capacity, and
  the committed direction is **automatic per-camera calibration**: a
  nightly job derives a per-camera tempering prior from accumulated
  evidence (false-show history, model-vs-Claude disagreement) — no hand
  lists, new cameras start neutral, scales to 1000s. Next step in that case
  is a design doc for the calibration job. (Jesse, 2026-08-31: if we go
  there, we go deliberately.)

## Verdict (2026-08-31, run `20260831_143028_v5_binary_gold_hne8`)

**BAR FAILS on the class-effect clause. Per the decision rule, the committed
direction is automatic per-camera calibration.**

| clause | required | measured | result |
|---|---|---|---|
| class effect (held-out 122) | ≤ 61 shown | **67 shown** (median p 0.623) | **FAIL** |
| no harm: pooled F1 @0.55 | ≥ 0.777 | 0.787 (prec 0.881 / rec 0.711) | pass |
| no harm: pooled false-shows | ≤ 16/365 | 13/365 | pass |
| no harm: ≥4 shown | ≥ 26/28 | 27/28 | pass |
| ship gate (fresh draw) | — | not reached | moot |

Honest reading: the emphasis had a **real effect** — 122/122 → 67/122 on
frames the model never trained on, at the cost of ~0.01 F1 (inside the wash
band) — but 45% is not the registered 50%, and after three detection changes
that died on fresh data, a near-miss does not get talked into a pass.
Re-running with a bigger factor to chase the bar would be tuning on the
eval — the forbidden move. Also decisive: even a passing candidate would
have left 55% of the class false-showing, so calibration would have been
needed regardless; the experiment mainly proved the residual is real.

Emphasis remains available as a technique (tooling stays committed) but is
NOT part of the standard recipe. Next step per the decision rule: design
doc for the nightly per-camera calibration job.
