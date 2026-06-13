// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { declinationDeg } from './declination';

describe('declinationDeg', () => {
  it('Bellingham is ~+15° east (current WMM epoch)', () => {
    const d = declinationDeg(48.75, -122.48);
    expect(d).toBeGreaterThan(13);
    expect(d).toBeLessThan(17);
  });

  it('returns a finite number for a southern-hemisphere point', () => {
    expect(Number.isFinite(declinationDeg(-33.9, 151.2))).toBe(true); // Sydney
  });
});
