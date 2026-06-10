---
title: Vercel function bundle balloons toward the 250 MB limit — ONNX tracing globbed every model version
date: 2026-06-09
category: docs/solutions/integration-issues
module: ml-scoring-deploy
problem_type: integration_issue
component: build_config
symptoms:
  - "Vercel build fails (or hovers dangerously close to) `Function bundle exceeded 250 MB`"
  - "`outputFileTracingIncludes` uses `regression_resnet18/**/*` + `binary_resnet18/**/*`, which bundles BOTH the v2 and v4 artifacts (4 × ~43 MB = 172 MB) even though only the v4 pair is ever loaded"
  - "Enabling a SECOND ONNX head (the binary classifier) is what finally tips the deploy over"
root_cause: over_broad_glob
resolution_type: config_change
severity: high
tags: [vercel, nextjs, onnx, bundle-size, outputFileTracingIncludes, model-deploy, ml, guard-test]
---

# Vercel function bundle balloons toward the 250 MB limit — ONNX tracing globbed every model version

## Problem

The cron + smoke serverless functions need the ONNX model files bundled in. `next.config.ts` did this with a wildcard over the whole model-type folder:

```ts
outputFileTracingIncludes: {
  '/api/cron/update-cameras': [
    './ml/artifacts/models/regression_resnet18/**/*',
    './ml/artifacts/models/binary_resnet18/**/*',
  ],
  // ...same for /api/debug/scoring-smoke
}
```

Each ResNet-18 ONNX is ~43 MB, and **both a v2 and a v4 version of each head are committed** (kept for rollback-via-re-export). The `**/*` glob swept all four (~172 MB) into every function bundle. With onnxruntime-node (~36 MB) + sharp (~16 MB) + the Next framework (~40 MB) that lands ~264 MB — already over Vercel's 250 MB estimate (it shipped only because Vercel's real accounting is more permissive). Turning on the binary head as a live scorer would have pushed it past the actual limit.

## Symptoms

- The bundle hovers ~264 MB; any new model or dependency risks `Function bundle exceeded 250 MB`.
- Only the v4 regression (`20260513_113243_v4_regression_llm_with_flickr`) and v4 binary (`20260601_063518_v4_binary_llm_with_flickr`) are actually loaded — the v2 pair is dead weight in the bundle.

## What Didn't Work

- `vercel.json` `functions.includeFiles` silently does **not** match `ml/artifacts/models/**` (logs show `File doesn't exist at /var/task/...`). Next's own `outputFileTracingIncludes` is the mechanism that works — but it inherited the same over-broad glob.

## Solution

Pin the tracing includes to the **specific deployed version directories**, not the model-type parent:

```ts
outputFileTracingIncludes: {
  '/api/cron/update-cameras': [
    './ml/artifacts/models/regression_resnet18/20260513_113243_v4_regression_llm_with_flickr/**/*',
    './ml/artifacts/models/binary_resnet18/20260601_063518_v4_binary_llm_with_flickr/**/*',
  ],
  // ...same for /api/debug/scoring-smoke
}
```

This drops the two unused v2 models from the bundle (−86 MB → ~178 MB) while keeping them committed in git for rollback. Then **lock it in with a guard test** (`next.config.test.ts`) that fails the build if anyone re-broadens the globs or bundles a v2 model again:

- every include pattern must resolve to a `v4` version dir (never `v2`, never a whole-type glob),
- each pinned dir must exist on disk with a `model.onnx`,
- total bundled model weight stays under a budget (120 MB) — well below the 172 MB you'd get if a v2 model crept back in.

(cloud PR #54.)

## Why This Works

`outputFileTracingIncludes` is a literal glob over the filesystem at build time. `regression_resnet18/**/*` matches *every* version subdir; naming the exact version dir matches only that one. The guard test converts an invisible size regression (which only surfaces as a failed deploy) into a fast, local unit-test failure.

## Prevention

- **Pin bundled model artifacts to the exact deployed version**, never glob the family. New version → bump the path here AND the matching `AI_ONNX_*_MODEL_PATH` env var in Vercel together (they must agree).
- **Add a build-size guard test** whenever a bundle nears a hard platform limit — the limit is otherwise only discoverable by a failed remote deploy.
- Verify the deploy actually shipped the model via the smoke endpoint's latency signature — see [[verifying-prod-behind-vercel-deployment-protection]].
- Related: `memory/feedback_vercel_nextjs_ml_bundling` (the broader Vercel/Next ML bundling gotchas).
