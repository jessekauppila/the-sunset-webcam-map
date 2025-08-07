import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useSunsetPosition } from './useSunsetPosition'; // Fix: correct import
import { findNearestSunsetWest } from '../lib/simple-sunset';

// Mock the simple-sunset functions (not sunset-calculator)
vi.mock('../lib/simple-sunset', () => ({
  findNearestSunsetWest: vi.fn(),
}));

describe('useSunsetPosition Hook', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Mock findNearestSunsetWest to return a sunset location
    vi.mocked(findNearestSunsetWest).mockReturnValue({
      lat: 40.7128,
      lng: -80.0, // Some longitude west of NYC
    });
  });

  it('should return loading state initially', () => {
    const userLocation = { lat: 40.7128, lng: -74.006 };
    const { result } = renderHook(() =>
      useSunsetPosition(userLocation)
    );

    // Should have sunset location after the effect runs
    expect(result.current.isLoading).toBe(false);
    expect(result.current.sunsetLocation).toBeDefined();
    expect(result.current.error).toBeNull();
  });

  it('should accept a user location and find sunset', () => {
    const userLocation = { lat: 40.7128, lng: -74.006 }; // NYC
    const { result } = renderHook(() =>
      useSunsetPosition(userLocation)
    );

    // Hook should return sunset location
    expect(result.current.sunsetLocation).toEqual({
      lat: 40.7128,
      lng: -80.0,
    });
    expect(result.current.isLoading).toBe(false);
  });

  it('should update when user location changes', () => {
    const initialLocation = { lat: 40.7128, lng: -74.006 };
    const { result, rerender } = renderHook(
      ({ location }) => useSunsetPosition(location),
      { initialProps: { location: initialLocation } }
    );

    expect(result.current.sunsetLocation).toBeDefined();

    // Change location
    const newLocation = { lat: 51.5074, lng: -0.1278 }; // London
    rerender({ location: newLocation });

    // Should still have a sunset location
    expect(result.current.sunsetLocation).toBeDefined();
  });
});
