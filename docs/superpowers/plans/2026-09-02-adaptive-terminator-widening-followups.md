# Adaptive terminator widening — deferred follow-ups

**Date:** 2026-09-02
**Branch it came from:** `feat/adaptive-terminator-widening`
**Spec:** `docs/superpowers/specs/2026-09-02-adaptive-terminator-widening-design.md`

Every finding raised during that branch's reviews that was triaged as
"fine to defer" rather than fixed. None blocks merge; all were verified
harmless at the time. Recorded so they are not rediscovered from scratch.

## Status as of 2026-09-02 evening

| item | state |
| --- | --- |
| Digest + `daily_sunset_stats` migration | **DONE** — commit "persist sweep telemetry and surface it in the daily digest" |
| Five latent-trap / dead-code findings | **DONE** — commit "clear the deferred findings that did not need production data" |
| Camera-refresh pricing | **DONE** — `docs/superpowers/specs/2026-09-02-camera-refresh-cost-design.md`; verdict is *change nothing*: Windy publishes a new preview every 10.1 minutes, so a 1-2 minute cadence is not purchasable at any price |
| Three findings that want production telemetry | **BLOCKED** — PR #112 is still open, so the widening has never run in production and there is nothing to read. Recipe below. |

**One claim in this document was wrong and is corrected below**: the rule
"any new offset must stay larger than `2 x SEARCH_RADIUS_DEG`" is not
supported. `2 x 11 = 22`, and the shipped offset is 15.75, so the escalation
rings' query boxes already overlap the base ring's. They yielded 92-100% new
cameras anyway. Box overlap is not what predicts yield, and no inequality
substitutes for measuring a new offset live.

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
*(FIXED — `TICK_DEADLINE_MS` moved into `masterConfig.ts` and the inequality
is a test. `maxDuration` stays a literal in the route, because Next.js reads
it by static analysis.)* This one did not actually need telemetry; it was
filed under the budget discussion and inherited its "wait" label.

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
themselves and within their own fetch union, but not across rings.

Two separate things were conflated here, and the correction matters:

- *Coordinate* duplication across rings is impossible for any non-zero
  offset. `radius = 90 - (sunAltitude + offset)`, so two rings at different
  offsets have different radii and share no ring point. Cross-ring coord
  dedupe would never remove anything.
- *Box* overlap is real and is already happening. The box spans
  `2 × SEARCH_RADIUS_DEG` = 22 degrees and the offset is 15.75, so escalation
  boxes overlap the base ring's ground by roughly 6 degrees today. The rings
  still returned 92-100% new cameras, so overlap is a weak predictor of
  wasted calls at this geometry.

The original "must stay larger than `2 × SEARCH_RADIUS_DEG`" rule is
therefore wrong: the shipped configuration violates it and works. A smaller
offset is still a bad idea, but the reason is the measured 26-35% yield at 3
degrees, not an inequality. **Measure any new offset live.**

**Three route tests incidentally drive 3-ring escalations.** *(FIXED — the
comment is in place above the first of the three.)*
`route.test.ts:255,277,298` override the classify mock with sub-floor counts,
so they escalate as a side effect of the floor-based default. Verified
harmless — they assert on `upsertStateMock`/`deactivateMock`, not on
sweep-derived values. But anyone adding a `fetchBatchesMock.mockResolvedValueOnce`
to those tests will be surprised that rings 2 and 3 fall back to the
`beforeEach` default. Wants a comment.

**`app/api/webcams/route.ts:44-48` builds the same bounding box without
clamping.** *(FIXED — it calls `boundingBox()` now, with a test that panning
to lat 85 / lon 175 produces an in-range box.)* Its callers pass `SEARCH_RADIUS_DEG`, so the widening to 11 makes
an out-of-range box marginally likelier from a user-panned map. Low impact
(client-side, shows as "no results"), but `boundingBox()` now exists and this
is its second natural call site.

## Dead or cosmetic

All four are FIXED.

- `useUpdateTerminatorRing.ts:78` — `offsetRing` was provably `undefined`
  (`ringResults` was a one-element literal), so its guard, the GeoJSON memo
  and a whole Mapbox layer were dead code that read as if a second ring might
  appear. Collapsed to a single `ring`.
- `windyApi.ts` — the `batches` local in `fetchCoordsCounted` is a flat
  per-coordinate array, not batch-grouped. Renamed `perCoord`, with the 1:1
  invariant that makes `attempted`/`empty` correct spelled out.
- `masterConfig.test.ts` — two back-to-back imports from the same module,
  merged.
- `masterConfig.test.ts` — the offset-magnitude test asserted only
  `|offset| >= SEARCH_RADIUS_DEG`, which an unmeasured value between 11 and
  15.75 would clear. Replaced by the exact measured pair, with the reason the
  values are empirical rather than derived.

## Requested follow-on work (not review findings)

These came from Jesse on 2026-09-02, after the branch was finished.

**Put widening frequency and its cost into the daily digest.** **DONE.** The digest
(`app/api/cron/update-cameras/lib/dailyDigest.ts`, sent ~5pm PT) is where
this feature's behaviour should surface day to day: how often a feed fell
under the floor, which rings got swept, and what that did to the API call
count. The sweep telemetry already carries everything needed
(`RingTelemetry.attempted` / `empty` / `newWebcams` / `newWebcamIds`, and
`SweepTelemetry.escalations`), but it currently reaches only the cron's JSON
response and one log line — nothing persists it. This is the deferred
`daily_sunset_stats` migration from the spec, now with a concrete consumer
and a concrete reason. Cost framing matters more than raw counts: calls/day
attributable to escalation, against the ~3,000/day baseline.

**Understand camera refresh and what it costs.** **DONE**, and the answer is
that the ask cannot be met from this source. Measured 2026-09-02 across 8
production cameras: Windy publishes a new preview every 10.1 minutes, median
of 10 observed gaps. The cron is not in the image path at all — preview URLs
are stable and the browser fetches them from Windy's CDN — so cadence changes
nothing, and a 2-minute cron would multiply Windy calls, ONNX scoring and
Neon compute by 7.5x for zero freshness. The custom Pi cameras are the only
path to 1-2 minutes. Full pricing in
`docs/superpowers/specs/2026-09-02-camera-refresh-cost-design.md`. Deliberately excluded from
the widening spec as a separate decision with its own price. Two distinct
clocks were conflated during that design conversation and should stay
separate: the *camera list* turns over as the terminator sweeps, roughly
every 90 minutes, which a 15-minute tick already tracks six times over; the
*images themselves* are what wanted a 1-2 minute cadence for the exhibit.
Only the second is a real ask. Price it properly before changing
`vercel.json` — the cron currently runs 96 times a day, and every-2-minutes
is 720.

## Reading the telemetry, once there is any

Nothing below can run until PR #112 merges and the cron has swept for a few
days. The migration is `database/migrations/20260902_sweep_telemetry.sql`;
apply it before the deploy or the first ticks silently drop their telemetry
(`upsertSweepStats` swallows a missing table by design, so a missed migration
looks like a quiet feature rather than an error).

**Risk 1 — do golden-hour frames pass the detection gate?**

```sql
select offset_deg,
       sum(new_webcams)        as found,
       sum(frames_scored)      as scored,
       sum(frames_gate_passed) as passed,
       round(100.0 * sum(frames_gate_passed) / nullif(sum(frames_scored), 0), 1) as pass_pct
from daily_sweep_ring_stats
where date > current_date - 14
group by offset_deg
order by offset_deg desc;
```

The day-side row is `offset_deg = 15.75`. Compare its `pass_pct` against the
base row's. If the day side is close, the ordering is right and the floor
stays a plain camera count. If it is far below, that is the self-concealing
failure: widening adds tiles the panel floors. The fix to consider then is
**making the floor count only gate-passers**, not raising the floor — raising
it buys more API calls for more floored tiles. The digest prints this
comparison nightly, so it should not need a query at all.

**Risk 2 — is there an undiscovered Windy quota ceiling?**

```sql
select date, offset_deg, boxes_attempted, boxes_empty,
       round(100.0 * boxes_empty / nullif(boxes_attempted, 0), 1) as empty_pct,
       new_webcams
from daily_sweep_ring_stats
where date > current_date - 30
order by date desc, offset_deg desc;
```

The signature is `empty_pct` rising while `new_webcams` stays flat. `empty`
deliberately conflates "no cameras there" with "the call failed", because
`fetchWebcamsFor` swallows non-OK responses — that conflation is what makes
the counter a wall detector. The digest carries the whole-day `empty_pct` in
its summary line.

**Risk 3 — is the floor of 15 right, and is the budget crowding scoring?**

```sql
select date, sweep_ticks, sweep_escalated_ticks,
       sweep_sunrise_thin_ticks, sweep_sunrise_short_ticks,
       sweep_sunset_thin_ticks,  sweep_sunset_short_ticks,
       sweep_budget_exhausted_ticks,
       sweep_base_boxes, sweep_escalation_boxes
from daily_sunset_stats
where date > current_date - 30 order by date desc;
```

`thin` minus `short` is what widening recovered. `thin ≈ short` means the
rings did not help and the ordering or the offsets are wrong.
`sweep_budget_exhausted_ticks` above roughly zero is the signal to subtract
an estimated ring duration inside `hasBudget`, the start-gate finding above.

**Reference point for "is the widening expensive":** on 2026-09-02 the
production feed carried 8 sunrise and 45 sunset active cameras, and Neon
compute for this project ran 2.5-3.3 CU-hr/day, about $0.35-0.46/day at the
$0.14/CU-hr the digest assumes.

## Process note, worth keeping

The gaps the final review found were concentrated exactly where the plan's
scope ended: the *other* readers of `SEARCH_RADIUS_DEG`. Task 2 changed a
constant with seven call sites and verified two. The YouTube ceiling bug
(`1221 km` against that API's documented 1000 km cap, failing silently) would
have been caught by a "who else reads this constant, and what does each one
assume" step with a named verdict per call site. Worth adding to any future
plan that changes a shared constant.

---

## Ready-to-use prompt for the next session

Paste this to pick the work up cold.

> Read `docs/superpowers/plans/2026-09-02-adaptive-terminator-widening-followups.md`
> and its spec, `docs/superpowers/specs/2026-09-02-adaptive-terminator-widening-design.md`.
> The adaptive terminator widening feature shipped; these are the threads it
> left open.
>
> Do these three, in this order:
>
> 1. **Persist the sweep telemetry and surface it in the daily digest.** This
>    needs the `daily_sunset_stats` migration the spec deferred. The digest
>    should answer two questions at a glance: how often did a feed fall under
>    the camera floor today, and what did the extra rings cost in API calls
>    against the ~3,000/day baseline. Ring attribution (`newWebcamIds`) is
>    already recorded per ring — use it.
>
> 2. **Answer the spec's two open risks from real data**, once the telemetry
>    has a few days of history. Whether golden-hour frames from the +15.75
>    ring actually pass the detection gate, which decides if day-side-first
>    is the right ordering at all; and whether an undiscovered Windy quota
>    ceiling exists, which reads as `empty` rising while `newWebcams` stays
>    flat. If the gate rejects most golden-hour frames, revisit whether the
>    camera floor should count only gate-passers — see the first section of
>    the follow-ups doc for why that failure mode is self-concealing.
>
> 3. **Price camera refresh as its own decision.** Not the camera *list*,
>    which a 15-minute tick already over-samples, but image freshness for the
>    exhibit. Measure before proposing a cadence.
>
> Then triage the deferred findings in that doc. Three want production
> telemetry and should wait for step 2. The rest are latent traps and dead
> code; the `app/api/webcams/route.ts` bounding-box clamp is the one with a
> user-visible failure mode.
>
> Constraints that still bind: `SEARCH_RADIUS_DEG` may never exceed 11.25
> (Windy caps the box span at 22.5° on zoom 4, and rejects zoom < 4); any new
> ring offset must exceed `2 × SEARCH_RADIUS_DEG` or it re-finds cameras the
> base ring already has; and before changing any shared constant, enumerate
> every call site and give each one a named verdict — that step's absence is
> how a silent YouTube API breach reached a commit on the original branch.
