import { describe, it, expect } from 'vitest';
import { splitPool, applyPolicy, capTiles } from './visibility';
import type { TileInput, V2Config } from './types';

const tile = (id: number, passes: boolean, score: number | null): TileInput => ({
  id, lat: 0, lng: 0, srcWidth: 400, srcHeight: 300, passes, score, sunAltitudeDeg: -13,
});

const cfg = (over: Partial<V2Config> = {}): V2Config => ({
  qualitySource: 'auto', gateThreshold: 0.55, failedCamPolicy: 'showAtFloor', maxTiles: 0,
  floorPx: 100, ceilingPx: 480, curve: 'percentileAmongPassers',
  strategy: 'anchorRelax', bandCount: 8, horizontalAnchor: 'solarAltitude',
  rowAlign: 'center', geographicFidelity: 0.7, tileGapPx: 6, latNorth: 70, latSouth: -60,
  showFeedLabel: true, showTileRatings: false, showModelReadout: false,
  ...over,
});

describe('splitPool', () => {
  it('separates passers from failers', () => {
    const { passers, failers } = splitPool([tile(1, true, 0.9), tile(2, false, 0.2)]);
    expect(passers.map((t) => t.id)).toEqual([1]);
    expect(failers.map((t) => t.id)).toEqual([2]);
  });

  it('orders each group by score descending', () => {
    const { passers } = splitPool([tile(1, true, 0.2), tile(2, true, 0.9), tile(3, true, 0.5)]);
    expect(passers.map((t) => t.id)).toEqual([2, 3, 1]);
  });

  it('puts unscored tiles last and breaks ties by id for determinism', () => {
    const { failers } = splitPool([tile(3, false, null), tile(2, false, 0.4), tile(1, false, 0.4)]);
    expect(failers.map((t) => t.id)).toEqual([1, 2, 3]);
  });
});

describe('applyPolicy', () => {
  const { passers, failers } = splitPool([
    tile(1, true, 0.9), tile(2, false, 0.4), tile(3, false, 0.1),
  ]);

  it('hide drops every gate-failer', () => {
    expect(applyPolicy(passers, failers, cfg({ failedCamPolicy: 'hide' })).map((t) => t.id))
      .toEqual([1]);
  });

  it('showAtFloor keeps everyone, passers first', () => {
    expect(applyPolicy(passers, failers, cfg({ failedCamPolicy: 'showAtFloor' })).map((t) => t.id))
      .toEqual([1, 2, 3]);
  });

  it('showIfRoom defers to compose and keeps everyone at this stage', () => {
    expect(applyPolicy(passers, failers, cfg({ failedCamPolicy: 'showIfRoom' })).map((t) => t.id))
      .toEqual([1, 2, 3]);
  });
});

describe('capTiles', () => {
  it('0 means unlimited', () => {
    const tiles = [tile(1, true, 0.9), tile(2, false, 0.1)];
    expect(capTiles(tiles, 0)).toHaveLength(2);
  });

  it('truncates to the cap, keeping the front of the list', () => {
    const tiles = [tile(1, true, 0.9), tile(2, true, 0.5), tile(3, false, 0.1)];
    expect(capTiles(tiles, 2).map((t) => t.id)).toEqual([1, 2]);
  });

  it('is a no-op when the pool is already under the cap', () => {
    expect(capTiles([tile(1, true, 0.9)], 5)).toHaveLength(1);
  });
});
