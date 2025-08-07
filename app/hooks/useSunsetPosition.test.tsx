import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useSunsetPosition } from './useSunsetPosition';

// Mock the sunset calculator functions
vi.mock('../lib/sunset-calculator', () => ({
  getSunsetTerminator: vi.fn(),
  getSunPosition: vi.fn(),
}));

describe('useSunsetPosition Hook', () => {
  it('should return loading state initially', () => {
    const { result } = renderHook(() => useSunsetPosition());

    expect(result.current.isLoading).toBe(true);
    expect(result.current.sunsetData).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it('should accept a user location', () => {
    const userLocation = { lat: 40.7128, lng: -74.006 }; // NYC
    const { result } = renderHook(() =>
      useSunsetPosition(userLocation)
    );

    // Hook should accept location without errors
    expect(result.current).toBeDefined();
  });
});
