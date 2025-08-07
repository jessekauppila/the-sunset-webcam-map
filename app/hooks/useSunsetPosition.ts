import { useState, useEffect } from 'react';
import { findNearestSunsetWest } from '../lib/simple-sunset';
import type { Location } from '../lib/types';

export function useSunsetPosition(userLocation: Location) {
  const [sunsetLocation, setSunsetLocation] =
    useState<Location | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    try {
      setIsLoading(true);
      setError(null);

      const nearestSunset = findNearestSunsetWest(userLocation);
      setSunsetLocation(nearestSunset);
    } catch (err) {
      setError('Failed to find nearest sunset');
    } finally {
      setIsLoading(false);
    }
  }, [userLocation.lat, userLocation.lng]);

  return { sunsetLocation, isLoading, error };
}
