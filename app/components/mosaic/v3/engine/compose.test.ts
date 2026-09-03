import { describe, it, expect } from 'vitest';
import { compose } from './compose';
import type { TileInput, V3Config } from './types';

const cfg = (over: Partial<V3Config> = {}): V3Config => ({
  qualitySource: 'auto', gateThreshold: 0.55, failedCamPolicy: 'showAtFloor', maxTiles: 0,
  floorPx: 100, ceilingPx: 400, curve: 'percentileAmongPassers',
  scoreFloor: 0, scoreCeiling: 1, sharedScale: true,
  strategy: 'anchorRelax', bandCount: 8, horizontalAnchor: 'solarAltitude',
  rowAlign: 'center', geographicFidelity: 0.7, tileGapPx: 6, latNorth: 70, latSouth: -60,
  showFeedLabel: true, showTileRatings: false, overlayScale: 1, showModelReadout: false,
  ...over,
});

const tile = (
  id: number, lat: number, passes: boolean, score: number | null, alt = -13
): TileInput => ({
  id, lat, lng: id, srcWidth: 400, srcHeight: 300, passes, score, sunAltitudeDeg: alt,
});

const viewport = { width: 1440, height: 2560 };

describe('compose — basics', () => {
  it('returns an empty layout for an empty pool', () => {
    const layout = compose([], viewport, cfg(), 'sunset');
    expect(layout.tiles).toEqual([]);
    expect(layout.dropped).toEqual([]);
    expect(layout.scale).toBe(1);
  });

  it('places every tile when the pool fits', () => {
    const layout = compose([tile(1, 50, true, 0.9), tile(2, 10, false, 0.1)], viewport, cfg(), 'sunset');
    expect(layout.tiles).toHaveLength(2);
    expect(layout.dropped).toEqual([]);
  });

  it('keeps north above south', () => {
    // Narrow panel so the two equally-sized tiles cannot share a row.
    const layout = compose(
      [tile(1, -50, true, 0.5), tile(2, 60, true, 0.5)],
      { width: 400, height: 2560 },
      cfg(),
      'sunset'
    );
    const byId = new Map(layout.tiles.map((t) => [t.id, t]));
    expect(byId.get(2)!.y).toBeLessThan(byId.get(1)!.y);
  });
});

describe('compose — visibility policies', () => {
  const pool = [tile(1, 50, true, 0.9), tile(2, 40, false, 0.4), tile(3, 30, false, 0.1)];

  it('hide removes gate-failers entirely', () => {
    const layout = compose(pool, viewport, cfg({ failedCamPolicy: 'hide' }), 'sunset');
    expect(layout.tiles.map((t) => t.id)).toEqual([1]);
  });

  it('does not report policy-hidden tiles as dropped', () => {
    const layout = compose(pool, viewport, cfg({ failedCamPolicy: 'hide' }), 'sunset');
    expect(layout.tiles).toHaveLength(1);
    expect(layout.dropped).toEqual([]);
    expect(layout.scale).toBe(1);
  });

  it('does not report maxTiles-capped tiles as dropped', () => {
    const layout = compose(pool, viewport, cfg({ maxTiles: 2 }), 'sunset');
    expect(layout.tiles).toHaveLength(2);
    expect(layout.dropped).toEqual([]);
  });

  it('showAtFloor keeps failers at exactly the floor', () => {
    const layout = compose(pool, viewport, cfg({ failedCamPolicy: 'showAtFloor' }), 'sunset');
    expect(layout.tiles).toHaveLength(3);
    for (const t of layout.tiles.filter((x) => x.id !== 1)) {
      expect(t.height).toBe(100);
    }
  });

  it('maxTiles caps the total, keeping passers first', () => {
    const layout = compose(pool, viewport, cfg({ maxTiles: 2 }), 'sunset');
    expect(layout.tiles).toHaveLength(2);
    expect(layout.tiles.map((t) => t.id)).toContain(1);
  });

  it('showIfRoom keeps all failers when there is plenty of room', () => {
    const layout = compose(pool, viewport, cfg({ failedCamPolicy: 'showIfRoom' }), 'sunset');
    expect(layout.tiles).toHaveLength(3);
  });

  it('showIfRoom drops failers rather than shrinking a crowded composition', () => {
    const crowded = Array.from({ length: 60 }, (_, i) =>
      tile(i + 1, 60 - i * 2, i < 6, i < 6 ? 0.9 : 0.1)
    );
    const small = { width: 600, height: 700 };
    const room = compose(crowded, small, cfg({ failedCamPolicy: 'showIfRoom' }), 'sunset');
    const all = compose(crowded, small, cfg({ failedCamPolicy: 'showAtFloor' }), 'sunset');
    expect(room.tiles.length).toBeLessThan(all.tiles.length);
    // every passer survives
    for (let i = 1; i <= 6; i++) {
      expect(room.tiles.some((t) => t.id === i)).toBe(true);
    }
  });
});

describe('compose — overflow', () => {
  const crowded = Array.from({ length: 80 }, (_, i) => tile(i + 1, 60 - i * 1.5, false, 0.1));

  it('scales the whole composition down instead of culling', () => {
    const layout = compose(crowded, { width: 600, height: 800 }, cfg(), 'sunset');
    expect(layout.scale).toBeLessThan(1);
    expect(layout.dropped).toEqual([]);
    expect(layout.tiles).toHaveLength(80);
  });

  it('keeps the composition inside the panel', () => {
    const layout = compose(crowded, { width: 600, height: 800 }, cfg(), 'sunset');
    for (const t of layout.tiles) {
      expect(t.x).toBeGreaterThanOrEqual(-0.001);
      expect(t.x + t.width).toBeLessThanOrEqual(600.001);
    }
  });

  it('drops only after the scale floor is exhausted, lowest scorers first', () => {
    const huge = Array.from({ length: 400 }, (_, i) =>
      tile(i + 1, 60 - i * 0.3, i === 0, i === 0 ? 0.99 : 0.01)
    );
    const layout = compose(huge, { width: 300, height: 400 }, cfg(), 'sunset');
    expect(layout.dropped.length).toBeGreaterThan(0);
    expect(layout.tiles.some((t) => t.id === 1)).toBe(true); // the passer survives
  });
});

describe('compose — strategies', () => {
  it('latitudeBands quantises rows onto bands', () => {
    const layout = compose(
      [tile(1, 65, true, 0.5), tile(2, 62, true, 0.5)],
      viewport,
      cfg({ strategy: 'latitudeBands', bandCount: 4 }),
      'sunset'
    );
    // both fall in the same band, so they share a row centre
    expect(layout.tiles[0].y).toBe(layout.tiles[1].y);
  });

  it('is deterministic — the same input yields the same layout', () => {
    const pool = [tile(1, 50, true, 0.5), tile(2, 50, true, 0.5), tile(3, 20, false, null)];
    const a = compose(pool, viewport, cfg(), 'sunset');
    const b = compose(pool, viewport, cfg(), 'sunset');
    expect(a).toEqual(b);
  });
});

describe('compose — one scale across both panels', () => {
  const panel = { width: 600, height: 800 };
  const crowded = Array.from({ length: 80 }, (_, i) => tile(i + 1, 60 - i * 1.5, false, 0.1));
  const sparse = [tile(901, 50, true, 0.9), tile(902, 20, true, 0.8)];

  it('shrinks the sparse panel to match its crowded twin', () => {
    const alone = compose(sparse, panel, cfg(), 'sunrise');
    const paired = compose(sparse, panel, cfg(), 'sunrise', crowded);
    expect(alone.scale).toBe(1);
    expect(paired.scale).toBeLessThan(1);
    expect(paired.scale).toBe(compose(crowded, panel, cfg(), 'sunset', sparse).scale);
  });

  it('leaves the crowded panel on the scale it already needed', () => {
    const alone = compose(crowded, panel, cfg(), 'sunset');
    const paired = compose(crowded, panel, cfg(), 'sunset', sparse);
    expect(paired.scale).toBe(alone.scale);
  });

  it('renders a floor tile at the same height on both panels', () => {
    const c = cfg({ curve: 'linear', floorPx: 100, ceilingPx: 400 });
    const sunriseFloor = compose(
      [...sparse, tile(903, 0, false, null)], panel, c, 'sunrise', crowded
    ).tiles.find((t) => t.id === 903)!;
    const sunsetFloor = compose(crowded, panel, c, 'sunset', sparse).tiles[0];
    expect(sunriseFloor.height).toBeCloseTo(sunsetFloor.height, 6);
  });

  it('is off by the sharedScale knob', () => {
    const paired = compose(sparse, panel, cfg({ sharedScale: false }), 'sunrise', crowded);
    expect(paired.scale).toBe(1);
  });

  it('ignores an empty peer pool', () => {
    expect(compose(sparse, panel, cfg(), 'sunrise', []).scale).toBe(1);
  });

  it('composes identically when no peer is supplied at all', () => {
    expect(compose(crowded, panel, cfg(), 'sunset')).toEqual(
      compose(crowded, panel, cfg(), 'sunset', [])
    );
  });

  it('still drops rather than overflowing when the shared scale is not enough', () => {
    const huge = Array.from({ length: 400 }, (_, i) =>
      tile(i + 1, 60 - i * 0.3, i === 0, i === 0 ? 0.99 : 0.01)
    );
    const layout = compose(huge, { width: 300, height: 400 }, cfg(), 'sunset', sparse);
    expect(layout.dropped.length).toBeGreaterThan(0);
    expect(layout.tiles.some((t) => t.id === 1)).toBe(true);
  });
});
