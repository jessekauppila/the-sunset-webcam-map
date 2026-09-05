import { describe, it, expect } from 'vitest';
import { sunAltitudeDeg, feedAt, inFeedZone } from './zone';

// Seattle, 2026-09-04. Sunset ~19:40 PDT = 02:40Z on 09-05; sunrise ~06:33 PDT = 13:33Z.
const SEA = { lat: 47.6062, lng: -122.3321 };

describe('zone (spec §5.3)', () => {
  it('altitude is negative at local midnight and positive at local noon', () => {
    expect(sunAltitudeDeg(new Date('2026-09-05T07:00:00Z'), SEA.lat, SEA.lng)).toBeLessThan(0);
    expect(sunAltitudeDeg(new Date('2026-09-04T20:00:00Z'), SEA.lat, SEA.lng)).toBeGreaterThan(0);
  });
  it('feedAt is sunset while the sun is falling and sunrise while it rises', () => {
    expect(feedAt(new Date('2026-09-05T02:30:00Z'), SEA.lat, SEA.lng)).toBe('sunset');
    expect(feedAt(new Date('2026-09-04T13:30:00Z'), SEA.lat, SEA.lng)).toBe('sunrise');
  });
  it('inFeedZone needs both the altitude band and the feed', () => {
    const zone = { minDeg: -24, maxDeg: -2 };
    const dusk = new Date('2026-09-05T03:30:00Z'); // ~50 min after sunset, about -8°
    expect(inFeedZone(dusk, SEA.lat, SEA.lng, 'sunset', zone)).toBe(true);
    expect(inFeedZone(dusk, SEA.lat, SEA.lng, 'sunrise', zone)).toBe(false);
    const noon = new Date('2026-09-04T20:00:00Z');
    expect(inFeedZone(noon, SEA.lat, SEA.lng, 'sunset', zone)).toBe(false);
  });
});
