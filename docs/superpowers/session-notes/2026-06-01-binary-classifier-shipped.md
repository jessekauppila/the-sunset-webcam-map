# Where we are — 2026-06-01 (v4 binary classifier shipped)

**For the next Claude session:** Read this first. Captures the state of work as of end-of-day 2026-06-01.

---

## TL;DR

- v4 binary classifier (`20260601_063518_v4_binary_llm_with_flickr`) is trained, exported, deployed, and verified running in production
- Popup now uses real "is this a sunset?" verdict (display gate B — rating suppressed when binary says no, both numbers stay in DB)
- Tonight's deploy uncovered 3 silent-failure traps now memorialized in memory + the new `docs/ml-deploy-runbook.md`

## Trained model performance

| Metric | Value |
|---|---|
| F1 @ threshold 0.5 (deployed) | 0.836 |
| F1 @ threshold 0.75 (best by sweep) | 0.845 |
| AUC | 0.995 |
| Balanced accuracy | 0.933 |
| Confusion @ 0.5 | TP=270, FP=69, TN=5203, FN=37 |
| Positive rate in dataset | 5.9 % (2,086 of 35,372) |
| Training | 45 epochs (early-stop, patience 15), 2h 13m on MPS |

The threshold is shipped at **0.5** (default) — slightly higher recall than the F1-optimal 0.75. Tunable via the `AI_BINARY_SUNSET_THRESHOLD` Vercel env var without redeploy.

## Currently deployed in production

| Component | Version |
|---|---|
| Regression model | `v4_regression_llm_with_flickr` |
| Binary model | `20260601_063518_v4_binary_llm_with_flickr` |
| Binary threshold | 0.5 |
| Smoke endpoint | `/api/debug/scoring-smoke` returns both heads |
| Popup | Shows verdict + (when binary says yes) rating + stars + dual-line footer |

## What shipped today across N PRs

| PR | Branch | What |
|---|---|---|
| #26 | `feat/v4-binary-training-config` | yaml config for v4 binary training |
| #27 + #28 | `fix/v4-binary-threshold-normalize` | 4.0 → 0.75 threshold defaults + binary ONNX file (43 MB) + 30k-line manifest |
| #29 | `feat/binary-classifier-wiring` | aiScoring dual-model + scoreImage signature + route writes |
| #30 | `fix/vercel-includefiles-glob` | (didn't actually help — kept for git history) |
| #31 | `fix/onnx-bundle-via-next-config` | the real bundling fix (`outputFileTracingIncludes` route-key format) |
| (current) | `feat/display-gate-binary` | popup gates rating display on binary verdict; dual-line model footer |

## Bundle size watch

We're at **~264 MB estimated** vs Vercel's 250 MB hard limit. Currently shipping despite the estimate exceeding the limit — Vercel's actual accounting is more generous than published. If a future deploy fails on size, `git rm` the unused v2 ONNX files in `regression_resnet18/20260315_*` and `binary_resnet18/20260314_*` — saves ~86 MB, no other impact (env vars don't reference them; `.pt` checkpoints remain for rollback).

## New documentation

- `docs/ml-deploy-runbook.md` — the focused 6-step model deploy doc with 5 traps + workarounds
- `memory/feedback_vercel_nextjs_ml_bundling.md` — the bundling gotchas in compound-engineering form
- `memory/feedback_normalized_vs_raw_thresholds.md` (saved earlier) — the binary_threshold trap

## What's queued

In priority order:

1. **Manual rating for custom cams** (`memory/project_manual_rating_for_custom_cams.md`) — addresses silhouette-sunset blind spot; labels feed v5 binary training. Needs brainstorming pass.
2. **Cloud wizard AR screens 4-5** — Subproject F's deferred AR overlay + horizon sweep. Real design needed (compass calibration UX, three.js vs canvas2D).
3. **Automate the deploy runbook into a script** — `docs/superpowers/plans/2026-05-16-streamlined-model-deploy.md` Tasks 4-11 cover this. The runbook shipped today is the manual interim.

## Verification command to run after any future deploy

```bash
curl -s -H "Authorization: Bearer $CRON_SECRET" \
  https://www.sunrisesunset.studio/api/debug/scoring-smoke | jq
```

Healthy response shape:
- `pathTaken: "onnx"`
- `latencyMs` between 100 and 500
- `binaryPathTaken: "onnx"`
- `binaryModelVersion` matches the env var

Latency under 30 ms = baseline-fallback running (silent failure).
`rawScore: 0.21` is a deterministic baseline signature, not a real model output.

## Worktrees clean as of session end

Only the main checkout remains. The `feat/display-gate-binary` worktree should be cleaned up after that PR merges:

```bash
git worktree remove /Users/jessekauppila/GitHub/the-sunset-webcam-map-display-gate
```

## Key memories to read for context

- `memory/feedback_silent_ml_fallback.md` — the umbrella pattern
- `memory/feedback_normalized_vs_raw_thresholds.md` — Trap 1 from runbook
- `memory/feedback_vercel_nextjs_ml_bundling.md` — Traps 3 & 4 from runbook
- `memory/project_two_tier_sunset_classification.md` — now SHIPPED; can be archived
- `memory/project_manual_rating_for_custom_cams.md` — natural next chunk
