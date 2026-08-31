import { describe, it, expect } from 'vitest';
import { formRows } from './bandRows';
import type { SizedTile } from './types';

const st = (id: number, lat: number, lng: number, w = 200, h = 100): SizedTile =>
  ({ id, lat, lng, srcWidth: w, srcHeight: h, score: null, percentile: 0.5, width: w, height: h });

describe('formRows', () => {
  it('orders rows north to south by construction', () => {
    const rows = formRows([st(1, -10, 0), st(2, 50, 0), st(3, 20, 0)], 450, 2);
    const meanLats = rows.map((r) => r.meanLat);
    expect([...meanLats].sort((a, b) => b - a)).toEqual(meanLats);
    expect(rows[0].tiles.map((t) => t.id)).toContain(2);
  });
  it('sorts west→east within a row', () => {
    const rows = formRows([st(1, 0, 30), st(2, 0, -120), st(3, 0, 5)], 1000, 2);
    expect(rows[0].tiles.map((t) => t.lng)).toEqual([-120, 5, 30]);
  });
  it('wraps when width exceeded; never empty rows; single oversize tile still places', () => {
    const rows = formRows([st(1, 10, 0, 800), st(2, 5, 0, 800)], 1000, 2);
    expect(rows).toHaveLength(2);
    const big = formRows([st(1, 0, 0, 5000)], 1000, 2);
    expect(big).toHaveLength(1);
    expect(big[0].tiles).toHaveLength(1);
  });
});
