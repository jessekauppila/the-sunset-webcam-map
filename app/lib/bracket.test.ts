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

import { solveBracket, compassName, type Facing } from './bracket';

describe('compassName', () => {
  it('names due west', () => expect(compassName(270)).toBe('W'));
  it('names due east', () => expect(compassName(90)).toBe('E'));
  it('wraps north', () => expect(compassName(359)).toBe('N'));
});

describe('solveBracket', () => {
  const facing: Facing = 'west';
  // Bellingham, window magnetic 262, declination +15.3 -> true ~277.3.
  const r = solveBracket({ lat: 48.75, year: 2026, facing, windowMagAz: 262, declinationDeg: 15.3 });

  it('converts the window normal to true north', () => {
    expect(r.normalTrue).toBeCloseTo(277.3, 1);
  });

  it('targets the equinox event azimuth (~270 due west)', () => {
    expect(r.targetAz).toBeCloseTo(270, 0);
  });

  it('snaps the ideal wedge to a manufactured part with a residual', () => {
    // real equinox sunset at 48.75N ~269.9 (not exactly 270), normalTrue 277.3
    // -> ideal wedge ~-7.37 -> snaps to 5deg, sign -1; residual ~-2.37
    expect(r.angle).toBe(5);
    expect(r.sign).toBe(-1);
    expect(r.signedWedge).toBe(-5);
    expect(r.residual).toBeCloseTo(-2.37, 1);
  });

  it('records the realized coarse aim = normalTrue + signedWedge', () => {
    expect(r.aimAz).toBeCloseTo(272.3, 1);
  });

  it('recommends the wide lens at this latitude', () => {
    expect(r.lens).toBe('wide');
  });

  it('reports which side of due-axis the window offset falls on', () => {
    // west facing, signed wedge negative -> tall end toward south
    expect(r.offsetSide).toBe('south');
  });

  it('a dead-on window has a null offset side and zero wedge', () => {
    const dead = solveBracket({ lat: 48.75, year: 2026, facing, windowMagAz: 254.7, declinationDeg: 15.3 });
    expect(dead.angle).toBe(0);
    expect(dead.offsetSide).toBeNull();
  });
});
