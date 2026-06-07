import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import type { Map } from 'mapbox-gl';

const mockMarker = {
  setLngLat: vi.fn().mockReturnThis(),
  addTo: vi.fn().mockReturnThis(),
  remove: vi.fn(),
};

vi.mock('mapbox-gl', () => ({
  default: {
    Marker: vi.fn(() => mockMarker),
  },
}));

import { useSetMarker } from './useSetMarker';

describe('useSetMarker', () => {
  it('creates a marker at the location once the map is ready', async () => {
    // The hook guards on a real map instance (non-empty, style loaded, has a
    // container) and creates the marker inside an async `import('mapbox-gl')`,
    // so the mock map must satisfy those preconditions and the assertion must
    // wait for the dynamic import to resolve.
    const map = {
      isStyleLoaded: () => true,
      getContainer: () => document.createElement('div'),
    };
    const location = { lat: 40, lng: -74 };

    renderHook(() => useSetMarker(map as unknown as Map, true, location));

    await waitFor(() =>
      expect(mockMarker.setLngLat).toHaveBeenCalledWith([-74, 40])
    );
    expect(mockMarker.addTo).toHaveBeenCalled();
  });

  it('skips marker creation when the map is not ready', async () => {
    const map = {
      isStyleLoaded: () => true,
      getContainer: () => document.createElement('div'),
    };
    const location = { lat: 40, lng: -74 };
    mockMarker.setLngLat.mockClear();

    renderHook(() => useSetMarker(map as unknown as Map, false, location));

    // Give any (incorrectly scheduled) async work a chance to run.
    await Promise.resolve();
    expect(mockMarker.setLngLat).not.toHaveBeenCalled();
  });
});
