---
title: The model's silhouette-sunset blind spot is a training-distribution gap, not an architecture flaw
date: 2026-06-02
category: best-practices
module: ml-rating-model
problem_type: best_practice
component: service_object
severity: medium
applies_when:
  - Evaluating or retraining the sunset-quality model
  - A visibly beautiful sunset scores surprisingly low
  - Deciding whether to change model architecture vs. relabel data
tags: [ml, model-evaluation, training-data, sunset, silhouette, v5]
---

# The model's silhouette-sunset blind spot is a training-distribution gap, not an architecture flaw

## Context
The v4 model rates silhouette/gradient sunsets — beautiful skies with no visible sun
disk, just color over a dark foreground — at ~0.21, roughly the baseline-fallback
score, despite their high photographic quality. This was discovered by spot-checking,
not by any alert or metric, because a low score makes the frame simply *not appear* in
normal operation.

## Guidance
Treat this as a **training-distribution gap**: the model has seen few labeled
silhouette sunsets, so it underrates them. The fix is data, not architecture —
explicitly relabel/collect silhouette examples so they enter the training set (this is
exactly what hard-example mining + private labeling feeds). A two-headed model
(detection + quality) is a possible longer-term decouple, but is not required to close
this gap.

## Why This Matters
Low-scoring frames are invisible during normal use, so blind spots like this never
surface on their own — only deliberate spot-checking finds them. Reaching for an
architecture change when the real problem is distribution wastes effort and can
destabilize a model that is otherwise fine. Getting silhouette sunsets right is also
directly on the "best sunsets to the top" hot track.

## When to Apply
- Before concluding a model is "broken" on a class of inputs — first ask whether that
  class is represented in the training data.
- When prioritizing what to label next for v5.

## Examples
- A coastal silhouette with vivid orange gradient → v4 score ~0.21 (baseline-like) →
  the frame never surfaces on the map → only caught by manual review.
- Prevention: queue such frames via hard-example mining so the operator verdict
  becomes a gold label and the next model version sees them.

## Related
- `docs/superpowers/specs/2026-05-16-ai-rating-silhouette-sunset-blind-spot-stub.md`
- `docs/solutions/conventions/disagreement-is-triage-not-label.md`
- `AI_RATINGS_V2_PLAN.md` (training/label provenance)
- STRATEGY.md — Track 1 (ML quality & sunrise/sunset detection)
