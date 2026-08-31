import { describe, it, expect } from 'vitest';
import { placeTiles } from './distributeSpace';
import { formRows } from './bandRows';
import type { SizedTile, CompositionConfig } from './types';

const cfg: CompositionConfig = { floorPx: 100, ceilPx: 300, upscaleMax: 1.5, latWindow: [70, -60], maxGrowth: 2, cullOverflow: true, padding: 0 };
const st = (id: number, lat: number, lng: number, w = 100, h = 100): SizedTile =>
  ({ id, lat, lng, srcWidth: w, srcHeight: h, score: null, percentile: 0.5, width: w, height: h });

describe('placeTiles vertical', () => {
  it('single tile lands at latitude-proportional y', () => {
    // lat 5 in window [70,-60]: fraction from top = (70-5)/130 = 0.5
    const rows = formRows([st(1, 5, 0)], 1000, 0);
    const [p] = placeTiles(rows, { width: 1000, height: 1000 }, cfg);
    // leftover S = 900; topGap weight 65, bottomGap 65 → y = 450
    expect(p.y).toBeCloseTo(450, 0);
  });
  it('dense layout (no leftover) stacks rows packed from top', () => {
    const tiles = Array.from({ length: 10 }, (_, i) => st(i, 60 - i * 10, 0, 1000, 100));
    const rows = formRows(tiles, 1000, 0);
    const placed = placeTiles(rows, { width: 1000, height: 1000 }, cfg);
    expect(Math.min(...placed.map((p) => p.y))).toBe(0);
  });
  it('row order & vertical spacing follows latitude gaps', () => {
    const rows = formRows([st(1, 60, 0), st(2, 50, 0), st(3, -50, 0)], 100, 0);
    const placed = placeTiles(rows, { width: 100, height: 1300 }, cfg);
    const y = (id: number) => placed.find((p) => p.id === id)!.y;
    expect(y(2) - y(1)).toBeLessThan(y(3) - y(2)); // 10° gap << 100° gap
  });
});

describe('placeTiles horizontal', () => {
  it('positions tiles by longitude gaps within pool range', () => {
    const rows = formRows([st(1, 0, -100), st(2, 0, 100)], 1000, 0);
    const placed = placeTiles(rows, { width: 1000, height: 200 }, cfg);
    const p1 = placed.find((p) => p.id === 1)!; const p2 = placed.find((p) => p.id === 2)!;
    expect(p1.x).toBe(0);                 // at pool min lng → left edge
    expect(p2.x + p2.width).toBeCloseTo(1000, 0); // pool max lng → right edge
  });
});
