import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useFlyTo } from './useFlyTo';
import type { Location } from '@/app/lib/types';

// Mock mapboxgl
const mockMap = {
  flyTo: vi.fn(),
};
describe('useFlyTo Hook', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should fly to sunset location when all requirements are met', () => {
    // 🎯 ARRANGE
    const map = mockMap as any;
    const mapLoaded = true;
    const sunsetLocation: Location = { lat: 40, lng: -80 };

    // 🎯 ACT
    renderHook(() => useFlyTo(map, mapLoaded, sunsetLocation));

    // 🎯 ASSERT - Verify the behavior
    expect(mockMap.flyTo).toHaveBeenCalledWith({
      center: [-80.0, 40],
      zoom: 2,
      duration: 6000,
    });
  });

  it('should NOT fly when map is not loaded', () => {
    const map = mockMap as any;
    const mapLoaded = false;
    const sunsetLocation: Location = { lat: 40.7128, lng: -80.0 };

    renderHook(() => useFlyTo(map, mapLoaded, sunsetLocation));

    // Test the BEHAVIOR: should not call flyTo
    expect(mockMap.flyTo).not.toHaveBeenCalled();
  });

  it('should NOT fly when sunset location is null', () => {
    const map = mockMap as any;
    const mapLoaded = true;
    const sunsetLocation = null;

    renderHook(() => useFlyTo(map, mapLoaded, sunsetLocation));

    // Test the BEHAVIOR: should not call flyTo
    expect(mockMap.flyTo).not.toHaveBeenCalled();
  });

  it('should fly to new location when sunset location changes', () => {
    const map = mockMap as any;
    const mapLoaded = true;
    const initialSunsetLocation: Location = {
      lat: 40.7128,
      lng: -80.0,
    };
    const newSunsetLocation: Location = {
      lat: 51.5074,
      lng: -0.1278,
    };

    const { rerender } = renderHook(
      ({ sunsetLocation }) =>
        useFlyTo(map, mapLoaded, sunsetLocation),
      { initialProps: { sunsetLocation: initialSunsetLocation } }
    );

    // Should fly to initial location
    expect(mockMap.flyTo).toHaveBeenCalledWith({
      center: [-80.0, 40.7128],
      zoom: 2,
      duration: 6000,
    });

    // Change sunset location
    rerender({ sunsetLocation: newSunsetLocation });

    // Should fly to new location
    expect(mockMap.flyTo).toHaveBeenCalledWith({
      center: [-0.1278, 51.5074],
      zoom: 2,
      duration: 6000,
    });
  });
});
