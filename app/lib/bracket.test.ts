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

import { buildPreRegisterPayload } from './bracket';

describe('buildPreRegisterPayload', () => {
  const sol = solveBracket({ lat: 48.75, year: 2026, facing: 'west', windowMagAz: 262, declinationDeg: 15.3 });

  const payload = buildPreRegisterPayload({
    claimCode: 'SUNSET-7K3M-9XQ2',
    lat: 47.6062, lng: -122.3321, elevationM: 30, timezone: 'America/Los_Angeles',
    facing: 'west', solution: sol, declinationDeg: 15.3, delivery: null,
  });

  it('carries the realized coarse aim as azimuth_deg', () => {
    expect(payload.placement.azimuth_deg).toBeCloseTo(sol.aimAz, 5);
  });

  it('pins v1 invariants: tilt 0, horizon flat, profile null', () => {
    expect(payload.placement.tilt_deg).toBe(0);
    expect(payload.placement.horizon_altitude_deg).toBe(0);
    expect(payload.placement.horizon_profile).toBeNull();
  });

  it('sets the bracket-source signals required for sun self-refine (I-5)', () => {
    expect(payload.placement.azimuth_source).toBe('bracket');
    expect(payload.placement.coarse).toBe(true);
  });

  it('maps the lens to the wire enum', () => {
    expect(payload.placement.bracket.lens).toBe('wide_120');
  });

  it('carries full bracket provenance', () => {
    const b = payload.placement.bracket;
    expect(b.window_normal_az_true).toBeCloseTo(sol.normalTrue, 5);
    expect(b.window_azimuth_offset_deg).toBeCloseTo(Math.abs(sol.offset), 1);
    expect(b.window_offset_side).toBe('south');
    expect(b.wedge_angle_deg).toBe(5);
    expect(b.flip_direction).toBe('south');
    expect(b.residual_aim_error_deg).toBeCloseTo(Math.abs(sol.residual), 1);
    expect(b.material_thickness_mm).toBe(3.0);
  });

  it('phase preference is the single-aimed facing (sunset for west), never both (D-8)', () => {
    expect(payload.operator_preferences.phase_preference).toBe('sunset');
  });

  it('delivery is null when skipped', () => {
    expect(payload.operator_preferences.delivery).toBeNull();
  });

  it('flip_direction is null for a dead-on 0deg window', () => {
    const dead = solveBracket({ lat: 48.75, year: 2026, facing: 'west', windowMagAz: 254.7, declinationDeg: 15.3 });
    const p = buildPreRegisterPayload({
      claimCode: 'SUNSET-7K3M-9XQ2', lat: 1, lng: 2, elevationM: null,
      timezone: 'UTC', facing: 'west', solution: dead, declinationDeg: 15.3, delivery: null,
    });
    expect(p.placement.bracket.flip_direction).toBeNull();
    expect(p.placement.bracket.window_offset_side).toBeNull();
  });
});
