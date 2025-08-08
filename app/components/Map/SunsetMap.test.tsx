// app/components/Map/SunsetMap.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import SimpleSunsetMap from './SunsetMap';
import { useSunsetPosition } from '../../hooks/useSunsetPosition';

// Mock mapbox-gl CSS
vi.mock('mapbox-gl/dist/mapbox-gl.css', () => ({}));

// Mock mapbox-gl entirely for tests
vi.mock('mapbox-gl', () => ({
  default: {
    accessToken: '',
    Map: vi.fn(() => ({
      on: vi.fn(),
      remove: vi.fn(),
      flyTo: vi.fn(),
    })),
    Marker: vi.fn(() => ({
      setLngLat: vi.fn().mockReturnThis(),
      setPopup: vi.fn().mockReturnThis(),
      addTo: vi.fn().mockReturnThis(),
    })),
    Popup: vi.fn(() => ({
      setHTML: vi.fn().mockReturnThis(),
    })),
  },
}));

vi.mock('../../hooks/useSunsetPosition');

describe('SimpleSunsetMap Component', () => {
  const mockUserLocation = { lat: 40.7128, lng: -74.006 };

  it('should show loading state while finding sunset', () => {
    vi.mocked(useSunsetPosition).mockReturnValue({
      sunsetLocation: null,
      isLoading: true,
      error: null,
      lastUpdated: new Date(),
    });

    render(<SimpleSunsetMap userLocation={mockUserLocation} />);
    expect(
      screen.getByText('Finding sunset location...')
    ).toBeInTheDocument();
  });

  it('should show error when sunset calculation fails', () => {
    vi.mocked(useSunsetPosition).mockReturnValue({
      sunsetLocation: null,
      isLoading: false,
      error: 'Failed to find sunset',
      lastUpdated: new Date(),
    });

    render(<SimpleSunsetMap userLocation={mockUserLocation} />);
    expect(
      screen.getByText('Error: Failed to find sunset')
    ).toBeInTheDocument();
  });

  it('should render map when sunset location is found', () => {
    const mockSunsetLocation = { lat: 40.7128, lng: -85.0 };

    vi.mocked(useSunsetPosition).mockReturnValue({
      sunsetLocation: mockSunsetLocation,
      isLoading: false,
      error: null,
      lastUpdated: new Date(),
    });

    render(<SimpleSunsetMap userLocation={mockUserLocation} />);

    // Test that component successfully renders (not loading/error)

    expect(
      screen.queryByText('Finding sunset location...')
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/Error:/)).not.toBeInTheDocument();
  });

  it('should call useSunsetPosition with correct user location', () => {
    const mockSunsetLocation = { lat: 40.7128, lng: -85.0 };

    vi.mocked(useSunsetPosition).mockReturnValue({
      sunsetLocation: mockSunsetLocation,
      isLoading: false,
      error: null,
      lastUpdated: new Date(),
    });

    render(<SimpleSunsetMap userLocation={mockUserLocation} />);

    // Test that hook was called with correct location
    expect(useSunsetPosition).toHaveBeenCalledWith(mockUserLocation);
  });

  // FUTURE: When you add real map
  // it('should center map on sunset location', () => {
  //   // Test map centering behavior
  // });
});
