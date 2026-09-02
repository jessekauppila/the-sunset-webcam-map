import { describe, it, expect } from 'vitest';
import { altitudeToUnit, altitudeRange, placeRowHorizontally } from './horizontalPlace';
import type { PlacedRow, SizedTile, V2Config } from './types';

const cfg = (over: Partial<V2Config> = {}): V2Config => ({
  qualitySource: 'auto', gateThreshold: 0.55, failedCamPolicy: 'showAtFloor', maxTiles: 0,
  floorPx: 100, ceilingPx: 500, curve: 'linear',
  strategy: 'anchorRelax', bandCount: 8, horizontalAnchor: 'order',
  rowAlign: 'center', geographicFidelity: 0.7, tileGapPx: 10, latNorth: 70, latSouth: -60,
  showFeedLabel: true, showTileRatings: false, showModelReadout: false,
  ...over,
});

const tile = (id: number, lng: number, alt: number | null, w = 100): SizedTile => ({
  id, lat: 0, lng, srcWidth: 400, srcHeight: 300,
  passes: true, score: 0.5, sunAltitudeDeg: alt,
  width: w, height: 100, pinnedToFloor: false,
});

const row = (tiles: SizedTile[]): PlacedRow => ({
  tiles, height: 100, meanLat: 0, centerY: 500,
});

describe('altitudeToUnit — direction per feed', () => {
  it('sunset: a HIGHER sun is further west, so it goes left', () => {
    expect(altitudeToUnit(-5, -20, -5, 'sunset')).toBe(0);
    expect(altitudeToUnit(-20, -20, -5, 'sunset')).toBe(1);
  });

  it('sunrise: a higher sun is further east, so it goes right', () => {
    expect(altitudeToUnit(-5, -20, -5, 'sunrise')).toBe(1);
    expect(altitudeToUnit(-20, -20, -5, 'sunrise')).toBe(0);
  });

  it('centres everything when the band has no spread', () => {
    expect(altitudeToUnit(-13, -13, -13, 'sunset')).toBe(0.5);
  });
});

describe('altitudeRange', () => {
  it('spans the pool, ignoring nulls', () => {
    expect(altitudeRange([{ sunAltitudeDeg: -5 }, { sunAltitudeDeg: null }, { sunAltitudeDeg: -20 }]))
      .toEqual({ min: -20, max: -5 });
  });

  it('is null when nothing has an altitude', () => {
    expect(altitudeRange([{ sunAltitudeDeg: null }])).toBeNull();
  });
});

describe('placeRowHorizontally — order anchoring', () => {
  it('renders west to east, left to right', () => {
    const out = placeRowHorizontally(
      row([tile(2, 40, null), tile(1, -70, null)]), 1000, cfg({ horizontalAnchor: 'order' }), 'sunset', null
    );
    expect(out.map((t) => t.id)).toEqual([1, 2]);
    expect(out[0].x).toBeLessThan(out[1].x);
  });

  it('centres the row by default', () => {
    const out = placeRowHorizontally(
      row([tile(1, 0, null), tile(2, 10, null)]), 1000, cfg({ rowAlign: 'center' }), 'sunset', null
    );
    // two 100px tiles + 10px gap = 210 wide, centred in 1000 -> starts at 395
    expect(out[0].x).toBe(395);
  });

  it('west alignment pins the row to the left edge', () => {
    const out = placeRowHorizontally(
      row([tile(1, 0, null), tile(2, 10, null)]), 1000, cfg({ rowAlign: 'west' }), 'sunset', null
    );
    expect(out[0].x).toBe(0);
  });

  it('justify spreads the row edge to edge', () => {
    const out = placeRowHorizontally(
      row([tile(1, 0, null), tile(2, 10, null)]), 1000, cfg({ rowAlign: 'justify' }), 'sunset', null
    );
    expect(out[0].x).toBe(0);
    expect(out[1].x + out[1].width).toBe(1000);
  });

  it('justify falls back to centring a single-tile row', () => {
    const out = placeRowHorizontally(
      row([tile(1, 0, null)]), 1000, cfg({ rowAlign: 'justify' }), 'sunset', null
    );
    expect(out[0].x).toBe(450);
  });
});

describe('placeRowHorizontally — solarAltitude anchoring', () => {
  const altCfg = cfg({ horizontalAnchor: 'solarAltitude' });
  const range = { min: -20, max: -5 };

  it('places a west-most (highest sun) tile at the left edge on the sunset feed', () => {
    const out = placeRowHorizontally(row([tile(1, 0, -5)]), 1000, altCfg, 'sunset', range);
    expect(out[0].x).toBe(0);
  });

  it('places an east-most (lowest sun) tile at the right edge on the sunset feed', () => {
    const out = placeRowHorizontally(row([tile(1, 0, -20)]), 1000, altCfg, 'sunset', range);
    expect(out[0].x).toBe(900); // 1000 - width
  });

  it('separates tiles that are genuinely far apart in twilight depth', () => {
    const out = placeRowHorizontally(
      row([tile(1, 0, -5), tile(2, 0, -20)]), 1000, altCfg, 'sunset', range
    );
    expect(out[1].x - out[0].x).toBeGreaterThan(500);
  });

  it('de-overlaps neighbours that anchor to nearly the same altitude', () => {
    const out = placeRowHorizontally(
      row([tile(1, 0, -12.9), tile(2, 0, -13.0), tile(3, 0, -13.1)]),
      1000, altCfg, 'sunset', range
    );
    for (let i = 1; i < out.length; i++) {
      expect(out[i].x).toBeGreaterThanOrEqual(out[i - 1].x + out[i - 1].width + altCfg.tileGapPx - 0.001);
    }
  });

  it('keeps every tile inside the panel', () => {
    const out = placeRowHorizontally(
      row([tile(1, 0, -19.9), tile(2, 0, -20), tile(3, 0, -19.8)]),
      500, altCfg, 'sunset', range
    );
    for (const t of out) {
      expect(t.x).toBeGreaterThanOrEqual(0);
      expect(t.x + t.width).toBeLessThanOrEqual(500.001);
    }
  });

  it('falls back to order packing when no altitude is known', () => {
    const out = placeRowHorizontally(
      row([tile(2, 40, null), tile(1, -70, null)]), 1000, altCfg, 'sunset', null
    );
    expect(out.map((t) => t.id)).toEqual([1, 2]);
  });

  it('gives every tile the row centre as its vertical position', () => {
    const out = placeRowHorizontally(row([tile(1, 0, -13, 100)]), 1000, altCfg, 'sunset', range);
    expect(out[0].y).toBe(450); // centreY 500 - height/2
  });

  it('never reintroduces overlap when sliding an over-constrained row back', () => {
    // Wider than the panel can hold: formRows would not emit this row, but the
    // function must not corrupt the layout if it ever sees one.
    const wide = (id: number, alt: number) => ({ ...tile(id, 0, alt), width: 200, height: 100 });
    const out = placeRowHorizontally(
      row([wide(1, -13), wide(2, -13)]), 300, altCfg, 'sunset', range
    );
    for (let i = 1; i < out.length; i++) {
      expect(out[i].x).toBeGreaterThanOrEqual(out[i - 1].x + out[i - 1].width);
    }
  });
});
