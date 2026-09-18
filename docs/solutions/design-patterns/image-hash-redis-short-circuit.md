---
title: Short-circuit ONNX inference with a per-image Redis hash cache to control cron cost
date: 2026-06-02
category: design-patterns
module: ml-inference-cron
problem_type: design_pattern
component: background_job
severity: medium
applies_when:
  - Extending the update-cameras cron or any per-tick image scoring
  - Adding a new image source to the scoring pipeline
  - Inference or DB-write cost per tick is creeping up
tags: [redis, caching, cost-optimization, onnx, cron, inference]
related_components: [service_object, database]
---

# Short-circuit ONNX inference with a per-image Redis hash cache to control cron cost

## Context
The `/api/cron/update-cameras` tick scores many webcam frames with the ONNX model.
Many feeds return an identical image tick-over-tick (static cameras, slow refresh), so
naively re-scoring every frame burns inference time and triggers redundant DB writes.

## Guidance
Hash each fetched image and key a Redis cache on that hash (24h TTL). On a cache hit,
**short-circuit**: skip ONNX inference and skip the Neon write. Bound the tick with a
soft deadline (~50s) and a per-image timeout (~3s) so one slow image can't blow the
budget, and fall back gracefully to baseline metadata scoring if ONNX or Redis is
unavailable — but make that fallback observable (see the silent-fallback note).

## Why This Matters
Static feeds dominate, so the image-hash cache typically hits 70–90% — most ticks do
near-zero inference and near-zero writes, which is what keeps the pipeline cheap enough
to run continuously. The deadline/timeout pair turns an unbounded fan-out into a
bounded one. The whole pattern is "cost discipline" from the strategy made concrete.

## When to Apply
- Any per-tick, per-item expensive computation where inputs frequently repeat.
- Gate the *expensive* work (inference, writes) on the cache, not just the cheap parts.

## Examples
- Hit: `redis.get(imgHash)` returns prior score → reuse it, no `session.run`, no write.
- Miss: run ONNX, write result, `redis.set(imgHash, score, EX=86400)`.
- Guardrails: `Promise.race` each image against a 3s timeout; stop scheduling new work
  past the 50s soft deadline.

## Related
- `docs/superpowers/specs/2026-05-14-model-mosaic-integration-design.md`
- `docs/solutions/best-practices/silent-ml-fallback-observability.md`
- `docs/ml-deploy-runbook.md`
