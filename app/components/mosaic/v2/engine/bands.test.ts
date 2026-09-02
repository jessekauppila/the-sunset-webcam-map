// app/components/mosaic/v2/engine/bands.test.ts
import { describe, it, expect } from 'vitest';
import { placeBands } from './bands';
import type { SizedTile, V2Config } from './types';

const cfg = (over: Partial<V2Config> = {}): V2Config => ({
  qualitySource: 'auto', gateThreshold: 0.55, failedCamPolicy: 'showAtFloor', maxTiles: 0,
  floorPx: 100, ceilingPx: 500, curve: 'linear',
  strategy: 'latitudeBands', bandCount: 4, horizontalAnchor: 'order',
  rowAlign: 'center', geographicFidelity: 0.7, tileGapPx: 0, latNorth: 80, latSouth: -80,
  showFeedLabel: true, showTileRatings: false, showModelReadout: false,
  ...over,
});

const tile = (id: number, lat: number, w = 100): SizedTile => ({
  id, lat, lng: 0, srcWidth: 400, srcHeight: 300,
  passes: true, score: 0.5, sunAltitudeDeg: -13,
  width: w, height: 100, pinnedToFloor: false,
});

describe('placeBands', () => {
  it('creates one row per occupied band, north to south', () => {
    // bands over [80,-80] at bandCount 4 are 40deg tall each
    const { rows } = placeBands([tile(1, 70), tile(2, -70)], { width: 1000, height: 800 }, cfg());
    expect(rows).toHaveLength(2);
    expect(rows[0].centerY).toBeLessThan(rows[1].centerY);
  });

  it('groups tiles that share a band into one row', () => {
    const { rows } = placeBands(
      [tile(1, 75), tile(2, 45)], { width: 1000, height: 800 }, cfg()
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].tiles).toHaveLength(2);
  });

  it('skips empty bands rather than leaving blank rows', () => {
    const { rows } = placeBands([tile(1, 75)], { width: 1000, height: 800 }, cfg());
    expect(rows).toHaveLength(1);
  });

  it('centres each band row on its band', () => {
    // band 0 spans the top quarter of an 800px panel -> centre 100
    const { rows } = placeBands([tile(1, 75)], { width: 1000, height: 800 }, cfg());
    expect(rows[0].centerY).toBe(100);
  });

  it('splits a band into several rows when its tiles overflow the width', () => {
    const wide = [tile(1, 75, 600), tile(2, 74, 600)];
    const { rows } = placeBands(wide, { width: 1000, height: 800 }, cfg());
    expect(rows).toHaveLength(2);
  });

  it('clamps out-of-window latitudes into the end bands', () => {
    const { rows } = placeBands([tile(1, 89), tile(2, -89)], { width: 1000, height: 800 }, cfg());
    expect(rows).toHaveLength(2);
  });

  it('reports an extent covering the placed rows', () => {
    const { extent } = placeBands([tile(1, 75), tile(2, -75)], { width: 1000, height: 800 }, cfg());
    expect(extent).toBeGreaterThan(0);
  });

  it('returns nothing for an empty pool', () => {
    expect(placeBands([], { width: 1000, height: 800 }, cfg())).toEqual({ rows: [], extent: 0 });
  });
});
