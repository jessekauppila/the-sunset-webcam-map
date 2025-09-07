import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { Map } from 'mapbox-gl';

// More complete mock
const mockMarker = {
  setLngLat: vi.fn().mockReturnThis(),
  addTo: vi.fn().mockReturnThis(),
  remove: vi.fn(), // Add this if your hook uses it
};

vi.mock('mapbox-gl', () => ({
  default: {
    Marker: vi.fn(() => mockMarker),
  },
}));

import { useSetMarkers } from './useSetMarkers';

describe('useSetMarker', () => {
  it('creates a marker', () => {
    const map = {};
    const locations = [
      { lat: 40, lng: -74 },
      { lat: 41, lng: -75 },
      { lat: 42, lng: -76 },
    ];

    renderHook(() => useSetMarkers(map as Map, true, locations));

    expect(mockMarker.setLngLat).toHaveBeenCalled();
  });
});
