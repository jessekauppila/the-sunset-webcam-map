# Adaptive terminator widening — design

**Date:** 2026-09-02
**Status:** design, awaiting review
**Branch:** `feat/adaptive-terminator-widening`

## Problem

Kiosk panels go blank. Not because tiles are hidden — the mosaic shows every
frame, gate-failers pinned to floor size — but because the terminator pool
genuinely runs out of cameras.

Measured live on 2026-09-02: **25 cameras active** (4 sunrise, 21 sunset).
A full independent sweep run against Windy at the same moment returned **23
unique cameras from 29 successful boxes**. Nothing downstream is filtering
them out. The sweep is finding that little.

The operator wants the system to go looking for more cameras on its own when
a panel goes thin, and to stop looking once it recovers.

## What we measured

All numbers from live Windy calls on 2026-09-02, same ring, same instant.

### The search radius is capped by Windy, not by us

`masterConfig.ts` carries the note "12 doesn't work / 11 is the widest that
works" with no explanation. It is an API rule:

```
{"message":"Maximal distance between north and south latitudes on the
zoom level 4, should be 22.5!","error":"Bad Request","statusCode":400}
```

The query box spans `2 × SEARCH_RADIUS_DEG`, so the hard ceiling is 11.25.
`zoom` cannot be lowered to buy more — the API rejects `zoom < 4` outright.

| search radius | lat span | result |
| --- | --- | --- |
| 9 (today) | 18° | 200 |
| 11 | 22° | 200 |
| 12 | 24° | 400 — over the cap |

**Consequence:** widening a single ring is nearly exhausted. 9 → 11 is all
that is available, about 22% more ground.

### Small ring offsets mostly re-find the same cameras

Each ring costs ~30 API calls. Yield per ring, against the base sweep:

| ring offset | cameras | new | share new |
| --- | --- | --- | --- |
| base (0°) | 23 | — | — |
| +3° | 26 | 9 | 35% |
| −3° | 27 | 7 | 26% |
| +15.75° | 33 | 33 | 100% |
| −15.75° | 26 | 24 | 92% |

The search box is 18° across. Shifting its center by 3° leaves it on
substantially the same ground. To find new cameras the offset must be
comparable to the box size — which is what the commented-out
`1.75 * SEARCH_RADIUS_DEG` (15.75°) in `masterConfig.ts` already was.

### The two sides are not equivalent

`radius = 90 - (sunAltitude + offsetDeg)`, so a **positive offset moves the
ring toward day**.

| ring | sun altitude at ring | band with box spread | character |
| --- | --- | --- | --- |
| base | −13° | ≈ −22° to −4° | twilight into night |
| +15.75° | ≈ +2.75° | ≈ −6° to +12° | **golden hour** |
| −15.75° | ≈ −28.75° | ≈ −38° to −20° | deep night |

The current single-ring configuration misses golden hour entirely. The
day-side ring is where sunsets actually are; the night-side ring returns
frames the detection gate will floor anyway.

**Consequence:** widening is asymmetric. Day side first, night side only as
a last resort.

## Design

### 1. Baseline: search radius 9 → 11

Free. Same 30 calls, 22% more ground per call, still inside the 22.5° cap.
This is a baseline change, not a widening level.

### 2. Escalate within a tick, per feed

The decision happens **inside one cron tick**, not across ticks:

1. Sweep the base ring. Classify results into sunrise/sunset.
2. For each feed under `TERMINATOR_CAMERA_FLOOR`, sweep that feed's half of
   the **day-side** ring (+15.75°).
3. For each feed still under the floor, sweep that feed's half of the
   **night-side** ring (−15.75°).

Cameras returned by an escalation ring are classified the same way as the
base sweep — nearest ring coordinate across the full coordinate set, not
assumed to belong to the feed that triggered the sweep. A day-side box on
the sunrise half can legitimately contain a camera closer to the sunset
half, and silently forcing it into the triggering feed would corrupt the
split.

Nothing is stored between ticks. The level is re-derived every tick from what
the sweep actually returned, so it relaxes on its own the moment the
terminator moves back over land.

**Why not cross-tick hysteresis:** it oscillates. Widening succeeds, the
count rises above the high-water mark, the next tick narrows, the count
collapses, and it widens again. Deciding inside the tick has no such mode.

**Why per feed:** the ring already arrives split into halves
(`createTerminatorQueryRing` returns `sunriseCoords` / `sunsetCoords`), and
the two feeds are routinely thin at different times — 4 vs 21 on the day
this was written. Widening only the thin half halves the cost of the common
case. Note the cron currently unions both halves into `allCoords` before
fetching and classifies afterward; this design needs the base sweep
classified before the escalation decision.

### 3. Cost

Calls per tick, at `TERMINATOR_PRECISION_DEG = 12` (31 ring points, all
usable once the pole clamp lands). A feed's half-ring is ~15 points.

| situation | calls |
| --- | --- |
| both feeds healthy | ~31 |
| one feed thin, day ring | ~46 |
| one feed thin, both rings | ~61 |
| both feeds thin, both rings | ~91 |

At the unchanged 15-minute cadence that is ~3,000 calls/day today, rising
only on blank ticks.

**Read the measured yields with care.** The +15.75 / −15.75 numbers in the
table above were full-ring sweeps: one extra full ring took the pool from
23 to 56, both took it to 80. Per-feed escalation sweeps a half-ring, so a
single thin feed should expect roughly half that yield for half the calls.
The yield *rate* is what carries over, not the absolute counts.

### 4. Fail-soft on the tick budget

Extra rings are swept only if the tick has time left, reusing the existing
`TICK_DEADLINE_MS` check that already bounds the scoring loop. A slow tick
drops the extra rings rather than overrunning. Budget is checked before
each escalation step, not per call.

### 5. Pole clamp

At some declinations the ring passes within a degree of the pole and a box
is built past ±90° latitude. That call fails and returns nothing. Measured:
1 of 31 boxes on the sweep run for this design. Clamp the latitude bounds
and keep the call.

### 6. Instrumentation

Required, not optional. Without it we cannot tell whether widening helped or
whether we bought 60 extra calls for nothing — and more calls means more of
`fetchWebcamsFor`'s silent `return []` on a non-OK response.

Per tick, record and log:

- escalation level reached, per feed
- unique cameras contributed by each ring, per feed
- boxes attempted, boxes failed, boxes skipped

Surfaced in the Ops tab alongside the existing cron counters.

## Explicitly not doing

- **No cron cadence change.** The camera list tracks the terminator, which
  sweeps 15°/hour across a ~22° band, so the scene turns over roughly every
  90 minutes. A 15-minute tick is already six times finer. Widening more
  often would not find cameras sooner. Image freshness is a separate
  decision with its own cost, to be taken deliberately.
- **No small offsets.** Measured at 26–35% new; not worth 30 calls.
- **No stored escalation level.** Derived per tick.
- **No `zoom` change.** The API rejects `zoom < 4`.

## Constants

New, in `masterConfig.ts`:

| name | value | meaning |
| --- | --- | --- |
| `TERMINATOR_CAMERA_FLOOR` | 15 | per-feed camera count below which that feed widens |
| `TERMINATOR_WIDEN_OFFSETS_DEG` | `[15.75, -15.75]` | escalation rings, in order; day side first |

Changed:

| name | from | to |
| --- | --- | --- |
| `SEARCH_RADIUS_DEG` | 9 | 11 |

`TERMINATOR_RING_OFFSETS_DEG` (currently `[0]`, with the 15.75 value
commented beside it) is superseded by the escalation list and should be
removed rather than left as a second, contradictory widening mechanism.

## Testing

The escalation decision and the ring geometry are pure functions and get
unit tests:

- level selection: below floor escalates, at/above floor does not, per feed
  independently
- ordering: day-side ring is always tried before night-side
- budget: no escalation when the deadline has passed
- pole clamp: a ring point near the pole yields an in-range box
- offset geometry: `+15.75` produces a smaller radius than base

The Windy client (`fetchWebcamsFor`) is already isolated and is stubbed in
these tests. No live API calls in the suite.

## Risks

- **Windy quota is unknown.** The API publishes no rate-limit headers. Today's
  ~2,900 calls/day rises only on blank ticks under this design, so the risk is
  small, but if an undiscovered ceiling exists, exhausting it makes blank
  screens *more* common. The instrumentation's failed-box counter is the
  detector.
- **Golden-hour frames may not read as sunsets.** The +15.75 ring reaches sun
  altitudes above the horizon. Whether the detection head passes those frames
  is unmeasured. If it gates most of them, the day-side ring adds tiles at
  floor size rather than real sunsets. Worth measuring once live.
- **The 15 floor is a guess.** Chosen against a single observation (4 sunrise,
  21 sunset). Expect to tune it.
