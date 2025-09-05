import { describe, it, expect } from 'vitest';
import { splitTerminatorSunriseSunset } from './terminatorRing';

describe('Terminator ring', () => {
  it('creates a list of sunset and sunrise points', () => {
    //arrange
    const testDate = new Date('2025-01-01');
    const raHours = 11;
    const gmstHours = 22;

    //act
    const result = splitTerminatorSunriseSunset(
      testDate,
      raHours,
      gmstHours
    );

    //assert
    expect(result).toHaveProperty('sunrise.geometry.coordinates');
    expect(result).toHaveProperty('sunset.geometry.coordinates');
    expect(Array.isArray(result.sunrise.geometry.coordinates)).toBe(
      true
    ); // ✅ Correct    expect(typeof result.sunset.geometry.coordinates).toBe('array');
    expect(Array.isArray(result.sunset.geometry.coordinates)).toBe(
      true
    ); // ✅ Correct    expect(typeof result.sunset.geometry.coordinates).toBe('array');
    expect(
      result.sunrise.geometry.coordinates.length
    ).toBeGreaterThan(0);
    expect(result.sunset.geometry.coordinates.length).toBeGreaterThan(
      0
    );
  });
});
