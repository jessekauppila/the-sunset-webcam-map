// @vitest-environment node
import { describe, it, expect } from 'vitest';
import {
  WEDGE_ANGLES,
  snapWedge,
  recommendLens,
  bracketHorizontalWedge,
  HFOV,
} from './bracket';

describe('snapWedge', () => {
  it('exposes the 0-20 in 5deg ladder', () => {
    expect(WEDGE_ANGLES).toEqual([0, 5, 10, 15, 20]);
  });

  it('snaps 12 degrees to the nearest 10deg part, sign positive', () => {
    expect(snapWedge(12)).toEqual({ angle: 10, sign: 1 });
  });

  it('snaps a negative offset and records the sign', () => {
    expect(snapWedge(-8)).toEqual({ angle: 10, sign: -1 });
  });

  it('clamps magnitudes past the ladder ceiling to WEDGE_MAX', () => {
    expect(snapWedge(40)).toEqual({ angle: 20, sign: 1 });
  });
});

describe('recommendLens', () => {
  it('Bellingham sunset arc (span ~74) needs the wide lens', () => {
    // arc: jun 307 / dec 233 -> span 74 > 66
    expect(recommendLens({ jun: 307, equinox: 270, dec: 233, today: 270 })).toBe('wide');
  });

  it('a narrow arc uses the standard lens', () => {
    expect(recommendLens({ jun: 285, equinox: 270, dec: 255, today: 270 })).toBe('standard');
  });

  it('HFOV table uses the horizontal FOV (wide is 102, the Module 3 Wide H-FOV; 120 is diagonal)', () => {
    expect(HFOV).toEqual({ wide: 102, standard: 66 });
  });
});

describe('bracketHorizontalWedge', () => {
  it('is the signed difference target - windowNormal', () => {
    // window faces 262 true, equinox sunset 270 -> +8 wedge
    expect(bracketHorizontalWedge(262, 270)).toBeCloseTo(8, 5);
  });
});
