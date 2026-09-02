import { describe, it, expect } from 'vitest';
import { sunAltitudeDeg, TERMINATOR_ALTITUDE_DEG } from './solarPosition';

describe('sunAltitudeDeg', () => {
  it('is high near local solar noon at the equator on an equinox', () => {
    // 2026-03-20 12:00 UTC at 0N 0E — sun almost overhead.
    const alt = sunAltitudeDeg(new Date('2026-03-20T12:00:00Z'), 0, 0);
    expect(alt).toBeGreaterThan(80);
  });

  it('is deeply negative on the opposite side of the globe at the same instant', () => {
    const alt = sunAltitudeDeg(new Date('2026-03-20T12:00:00Z'), 0, 180);
    expect(alt).toBeLessThan(-80);
  });

  it('is near the horizon a quarter turn away', () => {
    const alt = sunAltitudeDeg(new Date('2026-03-20T12:00:00Z'), 0, -90);
    expect(Math.abs(alt)).toBeLessThan(5);
  });

  it('returns degrees, not radians', () => {
    const alt = sunAltitudeDeg(new Date('2026-03-20T12:00:00Z'), 0, 0);
    expect(Math.abs(alt)).toBeGreaterThan(Math.PI);
  });

  it('pins the terminator constant to the value masterConfig uses', () => {
    expect(TERMINATOR_ALTITUDE_DEG).toBe(-13);
  });
});
