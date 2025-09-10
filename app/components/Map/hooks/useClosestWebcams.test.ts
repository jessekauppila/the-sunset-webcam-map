import { useClosestWebcams } from './useClosestWebcams';
import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { WindyWebcam, Location } from '@/app/lib/types';

// Test data objects based on the provided webcam data
const mockWebcam1: WindyWebcam = {
  webcamId: 1213011365,
  title: 'Oulu: Tie 816 Oulunsalo, lauttaranta - Hailuoto',
  viewCount: 91134,
  status: 'active',
  images: {
    current: {
      preview: 'https://example.com/preview1.jpg',
      thumbnail: 'https://example.com/thumb1.jpg',
      icon: 'https://example.com/icon1.jpg',
    },
  },
  location: {
    city: 'Oulu',
    region: 'Mainland Finland',
    longitude: 25.5, // Approximate longitude for Oulu
    latitude: 65.0, // Approximate latitude for Oulu
    country: 'Finland',
    continent: 'Europe',
  },
  categories: [
    { id: 'traffic', name: 'Traffic' },
    { id: 'road', name: 'Road' },
  ],
  lastUpdatedOn: '2025-09-10T16:33:41.000Z',
};

const mockWebcam2: WindyWebcam = {
  webcamId: 1196843016,
  title: 'Rovaniemi: Lordin Aukio',
  viewCount: 2381804,
  status: 'active',
  images: {
    current: {
      preview: 'https://example.com/preview2.jpg',
      thumbnail: 'https://example.com/thumb2.jpg',
      icon: 'https://example.com/icon2.jpg',
    },
  },
  location: {
    city: 'Rovaniemi',
    region: 'Mainland Finland',
    longitude: 25.7, // Approximate longitude for Rovaniemi
    latitude: 66.5, // Approximate latitude for Rovaniemi
    country: 'Finland',
    continent: 'Europe',
  },
  categories: [
    { id: 'city', name: 'City' },
    { id: 'traffic', name: 'Traffic' },
  ],
  lastUpdatedOn: '2025-09-10T17:08:56.000Z',
};

const mockWebcam3: WindyWebcam = {
  webcamId: 1210832099,
  title: 'Enontekio: Tie 956 Enontekiö, Peltovuoma - Peltovuomaan',
  viewCount: 210420,
  status: 'active',
  images: {
    current: {
      preview: 'https://example.com/preview3.jpg',
      thumbnail: 'https://example.com/thumb3.jpg',
      icon: 'https://example.com/icon3.jpg',
    },
  },
  location: {
    city: 'Enontekio',
    region: 'Mainland Finland',
    longitude: 23.6, // Approximate longitude for Enontekio
    latitude: 68.4, // Approximate latitude for Enontekio
    country: 'Finland',
    continent: 'Europe',
  },
  categories: [
    { id: 'traffic', name: 'Traffic' },
    { id: 'road', name: 'Road' },
  ],
  lastUpdatedOn: '2025-09-10T16:28:21.000Z',
};

const mockWebcam4: WindyWebcam = {
  webcamId: 1213012228,
  title: 'Kuopio: Tie 536 - Vehmersalmi - Vehmersalmelle',
  viewCount: 68089,
  status: 'active',
  images: {
    current: {
      preview: 'https://example.com/preview4.jpg',
      thumbnail: 'https://example.com/thumb4.jpg',
      icon: 'https://example.com/icon4.jpg',
    },
  },
  location: {
    city: 'Kuopio',
    region: 'Mainland Finland',
    longitude: 27.7, // Approximate longitude for Kuopio
    latitude: 62.9, // Approximate latitude for Kuopio
    country: 'Finland',
    continent: 'Europe',
  },
  categories: [
    { id: 'traffic', name: 'Traffic' },
    { id: 'road', name: 'Road' },
  ],
  lastUpdatedOn: '2025-09-10T16:33:03.000Z',
};

const mockUserLocation: Location = {
  lat: 40.71, // New York area
  lng: 74.01,
};

const mockWebcams: WindyWebcam[] = [
  mockWebcam1,
  mockWebcam2,
  mockWebcam3,
  mockWebcam4,
];

describe('useClosestWebcams', () => {
  it('finds closest webCam', () => {
    const { result } = renderHook(() =>
      useClosestWebcams(mockUserLocation, mockWebcams)
    );

    expect(result.current.closestWebcam).toBeDefined();
    expect(result.current.closestWebcam?.webcamId).toBe(
      mockWebcam4.webcamId
    );
    expect(result.current.closestWebcam?.title).toBe(
      'Kuopio: Tie 536 - Vehmersalmi - Vehmersalmelle'
    );
  });

  it('creates ordered array of webCams', () => {
    const { result } = renderHook(() =>
      useClosestWebcams(mockUserLocation, mockWebcams)
    );

    expect(result.current.webcamsWithDistance).toHaveLength(4);
    expect(
      result.current.webcamsWithDistance[0].distanceFromUser
    ).toBeLessThan(
      result.current.webcamsWithDistance[1].distanceFromUser
    );
    expect(
      result.current.webcamsWithDistance[1].distanceFromUser
    ).toBeLessThan(
      result.current.webcamsWithDistance[2].distanceFromUser
    );
    expect(
      result.current.webcamsWithDistance[2].distanceFromUser
    ).toBeLessThan(
      result.current.webcamsWithDistance[3].distanceFromUser
    );
  });

  it('finds closest location', () => {
    const { result } = renderHook(() =>
      useClosestWebcams(mockUserLocation, mockWebcams)
    );

    expect(result.current.closestLocation).toBeDefined();
    expect(result.current.closestLocation?.lat).toBe(
      mockWebcam4.location.latitude
    );
    expect(result.current.closestLocation?.lng).toBe(
      mockWebcam4.location.longitude
    );
  });
});
