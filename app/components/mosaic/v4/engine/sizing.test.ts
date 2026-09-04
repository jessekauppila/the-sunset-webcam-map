import { describe, it, expect } from 'vitest';
import { sizeTiles } from './sizing';
import { v4Config } from './testConfig';
import type { TileInput, V4Config } from './types';

const tile = (id: number, passes: boolean, score: number | null): TileInput => ({
  id, lat: 0, lng: 0, srcWidth: 400, srcHeight: 300, passes, score, sunAltitudeDeg: -13,
});

const cfg = (over: Partial<V4Config> = {}): V4Config =>
  v4Config({ ceilingPx: 500, curve: 'linear', bandCount: 8, ...over });

describe('sizeTiles — the floor-pin directive', () => {
  it('pins every gate-failer to the EXACT floor, whatever its score', () => {
    const out = sizeTiles([tile(1, false, 0.9), tile(2, false, 0.1), tile(3, false, null)], cfg(), 'sunset');
    expect(out.map((t) => t.height)).toEqual([100, 100, 100]);
    expect(out.every((t) => t.pinnedToFloor)).toBe(true);
  });

  it('never lets a failer creep above the floor even at ceiling-level scores', () => {
    const [t] = sizeTiles([tile(1, false, 1)], cfg({ floorPx: 120, ceilingPx: 900 }), 'sunset');
    expect(t.height).toBe(120);
  });

  it('marks passers as not pinned', () => {
    const [t] = sizeTiles([tile(1, true, 0.5)], cfg(), 'sunset');
    expect(t.pinnedToFloor).toBe(false);
  });
});

describe('sizeTiles — curves', () => {
  it('linear maps score 0 to floor and 1 to ceiling', () => {
    const out = sizeTiles([tile(1, true, 0), tile(2, true, 1)], cfg({ curve: 'linear' }), 'sunset');
    expect(out[0].height).toBe(100);
    expect(out[1].height).toBe(500);
  });

  it('easeIn holds mid scores smaller than linear does', () => {
    const [lin] = sizeTiles([tile(1, true, 0.5)], cfg({ curve: 'linear' }), 'sunset');
    const [ease] = sizeTiles([tile(1, true, 0.5)], cfg({ curve: 'easeIn' }), 'sunset');
    expect(ease.height).toBeLessThan(lin.height);
    expect(ease.height).toBe(200); // 100 + 400 * 0.25
  });

  it('percentileAmongPassers ranks within the passers only', () => {
    // A failer at score 0.99 must not affect the passers' spread.
    const out = sizeTiles(
      [tile(1, true, 0.10), tile(2, true, 0.11), tile(3, false, 0.99)],
      cfg({ curve: 'percentileAmongPassers' }),
      'sunset'
    );
    const byId = new Map(out.map((t) => [t.id, t]));
    expect(byId.get(1)!.height).toBe(100); // lowest passer -> floor
    expect(byId.get(2)!.height).toBe(500); // highest passer -> ceiling
    expect(byId.get(3)!.height).toBe(100); // failer -> pinned floor
  });

  it('percentileAmongPassers gives a lone passer the ceiling', () => {
    const out = sizeTiles([tile(1, true, 0.3)], cfg({ curve: 'percentileAmongPassers' }), 'sunset');
    expect(out[0].height).toBe(500);
  });

  it('percentileAmongPassers gives tied passers an identical height', () => {
    const out = sizeTiles(
      [tile(1, true, 0.4), tile(2, true, 0.4), tile(3, true, 0.4)],
      cfg({ curve: 'percentileAmongPassers' }),
      'sunset'
    );
    expect(out[0].height).toBe(out[1].height);
    expect(out[1].height).toBe(out[2].height);
  });

  it('treats a scored-null passer as floor rather than crashing', () => {
    const out = sizeTiles([tile(1, true, null)], cfg({ curve: 'linear' }), 'sunset');
    expect(out[0].height).toBe(100);
  });

  it('marks a scored-null passer as pinned, because it IS at the floor', () => {
    const [t] = sizeTiles([tile(1, true, null)], cfg(), 'sunset');
    expect(t.height).toBe(100);
    expect(t.pinnedToFloor).toBe(true);
  });
});

describe('sizeTiles — geometry', () => {
  it('preserves the source aspect ratio', () => {
    const out = sizeTiles([tile(1, true, 1)], cfg(), 'sunset');
    expect(out[0].width / out[0].height).toBeCloseTo(400 / 300);
  });

  it('has no upscale clamp — the floor is exact', () => {
    // A tiny source must still render at the floor, not below it.
    const tiny: TileInput = { ...tile(1, false, null), srcWidth: 8, srcHeight: 6 };
    expect(sizeTiles([tiny], cfg(), 'sunset')[0].height).toBe(100);
  });
});

describe('sizeTiles — the absolute score window', () => {
  it('gives a tile the same height regardless of what else is in its pool', () => {
    // The whole point of coordinating the two panels: a 0.6 is a 0.6 whether
    // it is the best frame on a dull screen or the worst on a brilliant one.
    const alone = sizeTiles([tile(1, true, 0.6)], cfg({ curve: 'linear' }), 'sunset');
    const amongBetter = sizeTiles(
      [tile(1, true, 0.6), tile(2, true, 0.95), tile(3, true, 0.99)],
      cfg({ curve: 'linear' }),
      'sunset'
    );
    expect(amongBetter[0].height).toBe(alone[0].height);
  });

  it('maps scoreFloor to the floor and scoreCeiling to the ceiling', () => {
    const c = cfg({ curve: 'linear', scoreFloor: 0.4, scoreCeiling: 0.8 });
    const out = sizeTiles([tile(1, true, 0.4), tile(2, true, 0.6), tile(3, true, 0.8)], c, 'sunset');
    expect(out[0].height).toBe(100);
    expect(out[1].height).toBeCloseTo(300, 6);
    expect(out[2].height).toBe(500);
  });

  it('clamps scores outside the window rather than escaping floor or ceiling', () => {
    const c = cfg({ curve: 'linear', scoreFloor: 0.4, scoreCeiling: 0.8 });
    const out = sizeTiles([tile(1, true, 0.1), tile(2, true, 1)], c, 'sunset');
    expect(out.map((t) => t.height)).toEqual([100, 500]);
  });

  it('treats a degenerate window as a hard step, not a divide by zero', () => {
    const c = cfg({ curve: 'linear', scoreFloor: 0.6, scoreCeiling: 0.6 });
    const out = sizeTiles([tile(1, true, 0.59), tile(2, true, 0.6)], c, 'sunset');
    expect(out.map((t) => t.height)).toEqual([100, 500]);
  });

  it('easeIn squares the windowed value, not the raw score', () => {
    const c = cfg({ curve: 'easeIn', scoreFloor: 0.5, scoreCeiling: 1 });
    // 0.75 sits halfway through the window, so easeIn lands on 0.25.
    expect(sizeTiles([tile(1, true, 0.75)], c, 'sunset')[0].height).toBe(200);
  });

  it('leaves percentileAmongPassers untouched — it ranks, it does not read scores', () => {
    const c = cfg({ curve: 'percentileAmongPassers', scoreFloor: 0.4, scoreCeiling: 0.8 });
    const out = sizeTiles([tile(1, true, 0.01), tile(2, true, 0.02)], c, 'sunset');
    expect(out.map((t) => t.height)).toEqual([100, 500]);
  });
});

describe('sizeTiles — the exit taper', () => {
  // Window -24..-2, taper 6 deg. Score 1 renders at the 500px ceiling
  // once the tile is 6 deg or more inside the window from its exit edge.
  const taperCfg = (over: Partial<V4Config> = {}) =>
    cfg({ axisNightEdgeDeg: -24, axisDayEdgeDeg: -2, exitTaperDeg: 6, ...over });
  const at = (alt: number | null, passes = true): TileInput => ({
    ...tile(1, passes, 1), sunAltitudeDeg: alt,
  });

  it('renders a sunset tile AT the night edge at exactly the floor', () => {
    const [t] = sizeTiles([at(-24)], taperCfg(), 'sunset');
    expect(t.height).toBe(100);
  });

  it('renders a sunset tile past the night edge at the floor too', () => {
    const [t] = sizeTiles([at(-30)], taperCfg(), 'sunset');
    expect(t.height).toBe(100);
  });

  it('renders a sunset tile one taper inside the edge at its score height', () => {
    const [t] = sizeTiles([at(-18)], taperCfg(), 'sunset');
    expect(t.height).toBe(500);
  });

  it('renders halfway through the taper halfway between (smoothstep)', () => {
    const [t] = sizeTiles([at(-21)], taperCfg(), 'sunset');
    expect(t.height).toBeCloseTo(300, 6);
  });

  it('mirrors on the sunrise panel: the DAY edge is the exit', () => {
    const [atDay] = sizeTiles([at(-2)], taperCfg(), 'sunrise');
    const [inside] = sizeTiles([at(-8)], taperCfg(), 'sunrise');
    const [nightSide] = sizeTiles([at(-24)], taperCfg(), 'sunrise');
    expect(atDay.height).toBe(100);
    expect(inside.height).toBe(500);
    expect(nightSide.height).toBe(500);
  });

  it('is disabled by exitTaperDeg = 0', () => {
    const [t] = sizeTiles([at(-24)], taperCfg({ exitTaperDeg: 0 }), 'sunset');
    expect(t.height).toBe(500);
  });

  it('leaves gate-failers at the floor and null altitudes untouched', () => {
    const [failer] = sizeTiles([at(-18, false)], taperCfg(), 'sunset');
    const [unknown] = sizeTiles([at(null)], taperCfg(), 'sunset');
    expect(failer.height).toBe(100);
    expect(failer.pinnedToFloor).toBe(true);
    expect(unknown.height).toBe(500);
  });

  it('follows the width through the aspect ratio', () => {
    const [t] = sizeTiles([at(-24)], taperCfg(), 'sunset');
    expect(t.width).toBeCloseTo((100 * 400) / 300, 6);
  });
});
