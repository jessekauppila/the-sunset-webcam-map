---
title: Never let a serverless ML fallback masquerade as real model output
date: 2026-06-02
category: best-practices
module: ml-inference-deploy
problem_type: best_practice
component: service_object
severity: high
applies_when:
  - Deploying or upgrading the ONNX model (v4 → v5 and beyond)
  - Adding a baseline/fallback path to any inference route
  - A model "works locally" but scores look flat in production
symptoms:
  - "Inference latencyMs < 30 in production (real ONNX runs ~100-500ms)"
  - "rawScore pinned near the baseline value (~0.21) for all inputs"
  - "Model loads locally but never loads in the deployed serverless function"
tags: [ml, serverless, observability, fallback, onnx, vercel, deploy]
related_components: [background_job]
---

# Never let a serverless ML fallback masquerade as real model output

## Context
The inference route has a baseline/metadata fallback for when the ONNX model can't
load (e.g. the model file isn't bundled into the serverless function). When that
fallback runs silently, the system *looks* healthy — it returns scores — but every
score is the baseline, and nobody notices the real model never ran.

## Guidance
Make the fallback **loud and attributable**:
- **Persist `pathTaken`** on each inference (e.g. `"onnx"` vs `"baseline"`) so you can
  tell real outputs from fallbacks after the fact.
- **Surface a `fallbacks` counter** in the cron/smoke response and assert
  `fallbacks === 0` after a deploy — a nonzero count is a failed deploy, not a warning.
- **Use static dynamic imports** for the ML runtime so the bundler traces and includes
  the dependency, rather than a path that resolves at runtime and silently 404s in the
  function.
- Know the **fallback signature**: `latencyMs < 30` + `rawScore ≈ 0.21` means ONNX
  didn't load — check bundling (`outputFileTracingIncludes` with route-path keys, not
  `vercel.json`).

## Why This Matters
A silent fallback is worse than a crash: a crash gets fixed, a silent fallback ships a
dead model to production and quietly degrades every downstream surface (map, kiosk,
labels) until someone spot-checks latency. This recurs on *every* model deploy, so the
observability has to be built into the path, not remembered each time.

## When to Apply
- Every model deploy — verify `fallbacks === 0` and latency in the real-ONNX range as
  the go/no-go gate (see the deploy runbook).
- Any time you add a graceful-degradation path that returns plausible-but-fake output.

## Examples
- Confirm working ONNX: smoke endpoint `latencyMs` 100–500ms, `pathTaken: "onnx"`.
- Caught fallback: `latencyMs` 10–20ms, `pathTaken: "baseline"`, `fallbacks > 0` →
  fix bundling and redeploy before trusting any score.

## Related
- `docs/ml-deploy-runbook.md` (Traps #1, #3, #4 — bundling and fallback signature)
- `docs/solutions/design-patterns/image-hash-redis-short-circuit.md`
- (auto memory [claude]) `feedback_silent_ml_fallback`, `feedback_vercel_nextjs_ml_bundling`
