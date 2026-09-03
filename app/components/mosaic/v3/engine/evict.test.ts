import { describe, it, expect } from 'vitest';
import {
  admit, baseQuality, overlaps, protectedByDwell, EMPTY_HISTORY,
  type CompositionHistory, type EvictionConfig,
} from './evict';
import type { PlacedTile } from './types';

const cfg: EvictionConfig = { tileGapPx: 6, hysteresisMargin: 0, minDwellMs: 0 };

const at = (
  id: number, x: number, y: number, score: number | null,
  over: Partial<PlacedTile> = {}
): PlacedTile => ({
  id, lat: 0, lng: 0, srcWidth: 400, srcHeight: 224,
  passes: score !== null, score, sunAltitudeDeg: -13,
  width: 100, height: 100, pinnedToFloor: false, x, y,
  ...over,
});

describe('overlaps', () => {
  it('separates rectangles that clear each other by more than the gap', () => {
    expect(overlaps(at(1, 0, 0, 1), at(2, 110, 0, 1), 6)).toBe(false);
  });

  it('reports an intersection when the gap is not honoured', () => {
    expect(overlaps(at(1, 0, 0, 1), at(2, 104, 0, 1), 6)).toBe(true);
  });

  it('tests the VERTICAL axis too, not just the horizontal', () => {
    // Same x, stacked. A horizontal-only test would call this clear.
    expect(overlaps(at(1, 0, 0, 1), at(2, 0, 50, 1), 6)).toBe(true);
    expect(overlaps(at(1, 0, 0, 1), at(2, 0, 110, 1), 6)).toBe(false);
  });

  it('catches a tile taller than its band reaching into the next one', () => {
    const tall = at(1, 0, 0, 1, { height: 600 });
    const neighbour = at(2, 0, 400, 1);
    expect(overlaps(tall, neighbour, 6)).toBe(true);
  });
});

describe('baseQuality', () => {
  it('ranks every gate-failer below every passer', () => {
    expect(baseQuality(at(1, 0, 0, null))).toBeLessThan(baseQuality(at(2, 0, 0, 0)));
  });

  it('ranks a passer with no score with the failers, not at the top', () => {
    const unscored = at(1, 0, 0, null, { passes: true });
    expect(baseQuality(unscored)).toBe(-1);
  });
});

describe('admit', () => {
  it('admits everything when nothing collides', () => {
    const { admitted, evicted } = admit([at(1, 0, 0, 0.9), at(2, 300, 0, 0.2)], EMPTY_HISTORY, cfg);
    expect(admitted.map((t) => t.id)).toEqual([1, 2]);
    expect(evicted).toEqual([]);
  });

  it('keeps the better sunset and evicts the worse one', () => {
    const { admitted, evicted } = admit([at(1, 0, 0, 0.2), at(2, 20, 0, 0.9)], EMPTY_HISTORY, cfg);
    expect(admitted.map((t) => t.id)).toEqual([2]);
    expect(evicted).toEqual([1]);
  });

  it('does NOT move the admitted tile to make room', () => {
    const { admitted } = admit([at(1, 0, 0, 0.2), at(2, 20, 0, 0.9)], EMPTY_HISTORY, cfg);
    expect(admitted[0].x).toBe(20);
    expect(admitted[0].y).toBe(0);
  });

  it('lets one large tile evict several neighbours — it earned the space', () => {
    const big = at(1, 0, 0, 0.9, { width: 500, height: 500 });
    const { admitted, evicted } = admit(
      [big, at(2, 100, 100, 0.5), at(3, 300, 300, 0.4)],
      EMPTY_HISTORY, cfg
    );
    expect(admitted.map((t) => t.id)).toEqual([1]);
    expect(evicted.sort()).toEqual([2, 3]);
  });

  it('is deterministic and order-independent given the same inputs', () => {
    const pool = [at(1, 0, 0, 0.4), at(2, 20, 0, 0.9), at(3, 40, 0, 0.4), at(4, 500, 0, 0.1)];
    const a = admit(pool, EMPTY_HISTORY, cfg);
    const b = admit([...pool].reverse(), EMPTY_HISTORY, cfg);
    expect(a.admitted.map((t) => t.id)).toEqual(b.admitted.map((t) => t.id));
    expect([...a.evicted].sort()).toEqual([...b.evicted].sort());
  });

  it('breaks exact ties by id so equal scores do not churn between ticks', () => {
    const { admitted } = admit([at(7, 20, 0, 0.5), at(3, 0, 0, 0.5)], EMPTY_HISTORY, cfg);
    expect(admitted.map((t) => t.id)).toEqual([3]);
  });

  it('reports evictions rather than silently shrinking the pool', () => {
    const { admitted, evicted } = admit(
      [at(1, 0, 0, 0.9), at(2, 10, 0, 0.8), at(3, 20, 0, 0.7)],
      EMPTY_HISTORY, cfg
    );
    expect(admitted.length + evicted.length).toBe(3);
  });

  it('does not mutate the array it was handed', () => {
    const pool = [at(1, 0, 0, 0.2), at(2, 20, 0, 0.9)];
    const snapshot = pool.map((t) => t.id);
    admit(pool, EMPTY_HISTORY, cfg);
    expect(pool.map((t) => t.id)).toEqual(snapshot);
  });
});

describe('hysteresis — the incumbency bonus', () => {
  const withMargin: EvictionConfig = { tileGapPx: 6, hysteresisMargin: 0.05, minDwellMs: 0 };
  const incumbentIsTile1: CompositionHistory = {
    admittedSince: new Map([[1, 0]]),
    now: 10_000_000,
  };

  it('keeps the incumbent when the challenger is inside the margin', () => {
    const { admitted } = admit(
      [at(1, 0, 0, 0.50), at(2, 20, 0, 0.53)],
      incumbentIsTile1,
      withMargin
    );
    expect(admitted.map((t) => t.id)).toEqual([1]);
  });

  it('lets the challenger through once it beats the margin', () => {
    const { admitted } = admit(
      [at(1, 0, 0, 0.50), at(2, 20, 0, 0.58)],
      incumbentIsTile1,
      withMargin
    );
    expect(admitted.map((t) => t.id)).toEqual([2]);
  });

  it('gives no bonus to a tile that was not on screen', () => {
    const { admitted } = admit(
      [at(1, 0, 0, 0.50), at(2, 20, 0, 0.53)],
      EMPTY_HISTORY,
      withMargin
    );
    expect(admitted.map((t) => t.id)).toEqual([2]);
  });
});

describe('hysteresis — the minimum dwell', () => {
  const withDwell: EvictionConfig = { tileGapPx: 6, hysteresisMargin: 0, minDwellMs: 90_000 };

  it('protects a tile that has been on screen for less than the dwell', () => {
    const fresh: CompositionHistory = { admittedSince: new Map([[1, 1_000]]), now: 31_000 };
    expect(protectedByDwell(at(1, 0, 0, 0.1), fresh, withDwell)).toBe(true);
    const { admitted } = admit([at(1, 0, 0, 0.1), at(2, 20, 0, 0.9)], fresh, withDwell);
    expect(admitted.map((t) => t.id)).toEqual([1]);
  });

  it('releases the protection once the dwell has elapsed', () => {
    const settled: CompositionHistory = { admittedSince: new Map([[1, 1_000]]), now: 200_000 };
    expect(protectedByDwell(at(1, 0, 0, 0.1), settled, withDwell)).toBe(false);
    const { admitted } = admit([at(1, 0, 0, 0.1), at(2, 20, 0, 0.9)], settled, withDwell);
    expect(admitted.map((t) => t.id)).toEqual([2]);
  });

  it('never protects a tile that was not on screen at all', () => {
    const fresh: CompositionHistory = { admittedSince: new Map([[1, 1_000]]), now: 31_000 };
    expect(protectedByDwell(at(9, 0, 0, 0.9), fresh, withDwell)).toBe(false);
  });

  it('resolves a fight between two protected tiles by quality, deterministically', () => {
    const both: CompositionHistory = {
      admittedSince: new Map([[1, 1_000], [2, 1_000]]),
      now: 31_000,
    };
    const { admitted, evicted } = admit([at(1, 0, 0, 0.2), at(2, 20, 0, 0.8)], both, withDwell);
    expect(admitted.map((t) => t.id)).toEqual([2]);
    expect(evicted).toEqual([1]);
  });

  it('a dwell of zero protects nobody', () => {
    const fresh: CompositionHistory = { admittedSince: new Map([[1, 1_000]]), now: 1_000 };
    expect(protectedByDwell(at(1, 0, 0, 0.1), fresh, { ...withDwell, minDwellMs: 0 })).toBe(false);
  });
});
