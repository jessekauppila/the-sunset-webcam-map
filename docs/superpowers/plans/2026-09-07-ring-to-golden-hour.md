# Move the sweep ring to -5 degrees

**Date:** 2026-09-07. **Decision:** `TERMINATOR_SUN_ALTITUDE_DEG` moves from
-13 to -5, so the pool gathers -16 to +6 degrees of solar altitude instead
of -24 to -2. Same Windy cost. The v3/v4 axis dials move with it.

## Why

The 2026-09-02 coverage spec measured that good frames peak from -10 to +8
degrees and recommended sweeping a second, day-side ring rather than moving
the base ring. Two things changed since:

1. The forced-day-ring measurement window the opening-night runbook scheduled
   never ran. `sweep_force_day_ring` has been off since 2026-09-03. The only
   day-ring data is from natural sunrise escalation: gate pass 14-16% on the
   day ring against 7% on the base ring.
2. The glass runs `solo` / `solo2`, one frame per screen. The symmetric
   grow-then-shrink arc that made the spec want both sides of the peak is a
   v3 mosaic need, and v3 is not on the glass.

Re-measured 2026-09-07 with `scripts/altitude-quality-report.mjs` (46k
Claude-rated frames, good = llm_quality >= 0.5) plus 9.1k gold labels:

| Option | Good frames it can see | Good rate inside | Windy boxes | Good per box |
| --- | --- | --- | --- | --- |
| Ring -13 (-24..-2), before | 55% | 7.5% | 1.0x | 0.55 |
| Ring -8 (-19..+3) | 71% | 9.0% | 1.0x | 0.71 |
| **Ring -5 (-16..+6)** | **86%** | **10.7%** | **1.0x** | **0.86** |
| Two rings (-24..+13.75) | 100% | 9.8% | 1.7x | 0.58 |

Gold labels agree on the shape: below -15 degrees under 2% of labeled frames
rate 4 or higher; at -12 to -6 it is 15-17%. The -24..-16 band is where 40%
of the two-ring option's extra boxes go, and it yields 1-3% good frames.

The "100%" row is an artefact of sampling: the archive only holds frames from
where the pool has ever swept. The three windows compared are all inside the
sampled range, so the comparison between them is fair.

The old comment "-8 showed too much day time" was about how the ring line
looked on the globe, not what the pool caught.

## What moves together

- `TERMINATOR_SUN_ALTITUDE_DEG` -13 -> -5. `TERMINATOR_POOL_COVERAGE_DEG`
  derives from it and becomes -16..+6.
- v3 and v4 `axisNightEdgeDeg` -24 -> -16, `axisDayEdgeDeg` -2 -> +6. The
  axis coverage test is the tripwire that ties these to the constant. No
  stored studio row overrides them (checked `kiosk_settings` 2026-09-07).
- Escalation offsets stay at +/-15.75 (the measured magnitude). The day
  ring now sits at +10.75 and the night ring at -20.75. `masterConfig.test`
  now asserts the day ring's box still reaches the peak rather than that
  the ring itself sits inside it.
- `kiosk_sweep_zone` is rewritten by the cron on the first tick after
  deploy; solo bins age against it, so cameras at -24..-16 leave the pool
  within the 20-minute retention grace. The map's ring line reads the same
  constant and shifts with it.
- `realPool` fixtures were captured under the old ring and now crowd the
  night edge; their pinned counts are re-measured, not predicted. Recapture
  before reading them as a tuning result.

## Verify after deploy

- `daily_sweep_geometry` gets a new signature row `base-5_r11_...` with
  coverage -16..+6.
- `daily_sweep_ring_stats` base ring `frames_gate_passed / frames_scored`
  should rise from ~7% toward 10%+ over the next full day.
- Active pool (`terminator_webcam_state`) altitude spread sits in -16..+6.
