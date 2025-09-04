import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

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

import { useSetMarker } from './useSetMarker';

describe('useSetMarker', () => {
  it('creates a marker', () => {
    const map = {};
    const location = { lat: 40, lng: -74 };

    renderHook(() => useSetMarker(map as any, true, location));

    expect(mockMarker.setLngLat).toHaveBeenCalled();
  });
});
``;
