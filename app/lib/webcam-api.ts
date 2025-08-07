import type { Location, Webcam, WebcamAPIResponse } from './types';
import {
  isLocationInSunset,
  calculateDistance,
} from './sunset-calculator';

/**
 * Mock webcam data for development and testing
 * In production, this would be replaced with real API calls
 */
export function getMockWebcams(): Webcam[] {
  return [
    {
      id: 'nyc-harbor',
      name: 'New York Harbor',
      lat: 40.7128,
      lng: -74.006,
      url: 'https://example.com/streams/nyc-harbor',
      thumbnailUrl: 'https://example.com/thumbs/nyc-harbor.jpg',
      isActive: true,
      source: 'custom',
      lastUpdated: new Date(),
    },
    {
      id: 'golden-gate',
      name: 'Golden Gate Bridge',
      lat: 37.8199,
      lng: -122.4783,
      url: 'https://example.com/streams/golden-gate',
      thumbnailUrl: 'https://example.com/thumbs/golden-gate.jpg',
      isActive: true,
      source: 'windy',
      lastUpdated: new Date(),
    },
    {
      id: 'miami-beach',
      name: 'Miami Beach',
      lat: 25.7617,
      lng: -80.1918,
      url: 'https://example.com/streams/miami-beach',
      thumbnailUrl: 'https://example.com/thumbs/miami-beach.jpg',
      isActive: true,
      source: 'openweather',
      lastUpdated: new Date(),
    },
    {
      id: 'santa-monica',
      name: 'Santa Monica Pier',
      lat: 34.0195,
      lng: -118.4912,
      url: 'https://example.com/streams/santa-monica',
      thumbnailUrl: 'https://example.com/thumbs/santa-monica.jpg',
      isActive: true,
      source: 'custom',
      lastUpdated: new Date(),
    },
    {
      id: 'key-west',
      name: 'Key West Sunset',
      lat: 24.5551,
      lng: -81.78,
      url: 'https://example.com/streams/key-west',
      thumbnailUrl: 'https://example.com/thumbs/key-west.jpg',
      isActive: true,
      source: 'windy',
      lastUpdated: new Date(),
    },
    {
      id: 'hawaii-sunset',
      name: 'Waikiki Beach Sunset',
      lat: 21.2793,
      lng: -157.8311,
      url: 'https://example.com/streams/hawaii-sunset',
      thumbnailUrl: 'https://example.com/thumbs/hawaii-sunset.jpg',
      isActive: true,
      source: 'custom',
      lastUpdated: new Date(),
    },
  ];
}

/**
 * Check if a webcam is currently active and functioning
 */
export function isWebcamActive(webcam: Webcam): boolean {
  return webcam.isActive;
}

/**
 * Filter webcams by distance from a given location
 */
export function filterWebcamsByDistance(
  webcams: Webcam[],
  location: Location,
  maxDistance: number
): Webcam[] {
  return webcams.filter((webcam) => {
    const distance = calculateDistance(location, {
      lat: webcam.lat,
      lng: webcam.lng,
    });
    return distance <= maxDistance;
  });
}

/**
 * Fetch webcams that are currently experiencing sunset
 * For now, uses mock data. In production, this would call real APIs
 */
export async function fetchWebcamsNearSunset(
  userLocation: Location,
  radiusKm: number = 500
): Promise<WebcamAPIResponse> {
  // Simulate API delay
  await new Promise((resolve) => setTimeout(resolve, 100));

  const allWebcams = getMockWebcams();

  // Filter for active webcams
  const activeWebcams = allWebcams.filter(isWebcamActive);

  // Filter for webcams currently in sunset
  const sunsetWebcams = activeWebcams.filter((webcam) =>
    isLocationInSunset({ lat: webcam.lat, lng: webcam.lng })
  );

  // Optionally filter by distance from user
  const nearbyWebcams = filterWebcamsByDistance(
    sunsetWebcams,
    userLocation,
    radiusKm
  );

  return {
    webcams: nearbyWebcams,
    total: nearbyWebcams.length,
    source: 'custom',
  };
}

/**
 * Fetch all available webcams regardless of sunset status
 * Useful for displaying all available cameras
 */
export async function fetchAllWebcams(): Promise<WebcamAPIResponse> {
  await new Promise((resolve) => setTimeout(resolve, 50));

  const allWebcams = getMockWebcams();
  const activeWebcams = allWebcams.filter(isWebcamActive);

  return {
    webcams: activeWebcams,
    total: activeWebcams.length,
    source: 'custom',
  };
}

/**
 * Fetch a specific webcam by ID
 */
export async function fetchWebcamById(
  id: string
): Promise<Webcam | null> {
  await new Promise((resolve) => setTimeout(resolve, 50));

  const allWebcams = getMockWebcams();
  return allWebcams.find((webcam) => webcam.id === id) || null;
}
