import { describe, it, expect } from 'vitest';
import { bandIndexForLat, bandCenterY, tileY, type BandConfig } from './bands';
import type { SizedTile } from './types';

const cfg: BandConfig = { bandCount: 13, latNorth: 70, latSouth: -60 };

const sized = (over: Partial<SizedTile> = {}): SizedTile => ({
  id: 1, lat: 47.6, lng: -122.3, srcWidth: 400, srcHeight: 224,
  passes: true, score: 0.8, sunAltitudeDeg: -13,
  width: 200, height: 112, pinnedToFloor: false,
  ...over,
});

describe('bandIndexForLat', () => {
  it('is a pure function of latitude — the pool is not an argument', () => {
    // 13 bands across 70..-60 is exactly 10 degrees each: 70..60 is band 0,
    // 60..50 is band 1, 50..40 is band 2.
    expect(bandIndexForLat(47.6, cfg)).toBe(2);
    expect(bandIndexForLat(69.9, cfg)).toBe(0);
    expect(bandIndexForLat(-59.9, cfg)).toBe(12);
  });

  it('gives the same index for the same latitude every call', () => {
    expect(bandIndexForLat(12.5, cfg)).toBe(bandIndexForLat(12.5, cfg));
  });

  it('clamps latitudes outside the window into the end bands', () => {
    expect(bandIndexForLat(89, cfg)).toBe(0);
    expect(bandIndexForLat(-89, cfg)).toBe(12);
  });

  it('survives a degenerate window instead of returning NaN', () => {
    expect(bandIndexForLat(10, { bandCount: 8, latNorth: 0, latSouth: 0 })).toBe(0);
  });

  it('floors a fractional band count and never allows zero bands', () => {
    expect(bandIndexForLat(-59.9, { ...cfg, bandCount: 2.9 })).toBe(1);
    expect(bandIndexForLat(-59.9, { ...cfg, bandCount: 0 })).toBe(0);
  });
});

describe('bandCenterY', () => {
  it('places band centres on a fixed grid independent of contents', () => {
    const c: BandConfig = { bandCount: 4, latNorth: 70, latSouth: -60 };
    expect(bandCenterY(0, 2000, c)).toBe(250);
    expect(bandCenterY(1, 2000, c)).toBe(750);
    expect(bandCenterY(3, 2000, c)).toBe(1750);
  });
});

describe('tileY', () => {
  it('centres a tile on its band whatever its height', () => {
    const c: BandConfig = { bandCount: 4, latNorth: 70, latSouth: -60 };
    expect(tileY(sized({ lat: 65, height: 100 }), 2000, c)).toBe(200);
    expect(tileY(sized({ lat: 65, height: 400 }), 2000, c)).toBe(50);
  });

  it('lets a tall tile exceed its band rather than capping it', () => {
    const c: BandConfig = { bandCount: 8, latNorth: 70, latSouth: -60 };
    // Band height is 250px; a 600px tile overhangs on both sides. Bands stay
    // fixed BECAUSE the eviction pass tests two dimensions (spec §5.3).
    const y = tileY(sized({ lat: 65, height: 600 }), 2000, c);
    expect(y).toBeLessThan(bandCenterY(0, 2000, c));
    expect(y + 600).toBeGreaterThan(bandCenterY(0, 2000, c) + 125);
  });

  it('does not move a tile when another tile appears', () => {
    // The headline property, at the level of one function: tileY has no
    // parameter through which the rest of the pool could reach it.
    const c: BandConfig = { bandCount: 8, latNorth: 70, latSouth: -60 };
    const before = tileY(sized({ lat: 12 }), 2000, c);
    const after = tileY(sized({ lat: 12 }), 2000, c);
    expect(after).toBe(before);
  });
});
