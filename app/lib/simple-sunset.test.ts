import { describe, it, expect } from 'vitest';
import {
  getSimpleSunsetLine,
  isLocationAtSunset,
  getSunPositionAtLocation,
} from './simple-sunset';

describe('Simple Sunset Calculator (lib)', () => {
  const testDate = new Date('2024-01-15T18:00:00Z');
  const nycLocation = { lat: 40.7128, lng: -74.006 };

  describe('getSimpleSunsetLine', () => {
    it('should return an object with sunsetLine and timestamp', () => {
      const result = getSimpleSunsetLine(testDate);

      expect(result).toHaveProperty('sunsetLine');
      expect(result).toHaveProperty('timestamp');
      expect(result.timestamp).toEqual(testDate);
    });

    it('should return an array of coordinates', () => {
      const result = getSimpleSunsetLine(testDate);

      expect(Array.isArray(result.sunsetLine)).toBe(true);
    });

    it('should return coordinates with valid lat/lng ranges', () => {
      const result = getSimpleSunsetLine(testDate);

      result.sunsetLine.forEach((point) => {
        expect(point.lat).toBeGreaterThanOrEqual(-90);
        expect(point.lat).toBeLessThanOrEqual(90);
        expect(point.lng).toBeGreaterThanOrEqual(-180);
        expect(point.lng).toBeLessThanOrEqual(180);
      });
    });
  });

  describe('isLocationAtSunset', () => {
    it('should return a boolean', () => {
      const result = isLocationAtSunset(nycLocation, testDate);
      expect(typeof result).toBe('boolean');
    });
  });

  describe('getSunPositionAtLocation', () => {
    it('should return sun position data', () => {
      const result = getSunPositionAtLocation(nycLocation, testDate);

      expect(result).toHaveProperty('azimuth');
      expect(result).toHaveProperty('altitude');
      expect(result).toHaveProperty('isDay');
      expect(result).toHaveProperty('isSunset');
    });

    it('should return numbers for azimuth and altitude', () => {
      const result = getSunPositionAtLocation(nycLocation, testDate);

      expect(typeof result.azimuth).toBe('number');
      expect(typeof result.altitude).toBe('number');
    });
  });
});
