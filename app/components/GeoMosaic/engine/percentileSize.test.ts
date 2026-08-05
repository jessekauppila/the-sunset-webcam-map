import { describe, it, expect } from 'vitest';
import { computePercentiles, preferredHeight, sizeTiles } from './percentileSize';
import type { TileInput, CompositionConfig } from './types';

const cfg: CompositionConfig = { floorPx: 100, ceilPx: 300, upscaleMax: 1.5, latWindow: [70, -60], maxGrowth: 2, cullOverflow: true, padding: 2 };
const t = (id: number, score: number | null, srcH = 400): TileInput =>
  ({ id, lat: 0, lng: 0, srcWidth: srcH * 1.78, srcHeight: srcH, score });

describe('computePercentiles', () => {
  it('ranks scored tiles 0..1 ascending', () => {
    const p = computePercentiles([t(1, 2.0), t(2, 3.0), t(3, 4.0)]);
    expect(p.get(1)).toBe(0); expect(p.get(2)).toBe(0.5); expect(p.get(3)).toBe(1);
  });
  it('unscored gets 0.5 regardless of scored distribution', () => {
    const p = computePercentiles([t(1, 5.0), t(2, null)]);
    expect(p.get(2)).toBe(0.5);
  });
  it('all-null pool → everyone 0.5', () => {
    const p = computePercentiles([t(1, null), t(2, null)]);
    expect(p.get(1)).toBe(0.5); expect(p.get(2)).toBe(0.5);
  });
  it('all-equal scores → everyone same percentile', () => {
    const p = computePercentiles([t(1, 3), t(2, 3), t(3, 3)]);
    expect(p.get(1)).toBe(p.get(2)); expect(p.get(2)).toBe(p.get(3));
  });
});

describe('preferredHeight', () => {
  it('maps percentile 0 → floor, 1 → ceil', () => {
    expect(preferredHeight(t(1, 2), 0, cfg)).toBe(100);
    expect(preferredHeight(t(1, 5), 1, cfg)).toBe(300);
  });
  it('upscale ceiling clamps, and may go below the floor for tiny sources', () => {
    expect(preferredHeight(t(1, 5, 112), 1, cfg)).toBe(168); // 112*1.5
    expect(preferredHeight(t(1, 5, 60), 1, cfg)).toBe(90);   // below floor, allowed
  });
});

describe('sizeTiles', () => {
  it('preserves aspect ratio', () => {
    const [s] = sizeTiles([t(1, 3, 400)], cfg);
    expect(s.width / s.height).toBeCloseTo(1.78, 1);
  });
});
