import { screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
//import SimpleMap from './SimpleMap';

// Mock the CSS import
vi.mock('mapbox-gl/dist/mapbox-gl.css', () => ({}));

// Mock the hooks
vi.mock('./hooks/useMap', () => ({
  useMap: vi.fn(() => ({
    mapContainer: { current: null },
    map: null,
    mapLoaded: true,
    hasToken: true,
  })),
}));

vi.mock('./hooks/useSunsetPosition', () => ({
  useSunsetPosition: vi.fn(() => ({
    sunsetLocation: null,
    isLoading: false,
    error: null,
  })),
}));

describe('SimpleMap', () => {
  it('renders a map', () => {
    //Arrange
    //const mockUserLocation = { lat: 40.7128, lng: -74.006 };

    // Mock the environment variable
    vi.stubEnv('NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN', 'fake-token');

    //Assert
    expect(screen.queryByText('Loading map...')).toBeNull();
  });

  expect(
    screen.queryByText('Mapbox access token not found!')
  ).toBeNull();
});
