# Terminator pool coverage — reaching the altitudes where sunsets actually are

**Date:** 2026-09-02
**Status:** Design approved in conversation. Phase 1 is measurement, and the
final choice is deliberately deferred until it reports.
**Sibling spec:** `2026-09-02-mosaic-v3-band-paradigm-design.md` (Plan A). The
two meet at one boundary, defined in §6.

---

## 1. The problem, measured

Run 2026-09-02 against 46,079 scored snapshots joined to camera coordinates,
solar altitude computed per frame with SunCalc at capture time. Share of frames
Claude scored at or above 0.5:

| sun altitude | frames | good |
|---|---|---|
| −16° to −14° | 2,577 | 1.0% |
| −12° to −10° | 3,040 | 3.3% |
| −8° to −6° | 5,862 | 10.8% |
| −2° to 0° | 1,959 | 14.9% |
| **0° to +2°** | 1,701 | **19.7%** |
| **+4° to +6°** | 2,167 | **19.4%** |

Good sunsets happen with the sun just above the horizon. The 4,525 good frames
come from 679 distinct cameras, top camera 3.8%, top ten 22.6%, so this is not
a few sites skewing the result. Only 55% of them fall inside the −24° to −2°
window the pool can currently see.

Reproduce with `node scripts/altitude-quality-report.mjs`.

**The base ring sits at −13°, where roughly one frame in a hundred is good.**
Twenty times better lies at 0° to +6°. The pool gathers within
`SEARCH_RADIUS_DEG` (11°) of the ring, so it spans −24° to −2° and never sees
the peak.

`masterConfig.ts` already records the same conclusion in a comment on
`TERMINATOR_WIDEN_OFFSETS_DEG`: the `+15.75` offset "puts the ring near +2.75
degrees solar altitude (golden hour, which the base ring at −13 misses
entirely)."

### Why this matters beyond image quality

The display paradigm in Plan A wants a camera to grow as it approaches its
sunset and shrink after. That arc has two halves and **the growth half lives at
altitudes the pool never collects.** On the sunset panel a camera appears at
the day edge already past its peak and can only shrink. No display change fixes
this. It is a coverage problem.

---

## 2. Two candidate answers, and why the obvious one is probably wrong

**Move the ring.** Change `TERMINATOR_SUN_ALTITUDE_DEG` from −13 toward day.
This *shifts* the pool: it buys the day side and sells the night side. At −4
the pool would span −15° to +7°.

**Sweep two rings.** Keep the base ring and stop gating the existing day-side
escalation ring behind a camera shortage. This *adds*: the pool becomes the
union, roughly −24° through +14°, straddling the quality peak on both sides.

**The union is what the paradigm actually needs.** A symmetric arc requires
both sides of the peak. Moving the ring alone would only relocate where the arc
gets truncated, and would give up the deep-twilight tail that the wall
currently shows. Sweeping two rings is also the lower-risk change: it removes
no camera anyone sees today, and the machinery already exists and was measured
returning 92 to 100% cameras the base ring had never seen, versus 26 to 35% for
a 3-degree offset.

There is also a hard empirical wall against moving the base ring, recorded in
`masterConfig.ts`: "15 doesn't work. 14 is the highest that works," and "−8
showed too much day time." The constant interacts with Windy's zoom-4 box span
cap of 22.5°, and `SEARCH_RADIUS_DEG` at 11 is already near that ceiling.

**Recommendation: sweep two rings.** Moving the base ring stays available but
is not the plan.

---

## 3. Phase 1 — measure before committing

The deciding facts are not in hand. Phase 1 writes no production behaviour
change; it turns the escalation ring on **behind a flag, for a bounded window**,
and reads the telemetry that already exists.

Questions phase 1 must answer:

1. **Yield that survives scoring.** How many day-ring cameras does the
   detection gate actually pass? The failure mode is self-concealing: a ring
   that adds cameras the gate then floors reads as success in both the
   escalation count and the new-camera count. `sweepStats.ts` already splits
   `framesScored` and `framesGatePassed` per ring for exactly this reason.
2. **Sweep budget.** `TERMINATOR_SWEEP_BUDGET_MS` is 25s inside a tick whose
   deadline is 50s. How often does an always-escalated sweep exhaust it?
   `budgetExhaustedTicks` already tracks this.
3. **Cost.** Windy boxes per day against the ~3,000 baseline, plus the scoring
   spend on the additional frames. `baseBoxes` and `escalationBoxes` already
   separate the bill this feature adds.

Do not skip phase 1. Every number in `masterConfig.ts` around this feature is
annotated as measured or as "chosen against a single observation," and that
discipline is why the widening work is trustworthy.

---

## 4. Cost posture

The operator has approved spending on this for the show, with two conditions.

- **It must be reversible by a switch**, so spending can be brought back down
  without a code change or a redeploy. Env vars bake in at deploy time in this
  project, so a switch that requires `vercel redeploy` to take effect does not
  satisfy this. Prefer a stored setting the cron reads at tick time.
- **The bill must be visible in the daily digest.**

For reference, this system was driven from about $60/month to about $0.44/day
in July 2026. The digest email goes out around 5pm Pacific.

---

## 5. Digest metrics

Most of what was asked for already ships. `formatSweepLine` in
`dailyDigest.ts` reports per-ring boxes, escalation cost against the base,
per-ring gate-pass rates, thin-feed counts, and budget exhaustion.

What to add:

- **The altitude range actually swept**, expressed in degrees, so the operator
  can read at a glance how wide the pool got. Today the digest reports ring
  offsets; the useful form is the resulting solar-altitude span.
- **A cost line for the widening**, so the escalation boxes read as money
  rather than as a count.

Keep the existing per-ring gate-pass clause prominent. It is the only thing
that distinguishes widening that adds sunsets from widening that adds cameras
the gate floors.

---

## 6. The boundary with Plan A

- **This spec owns** the altitude range the sweep gathers, and **must export it
  as a named constant** describing the union of every ring swept. Plan A's
  display window test reads that constant.
- **Plan A owns** the display window and must not assume it equals
  `TERMINATOR_SUN_ALTITUDE_DEG ± SEARCH_RADIUS_DEG`.
- Widening the pool without Plan A's window dials produces no visible change,
  because the new day-side cameras clamp to the panel edge. Widening is
  therefore best judged after Plan A lands, though it can be measured before.

Neither plan blocks the other.

---

## 7. Implementation sketch

Phase 1, measurement:

1. A stored setting the cron reads per tick, defaulting off, that forces the
   day-side ring regardless of `TERMINATOR_CAMERA_FLOOR`.
2. Extend `SweepRingStats` only if a needed field is genuinely missing. Check
   first; most of it is there.
3. Run for a bounded window and report against §3's three questions.

Phase 2, decision and rollout, only after phase 1 reports:

4. Choose always-on, conditional, or a narrower offset, from the measured
   yield and cost.
5. Export the coverage constant for Plan A.
6. Add the digest lines from §5.

---

## 8. Testing

- The forced-escalation switch is honoured per tick and defaults off.
- With the switch off, sweep behaviour is byte-for-byte what it is today.
- Per-ring attribution stays correct when both rings find the same camera:
  the ring that *first* saw it gets the credit, which is the existing rule.
- The exported coverage constant matches the rings actually swept, including
  when the switch is off.
- Budget exhaustion still sacrifices escalation rings first. The scoring loop
  needs the remaining tick more than the pool needs extra cameras.

---

## 9. Out of scope

- Every display-side change — Plan A.
- Moving `TERMINATOR_SUN_ALTITUDE_DEG`. Kept as a documented fallback in §2,
  not planned work.
- Raising `SEARCH_RADIUS_DEG`. It is at 11 against a hard Windy ceiling of
  11.25, verified live 2026-09-02 and guarded by `masterConfig.test.ts`.
- The `captured_at` column type. Timestamps were verified correct on
  2026-09-02; see Plan A §2.
- Camera-level reputation and consistent-false-positive exclusion, still a
  future workstream from the phase-2 decisions doc.
