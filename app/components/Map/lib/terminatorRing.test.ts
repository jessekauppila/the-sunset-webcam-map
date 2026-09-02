import { describe, it, expect } from 'vitest';
import { createTerminatorRing } from './terminatorRing';
import { subsolarPoint } from './subsolarLocation';
import {
  TERMINATOR_SUN_ALTITUDE_DEG,
  TERMINATOR_PRECISION_DEG,
  TERMINATOR_WIDEN_OFFSETS_DEG,
} from '../../../lib/masterConfig';

describe('Terminator ring', () => {
  it('creates a list of sunset and sunrise points', () => {
    //arrange
    const testDate = new Date('2025-01-01');
    const raHours = 11;
    const gmstHours = 22;

    //act
    const result = createTerminatorRing(testDate, raHours, gmstHours);

    //assert
    expect(result).toHaveProperty('sunrise.geometry.coordinates');
    expect(result).toHaveProperty('sunset.geometry.coordinates');
    expect(Array.isArray(result.sunrise.geometry.coordinates)).toBe(
      true
    );
    expect(Array.isArray(result.sunset.geometry.coordinates)).toBe(
      true
    );
    expect(
      result.sunrise.geometry.coordinates.length
    ).toBeGreaterThan(0);
    expect(result.sunset.geometry.coordinates.length).toBeGreaterThan(
      0
    );
  });
});

/**
 * The ring-offset SIGN CONVENTION, pinned by geometry.
 *
 * The whole adaptive-widening feature rests on "positive offset moves the ring
 * toward day": the escalation list in masterConfig tries +15.75 (golden hour)
 * before -15.75 (deep night). `terminatorPolygon` implements that as
 * `radius = 90 - (sunAltitude + offsetDeg)`, so a POSITIVE offset SHRINKS the
 * circle around the subsolar point.
 *
 * That reads backwards to anyone expecting "positive = away from the sun", and
 * flipping it would leave every other test in this suite green while every
 * escalation swept deep night first — doubling the Windy call cost to fetch
 * frames the detection gate floors anyway. So assert the geometry directly:
 * how far the ring sits from the subsolar point, not what the constant says.
 */
describe('Terminator ring offset sign convention', () => {
  const testDate = new Date('2026-09-02T00:00:00Z');
  const { lat: subLat, lng: subLng, raHours, gmstHours } =
    subsolarPoint(testDate);

  /** Great-circle angular separation, in degrees. */
  const angularDistanceDeg = (
    a: { lat: number; lng: number },
    b: { lat: number; lng: number }
  ) => {
    const toRad = (d: number) => (d * Math.PI) / 180;
    const cos =
      Math.sin(toRad(a.lat)) * Math.sin(toRad(b.lat)) +
      Math.cos(toRad(a.lat)) *
        Math.cos(toRad(b.lat)) *
        Math.cos(toRad(b.lng - a.lng));
    return (Math.acos(Math.min(1, Math.max(-1, cos))) * 180) / Math.PI;
  };

  /** Mean angular distance from the subsolar point to the ring's vertices. */
  const ringDistanceFromSun = (offsetDeg: number) => {
    const { allTerminatorCoords } = createTerminatorRing(
      testDate,
      raHours,
      gmstHours,
      TERMINATOR_PRECISION_DEG,
      TERMINATOR_SUN_ALTITUDE_DEG,
      offsetDeg
    );
    const sun = { lat: subLat, lng: subLng };
    const distances = allTerminatorCoords.map((c) =>
      angularDistanceDeg(sun, c)
    );
    return distances.reduce((a, b) => a + b, 0) / distances.length;
  };

  it('puts a positive-offset ring closer to the subsolar point than the base ring', () => {
    expect(ringDistanceFromSun(15.75)).toBeLessThan(
      ringDistanceFromSun(0)
    );
  });

  it('puts a negative-offset ring further from the subsolar point than the base ring', () => {
    expect(ringDistanceFromSun(-15.75)).toBeGreaterThan(
      ringDistanceFromSun(0)
    );
  });

  it('moves the ring one degree toward the sun per degree of positive offset', () => {
    const base = ringDistanceFromSun(0);
    expect(ringDistanceFromSun(15.75)).toBeCloseTo(base - 15.75, 6);
    expect(ringDistanceFromSun(-15.75)).toBeCloseTo(base + 15.75, 6);
  });

  it('sweeps the escalation offsets day side first, measured as geometry', () => {
    // The shipped escalation list, checked by where its rings actually land
    // rather than by the sign of its numbers.
    const distances = TERMINATOR_WIDEN_OFFSETS_DEG.map(ringDistanceFromSun);
    const base = ringDistanceFromSun(0);
    expect(distances[0]).toBeLessThan(base); // day side tried first
    expect(distances[1]).toBeGreaterThan(base); // night side is the fallback
  });
});
