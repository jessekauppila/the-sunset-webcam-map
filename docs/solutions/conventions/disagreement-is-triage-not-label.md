---
title: Model disagreement is a triage signal, not a label — the operator verdict is the gold label
date: 2026-06-02
category: conventions
module: hard-example-mining
problem_type: convention
component: database
severity: medium
applies_when:
  - Building or extending hard-example mining
  - Designing retention/cleanup that touches snapshot rows
  - Deciding what counts as a training label for v5
tags: [hard-example-mining, labeling, ml-training, retention, verdict]
related_components: [service_object, background_job]
---

# Model disagreement is a triage signal, not a label — the operator verdict is the gold label

## Context
Hard-example mining compares the binary head against the regression head and flags
snapshots where they disagree (e.g. binary-negative but regression-high, or
binary-positive but regression-low). It is tempting to treat that disagreement as if
it were a label for retraining.

## Guidance
Disagreement is **triage only** — it decides what gets *queued* for human review, never
what the answer *is*. The gold label is the operator's verdict (`is_sunset_verdict` +,
when yes, a star rating) captured in the Hard Examples drawer. Persist the disagreement
flag (`disagreement_kind`) separately from the verdict, and keep cleanup
**three-class**: rows that are human-rated, rows flagged by disagreement, and
future-winner rows all survive deletion.

## Why This Matters
If the disagreement signal is mistaken for a label, the model trains on its own
confusion and the flywheel degrades instead of improving. Keeping triage and label
strictly separate is what makes the private-labeling loop trustworthy. The
three-class retention rule prevents the daily cleanup cron from deleting exactly the
frames the next model most needs to learn from.

## When to Apply
- Any time a model-derived flag could be confused with ground truth.
- When writing cleanup/retention logic over `webcam_snapshots`.

## Examples
- Wrong: export disagreement-flagged rows as positives for v5 training.
- Right: queue disagreement-flagged rows → operator labels them → only the operator
  verdict enters the training set; the flag is dropped after review.
- A partial index on `disagreement_kind` keeps the queue query fast.

## Related
- `docs/superpowers/specs/2026-06-02-hard-example-mining-and-private-labeling-design.md`
- `docs/solutions/best-practices/silhouette-sunset-blind-spot.md`
- STRATEGY.md — Track 1, label flywheel
