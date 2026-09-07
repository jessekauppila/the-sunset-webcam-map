import { describe, it, expect } from 'vitest';
import { ringQueryPoints, sweepOverlayFeatures, sweepRings } from './sweepOverlay';
import {
  SEARCH_RADIUS_DEG,
  TERMINATOR_POOL_COVERAGE_DEG,
  TERMINATOR_SUN_ALTITUDE_DEG,
  TERMINATOR_WIDEN_OFFSETS_DEG,
} from '@/app/lib/masterConfig';

const time = new Date('2026-09-07T18:30:00Z');
const base = TERMINATOR_POOL_COVERAGE_DEG;
const [day, night] = TERMINATOR_WIDEN_OFFSETS_DEG;

describe('sweepRings', () => {
  it('lists the base ring first and every escalation ring in config order', () => {
    const rings = sweepRings(null);
    expect(rings.map((r) => r.offsetDeg)).toEqual([0, ...TERMINATOR_WIDEN_OFFSETS_DEG]);
    expect(rings[0].altitudeDeg).toBe(TERMINATOR_SUN_ALTITUDE_DEG);
    expect(rings[1].altitudeDeg).toBe(TERMINATOR_SUN_ALTITUDE_DEG + day);
  });

  it('marks only the base ring swept when the cron has recorded no zone', () => {
    expect(sweepRings(null).map((r) => r.swept)).toEqual([true, false, false]);
  });

  it('marks only the base ring swept when the zone is exactly the base coverage', () => {
    expect(sweepRings({ minDeg: base.min, maxDeg: base.max }).map((r) => r.swept))
      .toEqual([true, false, false]);
  });

  it('reads a zone wider on the day side as the day ring having swept', () => {
    const zone = { minDeg: base.min, maxDeg: TERMINATOR_SUN_ALTITUDE_DEG + day + SEARCH_RADIUS_DEG };
    const [, dayRing, nightRing] = sweepRings(zone);
    expect(dayRing.swept).toBe(true);
    expect(nightRing.swept).toBe(false);
  });

  it('reads a zone wider on the night side as the night ring having swept', () => {
    const zone = { minDeg: TERMINATOR_SUN_ALTITUDE_DEG + night - SEARCH_RADIUS_DEG, maxDeg: base.max };
    const [, dayRing, nightRing] = sweepRings(zone);
    expect(dayRing.swept).toBe(false);
    expect(nightRing.swept).toBe(true);
  });
});

describe('ringQueryPoints', () => {
  it('yields the same points the cron queries: no duplicates at the seam', () => {
    const points = ringQueryPoints(time, 0);
    const keys = new Set(points.map((p) => `${p.lat.toFixed(6)},${p.lng.toFixed(6)}`));
    expect(keys.size).toBe(points.length);
    expect(points.length).toBeGreaterThan(20);
  });

  it('moves the whole ring when the offset changes', () => {
    const a = ringQueryPoints(time, 0);
    const b = ringQueryPoints(time, day);
    expect(b).not.toEqual(a);
  });
});

describe('sweepOverlayFeatures', () => {
  it('draws one line per ring and carries the ring props on it', () => {
    const rings = sweepRings(null);
    const out = sweepOverlayFeatures(time, rings, false);
    expect(out.lines.features).toHaveLength(3);
    expect(out.lines.features[1].properties).toEqual({
      offsetDeg: day, altitudeDeg: TERMINATOR_SUN_ALTITUDE_DEG + day, swept: false,
    });
    expect(out.boxes.features).toHaveLength(0);
  });

  it('draws one box per query point when boxes are on', () => {
    const [baseRing] = sweepRings(null);
    const out = sweepOverlayFeatures(time, [baseRing], true);
    expect(out.boxes.features).toHaveLength(ringQueryPoints(time, 0).length);
  });

  it('draws each box as the clamped lat/lng rectangle the cron sends', () => {
    const [baseRing] = sweepRings(null);
    const out = sweepOverlayFeatures(time, [baseRing], true);
    for (const box of out.boxes.features) {
      const ring = box.geometry.coordinates[0];
      expect(ring).toHaveLength(5);
      expect(ring[0]).toEqual(ring[4]);
      const lons = ring.map((c) => c[0]);
      const lats = ring.map((c) => c[1]);
      expect(Math.max(...lons) - Math.min(...lons)).toBeLessThanOrEqual(2 * SEARCH_RADIUS_DEG + 1e-9);
      expect(Math.max(...lats) - Math.min(...lats)).toBeLessThanOrEqual(2 * SEARCH_RADIUS_DEG + 1e-9);
      expect(Math.max(...lats)).toBeLessThanOrEqual(90);
      expect(Math.min(...lons)).toBeGreaterThanOrEqual(-180);
    }
  });

  it('draws nothing when no rings are asked for', () => {
    const out = sweepOverlayFeatures(time, [], true);
    expect(out.lines.features).toHaveLength(0);
    expect(out.boxes.features).toHaveLength(0);
  });
});
