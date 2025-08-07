import { describe, it, expect } from 'vitest';
import {
  isLocationAtSunset,
  getWebcamsAtSunset,
  findNearestSunsetWest,
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

describe('findNearestSunsetWest', () => {
  it('should find a sunset location west of user', () => {
    const userInNYC = { lat: 40.7128, lng: -74.006 };
    const testDate = new Date('2024-01-15T20:00:00Z'); // 8 PM UTC

    const nearestSunset = findNearestSunsetWest(userInNYC, testDate);

    expect(nearestSunset).toBeDefined();
    expect(nearestSunset).toHaveProperty('lat');
    expect(nearestSunset).toHaveProperty('lng');

    if (nearestSunset) {
      // Should be same latitude as user
      expect(nearestSunset.lat).toBe(userInNYC.lat);

      // Should actually be experiencing sunset
      expect(isLocationAtSunset(nearestSunset, testDate)).toBe(true);

      console.log(`User at (${userInNYC.lat}, ${userInNYC.lng})`);
      console.log(
        `Nearest sunset at (${nearestSunset.lat}, ${nearestSunset.lng})`
      );

      // Calculate the westward distance (handling globe wrap)
      let westwardDistance = userInNYC.lng - nearestSunset.lng;
      if (westwardDistance < 0) westwardDistance += 360;

      console.log(`Westward distance: ${westwardDistance} degrees`);
      expect(westwardDistance).toBeGreaterThan(0);
    }
  });

  it('should work for different user locations', () => {
    const userInLondon = { lat: 51.5074, lng: -0.1278 };
    const testDate = new Date('2024-01-15T18:00:00Z');

    const nearestSunset = findNearestSunsetWest(
      userInLondon,
      testDate
    );

    expect(nearestSunset).toBeDefined();
    if (nearestSunset) {
      expect(nearestSunset.lat).toBe(userInLondon.lat);
      expect(isLocationAtSunset(nearestSunset, testDate)).toBe(true);
    }
  });

  it('should handle edge cases gracefully', () => {
    const userAtPole = { lat: 89, lng: 0 }; // Near north pole
    const testDate = new Date('2024-06-21T12:00:00Z'); // Summer solstice

    const nearestSunset = findNearestSunsetWest(userAtPole, testDate);

    // Should either find a sunset or return null gracefully
    expect(
      nearestSunset === null || typeof nearestSunset === 'object'
    ).toBe(true);
  });
});
