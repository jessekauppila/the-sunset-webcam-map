import { describe, it, expect } from 'vitest';
import { altitudeToUnit, tileX, type AxisConfig } from './axis';
import { TERMINATOR_POOL_COVERAGE_DEG, TERMINATOR_SUN_ALTITUDE_DEG } from '@/app/lib/masterConfig';
import { V4_SETTINGS_SCHEMA } from '../settingsSchema';
import type { SizedTile } from './types';

const cfg: AxisConfig = { axisNightEdgeDeg: -24, axisDayEdgeDeg: -2 };

const sized = (over: Partial<SizedTile> = {}): SizedTile => ({
  id: 1, lat: 0, lng: 0, srcWidth: 400, srcHeight: 224,
  passes: true, score: 0.8, sunAltitudeDeg: -13,
  width: 200, height: 112, pinnedToFloor: false,
  ...over,
});

describe('altitudeToUnit', () => {
  it('puts the pool ring at the centre of the panel on both feeds', () => {
    expect(altitudeToUnit(-13, cfg, 'sunset')).toBeCloseTo(0.5, 6);
    expect(altitudeToUnit(-13, cfg, 'sunrise')).toBeCloseTo(0.5, 6);
  });

  it('puts the day side on the LEFT for sunset and the RIGHT for sunrise', () => {
    // Spec §3: west stays on the left, so the day edge swaps between feeds.
    expect(altitudeToUnit(-2, cfg, 'sunset')).toBeCloseTo(0, 6);
    expect(altitudeToUnit(-2, cfg, 'sunrise')).toBeCloseTo(1, 6);
  });

  it('clamps altitudes outside the window to an edge rather than widening it', () => {
    expect(altitudeToUnit(10, cfg, 'sunrise')).toBe(1);
    expect(altitudeToUnit(-90, cfg, 'sunrise')).toBe(0);
  });

  it('does not depend on the pool: the same altitude gives the same unit always', () => {
    expect(altitudeToUnit(-8, cfg, 'sunset')).toBe(altitudeToUnit(-8, cfg, 'sunset'));
  });

  it('degenerates to the centre rather than dividing by zero', () => {
    expect(altitudeToUnit(-13, { axisNightEdgeDeg: -2, axisDayEdgeDeg: -2 }, 'sunset')).toBe(0.5);
  });
});

describe('tileX', () => {
  it('centres a tile at the pool ring exactly on the panel centre line', () => {
    const t = sized({ sunAltitudeDeg: TERMINATOR_SUN_ALTITUDE_DEG, width: 200 });
    const x = tileX(t, 1080, cfg, 'sunset');
    expect(x + t.width / 2).toBeCloseTo(540, 6);
  });

  it('keeps a tile inside the panel at both edges', () => {
    const wide = sized({ width: 900 });
    expect(tileX({ ...wide, sunAltitudeDeg: -2 }, 1080, cfg, 'sunset')).toBe(0);
    expect(tileX({ ...wide, sunAltitudeDeg: -24 }, 1080, cfg, 'sunset')).toBe(180);
  });

  it('parks an unknown moment at the centre instead of an edge', () => {
    const t = sized({ sunAltitudeDeg: null, width: 200 });
    expect(tileX(t, 1080, cfg, 'sunset')).toBeCloseTo(440, 6);
  });

  it('centres a tile on the axis line only at the midpoint, and says how far off elsewhere', () => {
    // Documents the real relationship the centre-line overlay relies on:
    // tileCentre = unit * W + w * (0.5 - unit). An earlier comment claimed the
    // two always coincide; they coincide only at unit 0.5.
    const offCentre: AxisConfig = { axisNightEdgeDeg: -24, axisDayEdgeDeg: -6 };
    const unit = altitudeToUnit(-13, offCentre, 'sunrise');
    const t = sized({ sunAltitudeDeg: -13, width: 200 });
    const line = unit * 1080;
    const tileCentre = tileX(t, 1080, offCentre, 'sunrise') + t.width / 2;
    expect(unit).toBeCloseTo(11 / 18, 6);
    expect(line - tileCentre).toBeCloseTo(t.width * (unit - 0.5), 6);
    expect(Math.abs(line - tileCentre)).toBeGreaterThan(20);
  });

  it('never goes negative when a tile is wider than the panel', () => {
    expect(tileX(sized({ width: 2000 }), 1080, cfg, 'sunset')).toBe(0);
  });
});

describe('the Plan A / Plan B boundary (spec §6 and §8)', () => {
  const defaultOf = (key: string): number => {
    const knob = V4_SETTINGS_SCHEMA.find((k) => k.key === key);
    if (!knob || knob.kind !== 'number') throw new Error(`no number knob ${key}`);
    return knob.default;
  };

  it('the display window covers every altitude the sweep gathers', () => {
    // If this fails, the pool-coverage work widened TERMINATOR_POOL_COVERAGE_DEG
    // without moving the v3 axis dials, and the new cameras would pile up
    // clamped against a panel edge. Move the dials; do not weaken this test.
    expect(defaultOf('axisNightEdgeDeg')).toBeLessThanOrEqual(TERMINATOR_POOL_COVERAGE_DEG.min);
    expect(defaultOf('axisDayEdgeDeg')).toBeGreaterThanOrEqual(TERMINATOR_POOL_COVERAGE_DEG.max);
  });

  it('reads the coverage constant, not the sweep radius', async () => {
    // Guards the §8 contract textually: the display must not assume the
    // window equals TERMINATOR_SUN_ALTITUDE_DEG +/- SEARCH_RADIUS_DEG.
    const fs = await import('node:fs/promises');
    const src = await fs.readFile('app/components/mosaic/v4/engine/axis.ts', 'utf8');
    expect(src).not.toContain('SEARCH_RADIUS_DEG');
  });
});
