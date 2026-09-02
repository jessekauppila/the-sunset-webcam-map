import { describe, it, expect } from 'vitest';
import { mapLatToY, placeRowsVertically } from './verticalPlace';
import type { Row, SizedTile, V2Config } from './types';

const cfg = (over: Partial<V2Config> = {}): V2Config => ({
  qualitySource: 'auto', gateThreshold: 0.55, failedCamPolicy: 'showAtFloor', maxTiles: 0,
  floorPx: 100, ceilingPx: 500, curve: 'linear',
  strategy: 'anchorRelax', bandCount: 8, horizontalAnchor: 'solarAltitude',
  rowAlign: 'center', geographicFidelity: 1, tileGapPx: 0, latNorth: 70, latSouth: -60,
  showFeedLabel: true, showTileRatings: false, showModelReadout: false,
  ...over,
});

const tile = (id: number): SizedTile => ({
  id, lat: 0, lng: 0, srcWidth: 400, srcHeight: 300,
  passes: true, score: 0.5, sunAltitudeDeg: -13,
  width: 100, height: 100, pinnedToFloor: false,
});

const row = (meanLat: number, height = 100): Row => ({
  tiles: [tile(Math.round(meanLat) + 1000)], height, meanLat,
});

describe('mapLatToY', () => {
  it('puts the north edge of the window at the top', () => {
    expect(mapLatToY(70, cfg(), 1000)).toBe(0);
  });

  it('puts the south edge at the bottom', () => {
    expect(mapLatToY(-60, cfg(), 1000)).toBe(1000);
  });

  it('is linear in between', () => {
    expect(mapLatToY(5, cfg(), 1300)).toBe(650);
  });

  it('clamps latitudes outside the window', () => {
    expect(mapLatToY(89, cfg(), 1000)).toBe(0);
    expect(mapLatToY(-89, cfg(), 1000)).toBe(1000);
  });
});

describe('placeRowsVertically — fidelity 1 (true latitude)', () => {
  it('anchors a lone row at its own latitude, not the middle', () => {
    // True latitude puts this row's centre at y=0 (the north edge), but that
    // would put half of it above the panel — the top-edge correction shifts
    // the whole (single-row) block down by half its height.
    const { rows } = placeRowsVertically([row(70)], 1000, cfg({ geographicFidelity: 1 }));
    expect(rows[0].centerY).toBe(50);
  });

  it('leaves a real gap between distant latitudes', () => {
    const { rows } = placeRowsVertically(
      [row(70), row(-60)], 1000, cfg({ geographicFidelity: 1 })
    );
    expect(rows[1].centerY - rows[0].centerY).toBeGreaterThan(900);
  });
});

describe('placeRowsVertically — fidelity 0 (dense packing)', () => {
  it('stacks rows contiguously and centres the block', () => {
    const { rows } = placeRowsVertically(
      [row(70), row(-60)], 1000, cfg({ geographicFidelity: 0, tileGapPx: 0 })
    );
    expect(rows[1].centerY - rows[0].centerY).toBe(100);
    // block of 200 in a 1000 viewport -> starts at 400, centres at 450 and 550
    expect(rows[0].centerY).toBe(450);
  });
});

describe('placeRowsVertically — the relax pass', () => {
  it('pushes an overlapping row down rather than letting it collide', () => {
    const { rows } = placeRowsVertically(
      [row(10), row(9)], 1000, cfg({ geographicFidelity: 1, tileGapPx: 10 })
    );
    const gap = rows[1].centerY - rows[0].centerY;
    expect(gap).toBeGreaterThanOrEqual(110); // half+half height + gap
  });

  it('never reorders rows — north stays above south', () => {
    const { rows } = placeRowsVertically(
      [row(60), row(30), row(-30)], 1000, cfg({ geographicFidelity: 1 })
    );
    expect(rows[0].meanLat).toBe(60);
    expect(rows[2].meanLat).toBe(-30);
  });

  it('reports an extent larger than the viewport when it cannot fit', () => {
    const many = Array.from({ length: 20 }, (_, i) => row(60 - i * 6, 100));
    const { extent } = placeRowsVertically(many, 500, cfg({ geographicFidelity: 0 }));
    expect(extent).toBeGreaterThan(500);
  });

  it('handles an empty row list', () => {
    expect(placeRowsVertically([], 1000, cfg())).toEqual({ rows: [], extent: 0 });
  });

  it('never places the northernmost row above the panel', () => {
    // A row at the very north edge anchors its CENTRE to y=0, which would put
    // half of it in the bezel.
    const { rows } = placeRowsVertically(
      [row(70), row(20), row(-55)], 1000, cfg({ geographicFidelity: 1 })
    );
    expect(rows[0].centerY - rows[0].height / 2).toBeGreaterThanOrEqual(-0.001);
  });
});
