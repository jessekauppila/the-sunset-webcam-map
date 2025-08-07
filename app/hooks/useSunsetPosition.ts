import { useState, useEffect, useCallback } from 'react';
import { findNearestSunsetWest } from '../lib/simple-sunset';
import type { Location } from '../lib/types';

// useSunsetPosition.ts
export function useSunsetPosition(
  userLocation: Location,
  refreshInterval = 60000
) {
  // 1 minute default
  const [sunsetLocation, setSunsetLocation] =
    useState<Location | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const updateSunsetLocation = useCallback(() => {
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

  // Initial load
  useEffect(() => {
    updateSunsetLocation();
  }, [updateSunsetLocation]);

  // Auto-refresh interval
  useEffect(() => {
    const interval = setInterval(
      updateSunsetLocation,
      refreshInterval
    );
    return () => clearInterval(interval);
  }, [updateSunsetLocation, refreshInterval]);

  return {
    sunsetLocation,
    isLoading,
    error,
    lastUpdated: new Date(),
  };
}
