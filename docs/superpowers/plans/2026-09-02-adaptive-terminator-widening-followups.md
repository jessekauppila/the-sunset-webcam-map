# Adaptive terminator widening — deferred follow-ups

**Date:** 2026-09-02
**Branch it came from:** `feat/adaptive-terminator-widening`
**Spec:** `docs/superpowers/specs/2026-09-02-adaptive-terminator-widening-design.md`

Every finding raised during that branch's reviews that was triaged as
"fine to defer" rather than fixed. None blocks merge; all were verified
harmless at the time. Recorded so they are not rediscovered from scratch.

## Wants production telemetry before it can be settled

**The camera floor counts gate-failers, so widening can satisfy itself
with frames the panel will floor.** `TERMINATOR_CAMERA_FLOOR` is compared
against every camera the sweep found, detection-gate failures included. If
the day-side ring adds 16 daylight cameras that all get floored, the count
clears 15, escalation stops, and the panel stays blank — the widening
reports success while producing the outcome it exists to prevent. When the
telemetry has a few days of history, the question to ask is "should the
floor count only gate-passers?", not "should the floor be 20?".

**`hasBudget` is a start-gate, not a deadline.** It is evaluated once
before each ring, never during. A ring starting just under
`TERMINATOR_SWEEP_BUDGET_MS` runs to completion — roughly 5-7s for a
half-ring, given `WINDY_FETCH_DELAY_BETWEEN_BATCHES_MS` plus network. Worst
case the sweep ends near 32s of the 50s `TICK_DEADLINE_MS`, leaving the
scoring loop less headroom than the design assumes. `maxDuration = 60` was
added to make the platform ceiling explicit; the start-gate itself is
unchanged. If ticks start running long, subtract an estimated ring duration
in the predicate.

**Nothing enforces `TERMINATOR_SWEEP_BUDGET_MS * 2 <= TICK_DEADLINE_MS`.**
The budget lives in `masterConfig.ts`; the deadline is a route-local const
in `route.ts`. Their relationship is now only a comment. Either add a guard
test or move `TICK_DEADLINE_MS` into `masterConfig.ts` and derive.

## Latent traps, harmless today

**Escalating one feed can push the other feed under the floor.**
`classifyWebcamsByPhase` assigns each camera to whichever coord set is
nearer, with no distance cutoff. Adding only the sunrise half of a ring can
only lower `minSunriseDistance`, so cameras migrate sunset→sunrise and never
back. Near the ring's poleward extremes this is geometrically reachable: a
healthy sunset feed at 18 could be dragged to 14 and trigger a night sweep it
never needed. Bounded at 3 rings. When reading telemetry, a rising `counts`
with a flat `newWebcams` means reassignment, not discovery.

**No cross-ring coordinate dedupe.** Each ring's coords are deduped within
themselves and within their own fetch union, but not across rings. Harmless
at ±15.75 because the rings do not overlap. A future *smaller* offset would
re-pay API calls for boxes an earlier ring already covered and inflate
`attempted` — degrading the one metric this feature exists to produce. Any
new offset must stay larger than `2 × SEARCH_RADIUS_DEG` or this needs
fixing first.

**Three route tests incidentally drive 3-ring escalations.**
`route.test.ts:255,277,298` override the classify mock with sub-floor counts,
so they escalate as a side effect of the floor-based default. Verified
harmless — they assert on `upsertStateMock`/`deactivateMock`, not on
sweep-derived values. But anyone adding a `fetchBatchesMock.mockResolvedValueOnce`
to those tests will be surprised that rings 2 and 3 fall back to the
`beforeEach` default. Wants a comment.

**`app/api/webcams/route.ts:44-48` builds the same bounding box without
clamping.** Its callers pass `SEARCH_RADIUS_DEG`, so the widening to 11 makes
an out-of-range box marginally likelier from a user-panned map. Low impact
(client-side, shows as "no results"), but `boundingBox()` now exists and this
is its second natural call site.

## Dead or cosmetic

- `useUpdateTerminatorRing.ts:78` — `offsetRing` is now provably `undefined`
  (`ringResults` is a one-element literal), so its guard and the GeoJSON memo
  below it are dead code that reads as if a second ring might appear.
- `windyApi.ts` — the `batches` local in `fetchCoordsCounted` is a flat
  per-coordinate array, not batch-grouped. The name obscures the 1:1 counting
  invariant that makes `attempted`/`empty` correct.
- `masterConfig.test.ts` — two back-to-back imports from the same module.
- `masterConfig.test.ts` — the offset-magnitude test asserts only
  `|offset| >= SEARCH_RADIUS_DEG`, pinning a qualitative threshold. It would
  pass for an unmeasured value between 11 and 15.75.

## Process note, worth keeping

The gaps the final review found were concentrated exactly where the plan's
scope ended: the *other* readers of `SEARCH_RADIUS_DEG`. Task 2 changed a
constant with seven call sites and verified two. The YouTube ceiling bug
(`1221 km` against that API's documented 1000 km cap, failing silently) would
have been caught by a "who else reads this constant, and what does each one
assume" step with a named verdict per call site. Worth adding to any future
plan that changes a shared constant.
