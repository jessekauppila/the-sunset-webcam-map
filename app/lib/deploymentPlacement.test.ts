import { describe, it, expect } from 'vitest';
import { haversineMeters, suggestMode, NEW_LOCATION_THRESHOLD_M } from './deploymentPlacement';

describe('haversineMeters', () => {
  it('is 0 for the same point', () => {
    expect(haversineMeters({ lat: 47.6, lng: -122.3 }, { lat: 47.6, lng: -122.3 })).toBeCloseTo(0, 5);
  });
  it('~111.2 km per degree of latitude', () => {
    const d = haversineMeters({ lat: 47, lng: -122 }, { lat: 48, lng: -122 });
    expect(d).toBeGreaterThan(111_000);
    expect(d).toBeLessThan(111_400);
  });
  it('small local move is tens of meters', () => {
    // ~0.0003 deg lat ≈ 33 m
    const d = haversineMeters({ lat: 47.6000, lng: -122.3 }, { lat: 47.6003, lng: -122.3 });
    expect(d).toBeGreaterThan(25);
    expect(d).toBeLessThan(40);
  });
});

describe('suggestMode', () => {
  it('suggests reaim within the threshold', () => {
    expect(suggestMode(NEW_LOCATION_THRESHOLD_M - 1)).toBe('reaim');
  });
  it('suggests new beyond the threshold', () => {
    expect(suggestMode(NEW_LOCATION_THRESHOLD_M + 1)).toBe('new');
  });
});
