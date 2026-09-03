import { describe, it, expect } from 'vitest';
import { compose } from './compose';
import { EMPTY_HISTORY, type CompositionHistory } from './evict';
import type { TileInput, V3Config } from './types';

const cfg = (over: Partial<V3Config> = {}): V3Config => ({
  qualitySource: 'auto', gateThreshold: 0.55, failedCamPolicy: 'showAtFloor', maxTiles: 0,
  floorPx: 100, ceilingPx: 400, curve: 'linear',
  scoreFloor: 0, scoreCeiling: 1, sharedScale: true,
  bandCount: 8, bandGrid: 'full', tileGapPx: 6, latNorth: 70, latSouth: -60,
  axisNightEdgeDeg: -24, axisDayEdgeDeg: -2,
  hysteresisMargin: 0.05, minDwellMs: 90_000,
  showFeedLabel: true, showTileRatings: false, overlayScale: 1,
  showModelReadout: false, showCentreLine: false,
  ...over,
});

const tile = (
  id: number, lat: number, passes: boolean, score: number | null, alt = -13
): TileInput => ({
  id, lat, lng: id, srcWidth: 400, srcHeight: 224, passes, score, sunAltitudeDeg: alt,
});

const viewport = { width: 1080, height: 1920 };

describe('compose — basics', () => {
  it('returns an empty layout for an empty pool', () => {
    const layout = compose([], viewport, cfg(), 'sunset');
    expect(layout.tiles).toEqual([]);
    expect(layout.dropped).toEqual([]);
    expect(layout.evicted).toEqual([]);
    expect(layout.scale).toBe(1);
  });

  it('places tiles in distinct bands without either moving', () => {
    const layout = compose([tile(1, 65, true, 0.9), tile(2, -55, true, 0.9)], viewport, cfg(), 'sunset');
    expect(layout.tiles).toHaveLength(2);
    const byId = new Map(layout.tiles.map((t) => [t.id, t]));
    expect(byId.get(1)!.y).toBeLessThan(byId.get(2)!.y);
  });

  it('keeps north above south', () => {
    const layout = compose([tile(1, -50, true, 0.5), tile(2, 60, true, 0.5)], viewport, cfg(), 'sunset');
    const byId = new Map(layout.tiles.map((t) => [t.id, t]));
    expect(byId.get(2)!.y).toBeLessThan(byId.get(1)!.y);
  });
});

describe('compose — the headline property: absolute placement', () => {
  const pool = [
    tile(1, 60, true, 0.9, -20),
    tile(2, 20, true, 0.8, -10),
    tile(3, -30, true, 0.7, -5),
  ];

  it('does not move any other tile when a camera arrives', () => {
    const before = compose(pool, viewport, cfg(), 'sunset');
    const after = compose([...pool, tile(4, 45, true, 0.6, -18)], viewport, cfg(), 'sunset');
    const beforeById = new Map(before.tiles.map((t) => [t.id, t]));
    for (const t of after.tiles) {
      const was = beforeById.get(t.id);
      if (!was) continue;
      expect({ id: t.id, x: t.x, y: t.y }).toEqual({ id: was.id, x: was.x, y: was.y });
    }
  });

  it('does not move any other tile when a camera leaves', () => {
    const before = compose(pool, viewport, cfg(), 'sunset');
    const after = compose(pool.slice(1), viewport, cfg(), 'sunset');
    const beforeById = new Map(before.tiles.map((t) => [t.id, t]));
    for (const t of after.tiles) {
      const was = beforeById.get(t.id)!;
      expect({ x: t.x, y: t.y }).toEqual({ x: was.x, y: was.y });
    }
  });

  it('puts the day side on the left for sunset and the right for sunrise', () => {
    const pair = [tile(1, 0, true, 0.9, -4), tile(2, 40, true, 0.9, -22)];
    const sunset = compose(pair, viewport, cfg(), 'sunset');
    const sunrise = compose(pair, viewport, cfg(), 'sunrise');
    const x = (l: typeof sunset, id: number) => l.tiles.find((t) => t.id === id)!.x;
    expect(x(sunset, 1)).toBeLessThan(x(sunset, 2));
    expect(x(sunrise, 1)).toBeGreaterThan(x(sunrise, 2));
  });
});

describe('compose — eviction and overflow are separate stages', () => {
  it('reports crowding as evicted, not as dropped', () => {
    const crowded = [
      tile(1, 60, true, 0.9, -13),
      tile(2, 60, true, 0.5, -13),
      tile(3, 60, true, 0.4, -13),
    ];
    const layout = compose(crowded, viewport, cfg(), 'sunset');
    expect(layout.tiles.map((t) => t.id)).toEqual([1]);
    expect(layout.evicted.sort()).toEqual([2, 3]);
    expect(layout.dropped).toEqual([]);
  });

  it('does not report policy-hidden tiles as dropped or evicted', () => {
    const pool = [tile(1, 60, true, 0.9), tile(2, -50, false, 0.1)];
    const layout = compose(pool, viewport, cfg({ failedCamPolicy: 'hide' }), 'sunset');
    expect(layout.tiles.map((t) => t.id)).toEqual([1]);
    expect(layout.dropped).toEqual([]);
    expect(layout.evicted).toEqual([]);
  });

  it('shrinks uniformly before dropping anything', () => {
    // One band, tall tiles: the composition must scale rather than cull.
    const pool = [tile(1, 60, true, 1, -20), tile(2, 60, true, 1, -5)];
    const layout = compose(
      pool, { width: 1080, height: 300 }, cfg({ bandCount: 1, floorPx: 400, ceilingPx: 400 }), 'sunset'
    );
    expect(layout.scale).toBeLessThan(1);
    expect(layout.dropped).toEqual([]);
  });
});

describe('compose — hysteresis reaches the composition', () => {
  const crowded = [tile(1, 60, true, 0.50, -13), tile(2, 60, true, 0.53, -13)];

  it('keeps the incumbent when the challenger is inside the margin', () => {
    const history: CompositionHistory = { admittedSince: new Map([[1, 0]]), now: 10_000_000 };
    const layout = compose(crowded, viewport, cfg(), 'sunset', [], history);
    expect(layout.tiles.map((t) => t.id)).toEqual([1]);
  });

  it('admits the better tile with no history', () => {
    const layout = compose(crowded, viewport, cfg(), 'sunset', [], EMPTY_HISTORY);
    expect(layout.tiles.map((t) => t.id)).toEqual([2]);
  });

  it('defaults to no history when the caller omits it', () => {
    expect(compose(crowded, viewport, cfg(), 'sunset').tiles.map((t) => t.id)).toEqual([2]);
  });
});

describe('compose — purity', () => {
  it('does not mutate its inputs', () => {
    const pool = [tile(1, 60, true, 0.9), tile(2, -50, true, 0.4)];
    const snapshot = JSON.stringify(pool);
    compose(pool, viewport, cfg(), 'sunset');
    expect(JSON.stringify(pool)).toBe(snapshot);
  });

  it('returns the same layout for the same inputs', () => {
    const pool = [tile(1, 60, true, 0.9), tile(2, -50, true, 0.4)];
    const a = compose(pool, viewport, cfg(), 'sunset');
    const b = compose(pool, viewport, cfg(), 'sunset');
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe('compose — the band-grid A/B', () => {
  // Two ceiling-height tiles at opposite latitude extremes: the case that
  // makes end-band overhang decide the scale of the whole wall.
  const ends = [tile(1, 68, true, 1, -20), tile(2, -58, true, 1, -6)];
  const tall = cfg({ bandCount: 13, floorPx: 480, ceilingPx: 480 });

  it('full shrinks the whole wall because the end bands overhang', () => {
    const layout = compose(ends, viewport, cfg({ ...tall, bandGrid: 'full' }), 'sunset');
    expect(layout.scale).toBeLessThan(1);
  });

  it('inset renders the same pool at full size', () => {
    const layout = compose(ends, viewport, cfg({ ...tall, bandGrid: 'inset' }), 'sunset');
    expect(layout.scale).toBe(1);
    expect(layout.tiles).toHaveLength(2);
  });

  it('inset keeps every drawn tile inside the panel vertically', () => {
    const layout = compose(ends, viewport, cfg({ ...tall, bandGrid: 'inset' }), 'sunset');
    for (const t of layout.tiles) {
      expect(t.y).toBeGreaterThanOrEqual(-0.001);
      expect(t.y + t.height).toBeLessThanOrEqual(viewport.height + 0.001);
    }
  });

  it('does not move a tile when a camera arrives, in EITHER mode', () => {
    // The headline property must survive the fix, or the fix is not worth
    // having: the inset is derived from the ceilingPx dial, not the pool.
    for (const bandGrid of ['full', 'inset'] as const) {
      const c = cfg({ bandGrid });
      const base = [tile(1, 60, true, 0.9, -20), tile(2, 10, true, 0.8, -10)];
      const before = new Map(
        compose(base, viewport, c, 'sunset').tiles.map((t) => [t.id, `${t.x},${t.y}`])
      );
      const after = compose([...base, tile(3, 35, true, 0.7, -15)], viewport, c, 'sunset');
      for (const t of after.tiles) {
        const was = before.get(t.id);
        if (was === undefined) continue;
        expect(`${bandGrid} ${t.id}: ${t.x},${t.y}`).toBe(`${bandGrid} ${t.id}: ${was}`);
      }
    }
  });
});
