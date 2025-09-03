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
});
