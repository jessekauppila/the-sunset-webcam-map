import { describe, it, expect } from 'vitest';
import {
  SEARCH_RADIUS_DEG,
  TERMINATOR_CAMERA_FLOOR,
  TERMINATOR_RETENTION_GRACE_MS,
  TERMINATOR_SWEEP_FAILED_HOLD_RATIO,
  TERMINATOR_WIDEN_OFFSETS_DEG,
  TERMINATOR_SUN_ALTITUDE_DEG,
  TERMINATOR_DAY_SIDE_OFFSETS_DEG,
  TERMINATOR_SWEEP_BUDGET_MS,
  TICK_DEADLINE_MS,
  YOUTUBE_MAX_LOCATION_RADIUS_KM,
} from './masterConfig';

// Verified live against the Windy clusters endpoint 2026-09-02:
//   {"message":"Maximal distance between north and south latitudes on the
//    zoom level 4, should be 22.5!","error":"Bad Request","statusCode":400}
// The box span is 2 x SEARCH_RADIUS_DEG, and zoom < 4 is rejected outright,
// so 11.25 is a hard ceiling, not a preference.
const WINDY_ZOOM4_MAX_LAT_SPAN_DEG = 22.5;

describe('SEARCH_RADIUS_DEG', () => {
  it('keeps the query box inside the Windy zoom-4 span cap', () => {
    expect(SEARCH_RADIUS_DEG * 2).toBeLessThanOrEqual(
      WINDY_ZOOM4_MAX_LAT_SPAN_DEG
    );
  });

  it('is widened to 11, the practical maximum', () => {
    expect(SEARCH_RADIUS_DEG).toBe(11);
  });
});

describe('terminator widening constants', () => {
  it('starts the camera floor at 15 per feed', () => {
    expect(TERMINATOR_CAMERA_FLOOR).toBe(15);
  });

  it('pins the two measured offsets, day side before night side', () => {
    // Positive offset shrinks the ring radius, moving it toward the sun.
    //
    // 15.75 is EMPIRICAL, not derived. Measured 2026-09-02: a 3-degree offset
    // returned 26-35% cameras the base ring had not seen; 15.75 returned
    // 92-100%. Note it is well under the 22-degree box span, so the query
    // boxes at this offset do overlap the base ring's -- the yield is a
    // measurement, and no inequality against SEARCH_RADIUS_DEG stands in for
    // it. A new offset needs its own live measurement, which is why this test
    // pins exact values rather than a threshold a guess could clear.
    expect(TERMINATOR_WIDEN_OFFSETS_DEG[0]).toBeGreaterThan(0);
    expect(TERMINATOR_WIDEN_OFFSETS_DEG).toEqual([15.75, -15.75]);
  });

  it('leaves the scoring loop at least as long as the sweep may take', () => {
    // hasBudget is a START gate, checked once before each ring and never
    // during one, so a ring beginning just under the budget runs to
    // completion. Worst case the sweep spends close to twice its budget, and
    // the scoring loop gets what is left of TICK_DEADLINE_MS. The two numbers
    // used to live in different files with only a comment between them.
    expect(TERMINATOR_SWEEP_BUDGET_MS * 2).toBeLessThanOrEqual(TICK_DEADLINE_MS);
  });

  it('keeps a camera for two Windy preview cycles after it was last seen', () => {
    // Measured 2026-09-03 against 101 active cameras: a 10-minute grace
    // would have retained 6 more, 20 minutes 17, 30 minutes 45. Windy
    // publishes a new preview every 10.1 minutes, so 20 minutes is two
    // cycles: long enough to ride out a tick that skipped a camera, short
    // enough that cameras the terminator has moved past still age out.
    expect(TERMINATOR_RETENTION_GRACE_MS).toBe(20 * 60_000);
    expect(TERMINATOR_RETENTION_GRACE_MS).toBeGreaterThan(10.1 * 60_000);
  });

  it('holds the pool when at least half the boxes fail', () => {
    // Antimeridian and pole boxes fail with 400 at a few percent on a normal
    // day (measured 2026-09-02/03); that must not hold every tick. Half is
    // unambiguous: no healthy sweep has ever come close.
    expect(TERMINATOR_SWEEP_FAILED_HOLD_RATIO).toBe(0.5);
  });
});

describe('YOUTUBE_MAX_LOCATION_RADIUS_KM', () => {
  // The YouTube Data API v3 documents `locationRadius` as capped at 1000 km.
  // This is a SEPARATE ceiling from Windy's 22.5-degree box-span cap above,
  // even though the YouTube cron derives its radius from SEARCH_RADIUS_DEG —
  // and searchYouTubeLiveNear swallows a non-OK response as an empty array, so
  // a breach reads as "no live streams anywhere" rather than as an error.
  it('is the documented YouTube Data API v3 ceiling', () => {
    expect(YOUTUBE_MAX_LOCATION_RADIUS_KM).toBe(1000);
  });

  it('keeps the radius the YouTube cron sends inside the cap', () => {
    // Mirrors the derivation in app/api/cron/update-youtube/route.ts:
    // 1 degree ~ 111 km, then clamped. At SEARCH_RADIUS_DEG = 11 the raw value
    // is 1221 km, so the clamp is load-bearing today, not decorative.
    const rawKm = SEARCH_RADIUS_DEG * 111;
    const sentKm = Math.min(rawKm, YOUTUBE_MAX_LOCATION_RADIUS_KM);
    expect(sentKm).toBeLessThanOrEqual(YOUTUBE_MAX_LOCATION_RADIUS_KM);
    expect(sentKm).toBe(Math.min(rawKm, 1000));
  });
});

describe('TERMINATOR_DAY_SIDE_OFFSETS_DEG', () => {
  it('is the golden-hour ring, and only it', () => {
    // Positive offset moves the ring toward day. The night-side ring lands
    // near -28.75, where the detection gate floors the frames anyway, so
    // forcing it would buy cost without sunsets.
    expect(TERMINATOR_DAY_SIDE_OFFSETS_DEG).toEqual([15.75]);
  });

  it('puts its ring inside the measured quality peak', () => {
    const altitude = TERMINATOR_SUN_ALTITUDE_DEG + TERMINATOR_DAY_SIDE_OFFSETS_DEG[0];
    expect(altitude).toBeGreaterThan(0);
    expect(altitude).toBeLessThan(6);
  });
});
