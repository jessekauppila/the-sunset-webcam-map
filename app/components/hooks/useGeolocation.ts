import { useEffect, useState } from 'react';
import type { Location } from '../../lib/types';

interface GeolocationState {
  location: Location | null;
  loading: boolean;
  error: string | null;
  permissionDenied: boolean;
}

/**
 * Custom hook for getting user's geolocation
 * Handles permission requests, errors, and fallbacks
 */
export function useGeolocation(): GeolocationState {
  const [state, setState] = useState<GeolocationState>({
    location: null,
    loading: true,
    error: null,
    permissionDenied: false,
  });

  useEffect(() => {
    // Check if geolocation is supported
    if (!navigator.geolocation) {
      setState({
        location: null,
        loading: false,
        error: 'Geolocation is not supported by this browser',
        permissionDenied: false,
      });
      return;
    }

    // Default fallback location (NYC) if geolocation fails
    const fallbackLocation: Location = { lat: 40.7128, lng: -74.006 };

    const options: PositionOptions = {
      enableHighAccuracy: true,
      timeout: 10000, // 10 seconds timeout
      maximumAge: 300000, // 5 minutes cache
    };

    const handleSuccess = (position: GeolocationPosition) => {
      const { latitude, longitude } = position.coords;

      setState({
        location: { lat: latitude, lng: longitude },
        loading: false,
        error: null,
        permissionDenied: false,
      });
    };

    const handleError = (error: GeolocationPositionError) => {
      let errorMessage = 'Unable to get your location';
      let permissionDenied = false;

      switch (error.code) {
        case error.PERMISSION_DENIED:
          errorMessage = 'Location access denied by user';
          permissionDenied = true;
          break;
        case error.POSITION_UNAVAILABLE:
          errorMessage = 'Location information is unavailable';
          break;
        case error.TIMEOUT:
          errorMessage = 'Location request timed out';
          break;
        default:
          errorMessage =
            'An unknown error occurred while retrieving location';
          break;
      }

      setState({
        location: fallbackLocation, // Use fallback location
        loading: false,
        error: errorMessage,
        permissionDenied,
      });
    };

    // Request location
    navigator.geolocation.getCurrentPosition(
      handleSuccess,
      handleError,
      options
    );
  }, []);

  return state;
}
