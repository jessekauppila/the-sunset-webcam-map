---
title: In this codebase the dangerous failures don't throw — they quietly do nothing
date: 2026-09-01
category: docs/solutions/best-practices
module: cross-cutting
problem_type: best_practice
component: ml_data_pipeline
severity: high
applies_when:
  - Adding a column, field, or config value that a feature depends on
  - Declaring a feature done because its tests and acceptance checks are green
  - A pipeline "runs" but produces no visible effect
  - Bundling model artifacts or anything else the build must physically include
  - Writing a pre-registered acceptance bar for an ML or display change
tags: [silent-failure, verification, acceptance-tests, data-plumbing, ml-scoring, kiosk, testing]
---

# In this codebase the dangerous failures don't throw — they quietly do nothing

## Context

On 2026-09-01, four separate bugs surfaced in one day across two lanes. Every
one of them had the same shape: **the page rendered, nothing errored, and the
feature simply was not there.**

| bug | what was missing | how it presented |
|---|---|---|
| Stale `.vercelignore` whitelist | the ONNX model never reached the builder | frames unscored; deploy looked fine |
| Scoring-pipeline ImageNet mismatch | training and inference preprocessed differently | plausible-looking numbers, all invalid |
| Mosaic `dropped` counter | counted tiles that were never dropped | a metric that quietly over-reported |
| `calibration_multiplier` missing from one of two payload queries | per-camera tempering on the kiosk | every tile rendered, at the wrong size |
| `PreviewPane` returning a fresh `[]` literal | — | infinite render loop, self-terminating |

None threw. None produced a stack trace. Each was found by someone chasing an
anomaly rather than explaining it away.

This is a property of the system, not a run of bad luck. The architecture is a
pipeline of independent stages — cron → ONNX → DB columns → payload query →
renderer — connected by **optional fields and nullable columns**. Almost every
seam between stages degrades to "no value" rather than "error", because
degrading gracefully is usually the correct behaviour for a webcam that is
offline or a frame that hasn't been scored yet. The cost of that design is that
a *broken* stage is indistinguishable from an *idle* one.

## Guidance

### 1. A green test suite is not evidence the feature reaches the surface

The sharpest instance: per-camera calibration shipped with an 8-clause
pre-registered acceptance test, all clauses passing, while the feature was
**dead on the kiosk**. Every clause verified the data and the maths — ground
truth tempered, bounds held, retention held. None checked that the value
reached the renderer.

`calibration_multiplier` had been added to `/api/db-all-webcams` but not to
`/api/db-terminator-webcams`, which is the payload the kiosk actually reads.

**When writing an acceptance bar, include at least one clause that follows the
value all the way to the surface that consumes it.** Data-and-maths clauses
answer "is the computation right"; they cannot answer "is it plugged in".

### 2. Grep every consumer at the moment you add the field

There is usually more than one query returning the same shape. In this repo
`WindyWebcam` is built by at least three separate SQL queries
(`db-all-webcams`, `terminatorPayload`, `snapshotTransform`), each with its own
hand-maintained column list.

```bash
# before considering a new column done
grep -rn "ai_rating_binary" app --include=*.ts | grep -v test
```

If that returns three call sites and you edited one, you are not done.

### 3. A typecheck cannot catch a missing optional field

```ts
calibrationMultiplier?: number;   // undefined is LEGAL
```

`tsc` passes. The tests on the call site you did edit pass. The other call site
silently yields `undefined`, the consumer treats it as "neutral", and the
feature no-ops. Types protect against the wrong *shape*, never against an
*absent* value that the shape permits.

### 4. Pin each call site with its own test — and watch it fail first

A test written after the fix proves the fix works. It does **not** prove the
test would have caught the bug. Revert the fix, watch the test go red, restore.

```ts
it('selects calibration_multiplier so tempering reaches the kiosk', async () => {
  await fetchTerminatorWebcams();
  const [strings] = sqlMock.mock.calls[0];
  expect(strings.join('?').toLowerCase()).toMatch(/w\.calibration_multiplier/);
});

// NUMERIC arrives as a STRING through the Neon driver — assert the type too,
// because a string breaks arithmetic silently rather than throwing.
it('coerces a tempered camera to a number', async () => {
  sqlMock.mockResolvedValue([{ ...baseRow, calibration_multiplier: '0.590' }]);
  const [cam] = await fetchTerminatorWebcams();
  expect(cam.calibrationMultiplier).toBe(0.59);
  expect(typeof cam.calibrationMultiplier).toBe('number');
});
```

### 5. Treat an unexpectedly quiet result as a prompt to check the instrument

Twice in one day a *clean* result was itself the bug:

- A baseline "re-verified against corrected labels" showed **zero changes** —
  because the corrections had never been applied. The check had compared the
  database to itself.
- A push reported no output and no error for minutes — because a GitHub 401 had
  fallen through to a blocking keychain prompt. Reads kept working, so every
  connectivity test looked healthy.

"Nothing changed" and "no errors" are results that must be *earned*. Before
accepting one, confirm the two arms of the comparison actually differ, or that
the thing you are measuring actually ran.

## Why This Matters

The failure mode is expensive precisely because it is invisible. A crash gets
fixed in minutes. A feature that silently does nothing survives code review,
survives its own test suite, survives deploy, and is discovered — if at all —
by someone looking at the product and thinking "wasn't that supposed to be
different?"

Two of the four bugs above were caught only because an unrelated investigation
walked past them. The per-camera tempering bug was found by asking a *product*
question ("will the kiosk show live images at the showing?") — not by any test,
review, or acceptance check that was specifically designed to catch it.

## When to Apply

- Adding any column, field, env var, or bundled artifact a feature depends on
- Writing or reviewing a pre-registered acceptance bar
- Reviewing a PR that adds a field to a shared payload type
- Any moment you are about to conclude "it runs, so it works"

## Related

- `docs/solutions/2026-06-06-fallbacks-must-not-impersonate-real-signal.md` —
  the sibling failure mode. That one is a fallback writing a *plausible fake
  value* into the real column; this one is behaviour being *absent* with no
  fallback at all. Both are undetectable at the surface; the fixes differ.
- `docs/solutions/integration-issues/vercel-bundles-all-model-versions-near-size-limit.md`
- `docs/superpowers/specs/2026-08-31-per-camera-calibration-design.md` — the
  acceptance bar that passed while the feature was dead.
