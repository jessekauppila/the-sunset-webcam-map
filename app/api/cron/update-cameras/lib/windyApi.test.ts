import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { boundingBox, fetchCoordsCounted } from './windyApi';

describe('boundingBox', () => {
  it('returns an unclamped box away from the edges', () => {
    expect(boundingBox({ lat: 45, lng: 10 }, 11)).toEqual({
      northLat: 56, southLat: 34, eastLon: 21, westLon: -1,
    });
  });

  it('clamps latitude at the north pole', () => {
    const box = boundingBox({ lat: 85, lng: 0 }, 11);
    expect(box.northLat).toBe(90);
    expect(box.southLat).toBe(74);
  });

  it('clamps latitude at the south pole', () => {
    const box = boundingBox({ lat: -85, lng: 0 }, 11);
    expect(box.southLat).toBe(-90);
    expect(box.northLat).toBe(-74);
  });

  it('clamps longitude at the antimeridian', () => {
    expect(boundingBox({ lat: 0, lng: 175 }, 11).eastLon).toBe(180);
    expect(boundingBox({ lat: 0, lng: -175 }, 11).westLon).toBe(-180);
  });

  it('never produces a span wider than the Windy zoom-4 cap', () => {
    for (const lat of [-90, -85, -45, 0, 45, 85, 90]) {
      const box = boundingBox({ lat, lng: 0 }, 11);
      expect(box.northLat - box.southLat).toBeLessThanOrEqual(22.5);
    }
  });
});

describe('fetchCoordsCounted', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      // Boxes centred on lng 99 answer with one webcam; everything else 400s.
      if (url.includes('westLon=88')) {
        return { ok: true, json: async () => [{ webcamId: 1, location: {} }] };
      }
      return { ok: false, status: 400, statusText: 'Bad Request' };
    }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('reports how many boxes were tried and how many came back empty', async () => {
    const res = await fetchCoordsCounted(
      [{ lat: 0, lng: 99 }, { lat: 0, lng: 5 }, { lat: 0, lng: 20 }],
      5,
      0
    );
    expect(res.attempted).toBe(3);
    expect(res.empty).toBe(2);
    expect(res.webcams).toHaveLength(1);
  });

  it('is a no-op on an empty coordinate list', async () => {
    const res = await fetchCoordsCounted([], 5, 0);
    expect(res).toEqual({ webcams: [], attempted: 0, empty: 0 });
  });
});
