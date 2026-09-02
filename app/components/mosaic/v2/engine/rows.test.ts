import { describe, it, expect } from 'vitest';
import { formRows } from './rows';
import type { SizedTile } from './types';

const sized = (id: number, lat: number, w: number, h = 100): SizedTile => ({
  id, lat, lng: 0, srcWidth: 400, srcHeight: 300,
  passes: true, score: 0.5, sunAltitudeDeg: -13,
  width: w, height: h, pinnedToFloor: false,
});

describe('formRows', () => {
  it('walks north to south', () => {
    const rows = formRows([sized(1, -40, 100), sized(2, 60, 100), sized(3, 10, 100)], 200, 0);
    expect(rows[0].tiles[0].id).toBe(2);
    expect(rows[rows.length - 1].tiles.at(-1)!.id).toBe(1);
  });

  it('breaks a row when the next tile would overflow the width', () => {
    const rows = formRows([sized(1, 50, 120), sized(2, 40, 120)], 200, 0);
    expect(rows).toHaveLength(2);
  });

  it('counts the gap toward the width budget', () => {
    // 2x95 = 190 fits in 200 on its own. With a 10px gap it exactly fills the
    // 200px budget and still fits; a 20px gap pushes it to 210 and it must wrap.
    expect(formRows([sized(1, 50, 95), sized(2, 40, 95)], 200, 10)).toHaveLength(1);
    expect(formRows([sized(1, 50, 95), sized(2, 40, 95)], 200, 20)).toHaveLength(2);
  });

  it('always places an over-wide tile rather than looping forever', () => {
    const rows = formRows([sized(1, 50, 5000)], 200, 6);
    expect(rows).toHaveLength(1);
    expect(rows[0].tiles[0].id).toBe(1);
  });

  it('reports the row height as its tallest member', () => {
    const rows = formRows([sized(1, 50, 50, 100), sized(2, 40, 50, 250)], 500, 0);
    expect(rows[0].height).toBe(250);
  });

  it('reports the mean latitude of its members', () => {
    const rows = formRows([sized(1, 60, 50), sized(2, 40, 50)], 500, 0);
    expect(rows[0].meanLat).toBe(50);
  });

  it('returns no rows for an empty pool', () => {
    expect(formRows([], 500, 6)).toEqual([]);
  });
});
