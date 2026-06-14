import { describe, it, expect } from 'vitest';
import { arcAnchors, azToX, angDiff, sunsetAzimuth } from './solar';

describe('solar', () => {
  it('Bellingham sunset arc matches the verified values (Jun 307 / Eq 270 / Dec 233)', () => {
    const a = arcAnchors(48.75, 2026, 'west');
    expect(a.jun).toBeCloseTo(307, 0);
    expect(a.equinox).toBeCloseTo(270, 0);
    expect(a.dec).toBeCloseTo(233, 0);
  });

  it('equinox sunset is ~due west at every latitude', () => {
    expect(sunsetAzimuth(0, new Date(Date.UTC(2026, 2, 20)))).toBeCloseTo(270, 0);
    expect(sunsetAzimuth(60, new Date(Date.UTC(2026, 2, 20)))).toBeCloseTo(270, 0);
  });

  it('azToX centers the centerAz and signs deltas correctly', () => {
    expect(azToX(270, 270, 100, 360)).toBeCloseTo(180, 5); // center
    expect(azToX(320, 270, 100, 360)).toBeCloseTo(360, 5); // +half-FOV → right edge
    expect(angDiff(10, 350)).toBe(20); // wraps
  });
});
