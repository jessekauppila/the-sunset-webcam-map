import { describe, it, expect } from 'vitest';
import { scaleTiles, MIN_COMPOSITION_SCALE } from './overflow';
import type { SizedTile } from './types';

const tile = (id: number, w: number, h: number): SizedTile => ({
  id, lat: 0, lng: 0, srcWidth: 400, srcHeight: 300,
  passes: true, score: 0.5, sunAltitudeDeg: -13,
  width: w, height: h, pinnedToFloor: false,
});

describe('scaleTiles', () => {
  it('scales width and height by the same factor', () => {
    const [t] = scaleTiles([tile(1, 200, 100)], 0.5);
    expect(t.width).toBe(100);
    expect(t.height).toBe(50);
  });

  it('preserves relative hierarchy — a big tile stays proportionally bigger', () => {
    const out = scaleTiles([tile(1, 100, 100), tile(2, 400, 400)], 0.5);
    expect(out[1].height / out[0].height).toBe(4);
  });

  it('is a no-op at k=1', () => {
    const [t] = scaleTiles([tile(1, 200, 100)], 1);
    expect(t.width).toBe(200);
  });

  it('exposes a scale floor so tiles never vanish', () => {
    expect(MIN_COMPOSITION_SCALE).toBeGreaterThan(0);
    expect(MIN_COMPOSITION_SCALE).toBeLessThan(1);
  });
});
