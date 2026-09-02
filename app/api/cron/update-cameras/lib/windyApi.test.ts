import { describe, it, expect } from 'vitest';
import { boundingBox } from './windyApi';

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
