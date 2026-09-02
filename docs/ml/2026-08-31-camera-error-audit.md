---
title: "Per-camera error audit v1 — false-shows are concentrated and characterizable"
date: 2026-08-31
status: findings recorded; mitigation decision pending
---

# Per-camera error audit (2026-08-31)

First item on the failure-mode track after the retest ceiling verdict closed
the global-metrics chapter (see the quality-ceiling roadmap). Question: are
the composed system's errors spread thin, or do a few cameras systematically
fool the shipping pair?

**Method.** All 9,118 operator-labeled webcam frames rescored locally through
the shipping ONNX pair (`20260829_062437_v5_binary_gold` +
`20260830_190519_v5_quality_llm_backbone_finetune`, gate 0.55) via the
parity-verified `score_manifest` preprocessing — archived
`ai_regression_score` is ~92% v4-era and says nothing about the current
heads. Offender bar: ≥3 error events across ≥2 distinct capture days (one
bad frame is noise — the same standard that caught three non-replicating
detection "wins"). Tooling: `ml/audit_camera_errors.py`; full report
`ml/artifacts/reports/camera_error_audit_v1.json`.

## Findings

- **Errors are concentrated.** 5,538 operator-N frames → 169 false-shows
  (3.1%), of which only 27 (0.5%) at big-tile size (tile ≥ 0.5). **17
  cameras account for 42% of all false-shows**; the top four account for a
  third of the big-tile ones.
- **The failure class is coherent: warm light or warm terrain near the
  horizon that isn't sunset sky.** Eyeballed offenders:
  - `4057187` Broome Intl Airport (AU) — **11/11 N frames shown across 9
    days, mean tile 0.46**: sodium floodlight rows along the horizon under
    dusk skies. The single worst camera in the fleet.
  - `2947112` Coober Pedy opal mine (AU) — 4/5 shown, mean tile 0.44:
    red-orange spoil heaps; the whole frame is sunset-colored terrain.
  - `29095214` Mount Gambier Airport, `29275205` Wagga Wagga Airport —
    same airport-floodlight signature. Four of the top offenders are
    airports.
  - The remaining 13 offenders false-show only at *small* tile
    (meanTileN ≤ 0.32) — low product harm.
- **Misses of ≥4 frames barely recur**: only three cameras with 2 misses
  each (Cartago CR, Cochrane CA, Arica CL) — silhouette-candidate leads,
  nothing systematic yet.
- **Camera 3656741 (the v2-confirmation double-fooler) did NOT clear the
  recurrence bar** — its two famous frames never repeated. The
  repeated-days discipline is doing its job.
- Caveat: the labeled population is hard-example-biased, so 3.1% is not a
  production rate; rankings are within-population comparisons.

## Recommended mitigation (pending Jesse's call)

Training-side fixes are unpromising — these frames are already IN the gold
training set and the model still misreads them; that is what "at the label
ceiling" looks like. The pragmatic fix is display-side:

**A per-camera showcase cap for the four big-tile offenders** (4057187,
2947112, 29095214, 29275205): cap their tile signal below the showcase tier
(or exclude them from top-N placement) in the mosaic's qualitySignal path.
Small list, evidence-backed, reversible, and it removes ~a third of the
big-tile embarrassments before the 2026-09-13 showing. Owned by the display
lane (`app/components/mosaic/v1/qualitySignal.ts` + `passesGate`); this doc
is the handoff evidence. Re-run the audit as labels accumulate
(`.venv/bin/python ml/audit_camera_errors.py`) before growing the list.
