import { describe, it, expect } from 'vitest';
import {
  isLocationAtSunset,
  getWebcamsAtSunset,
} from './simple-sunset';

describe('Simple Sunset Calculator (lib)', () => {
  const testDate = new Date('2024-01-15T18:00:00Z');
  const nycLocation = { lat: 40.7128, lng: -74.006 };

  describe('isLocationAtSunset', () => {
    it('should return a boolean', () => {
      const result = isLocationAtSunset(nycLocation, testDate);
      expect(typeof result).toBe('boolean');
    });
  });

  describe('getWebcamsAtSunset', () => {
    it('should be a function', () => {
      expect(typeof getWebcamsAtSunset).toBe('function');
    });

    it('should return an array', () => {
      const mockWebcams = [
        { id: '1', name: 'NYC Cam', lat: 40.7128, lng: -74.006 },
      ];
      const result = getWebcamsAtSunset(mockWebcams, testDate);
      expect(Array.isArray(result)).toBe(true);
    });
  });
});
