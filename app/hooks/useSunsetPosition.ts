import { useState, useEffect } from 'react';
import { findNearestSunsetWest } from '../lib/simple-sunset';
import type { Location } from '../lib/types';

// useSunsetPosition.ts
export function useSunsetPosition(userLocation: Location) {
  const [sunsetLocation, setSunsetLocation] =
    useState<Location | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null); // Add this line

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    try {
      const nearestSunset = findNearestSunsetWest(userLocation);
      setSunsetLocation(nearestSunset);
      setError(null);
    } catch (err) {
      setError('Failed to find sunset');
    } finally {
      setIsLoading(false);
    }
  }, [userLocation]);

  return { sunsetLocation, isLoading, error };
}
