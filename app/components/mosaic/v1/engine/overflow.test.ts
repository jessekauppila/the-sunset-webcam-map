import { describe, it, expect } from 'vitest';
import { fitToViewport } from './overflow';
import type { SizedTile, CompositionConfig } from './types';

const cfg: CompositionConfig = { floorPx: 100, ceilPx: 300, upscaleMax: 1.5, latWindow: [70, -60], maxGrowth: 2, cullOverflow: true, padding: 0 };
const st = (id: number, percentile: number, h = 200): SizedTile =>
  ({ id, lat: 0, lng: id, srcWidth: 400, srcHeight: 400, score: percentile * 5, percentile, width: h, height: h });

describe('fitToViewport (cull mode)', () => {
  it('returns unchanged when it fits', () => {
    const r = fitToViewport([st(1, 0.5)], { width: 1000, height: 1000 }, cfg);
    expect(r.dropped).toEqual([]);
  });
  it('drops lowest percentile first until fit', () => {
    // 3 tiles of 200px stacked in 1 column (viewport width 250) = 600 > 450 → drop one
    const r = fitToViewport([st(1, 0.9), st(2, 0.1), st(3, 0.5)], { width: 250, height: 450 }, cfg);
    expect(r.dropped).toEqual([2]);
    expect(r.kept.map((t) => t.id).sort()).toEqual([1, 3]);
  });
  it('never drops the last tile', () => {
    const r = fitToViewport([st(1, 0.5, 5000)], { width: 100, height: 100 }, cfg);
    expect(r.kept).toHaveLength(1);
  });
});

describe('fitToViewport (compress mode)', () => {
  const soft = { ...cfg, cullOverflow: false };
  it('compresses instead of dropping when possible', () => {
    const r = fitToViewport([st(1, 0.9), st(2, 0.1), st(3, 0.5)], { width: 250, height: 450 }, soft);
    expect(r.dropped).toEqual([]);
    for (const t of r.kept) expect(t.height).toBeGreaterThanOrEqual(100);
    const total = r.rows.reduce((a, row) => a + row.height, 0);
    expect(total).toBeLessThanOrEqual(450);
  });
  it('culls as last resort when even floor-size overflows', () => {
    const many = Array.from({ length: 30 }, (_, i) => st(i + 1, i / 29, 100));
    const r = fitToViewport(many, { width: 100, height: 350 }, soft);
    expect(r.dropped.length).toBeGreaterThan(0);
  });
});
