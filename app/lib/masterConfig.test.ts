import { describe, it, expect } from 'vitest';
import { SEARCH_RADIUS_DEG } from './masterConfig';

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
