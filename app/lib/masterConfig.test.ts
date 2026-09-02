import { describe, it, expect } from 'vitest';
import { SEARCH_RADIUS_DEG } from './masterConfig';
import {
  TERMINATOR_CAMERA_FLOOR,
  TERMINATOR_WIDEN_OFFSETS_DEG,
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

  it('tries the day side before the night side', () => {
    // Positive offset shrinks the ring radius, moving it toward the sun.
    expect(TERMINATOR_WIDEN_OFFSETS_DEG[0]).toBeGreaterThan(0);
    expect(TERMINATOR_WIDEN_OFFSETS_DEG).toEqual([15.75, -15.75]);
  });

  it('offsets the ring by more than a box width, or it re-finds the same cameras', () => {
    // Measured 2026-09-02: a 3-degree offset against an 18-degree box returned
    // only 26-35% new cameras; 15.75 returned 92-100%.
    for (const off of TERMINATOR_WIDEN_OFFSETS_DEG) {
      expect(Math.abs(off)).toBeGreaterThanOrEqual(SEARCH_RADIUS_DEG);
    }
  });
});
