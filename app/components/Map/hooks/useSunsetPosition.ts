import { useState, useEffect, useCallback } from 'react';
import { findNearestSunsetWest } from '../../../lib/simple-sunset';
import type { Location } from '../../../lib/types';

// useSunsetPosition.ts
export function useSunsetPosition(
  userLocation: Location,
  refreshInterval = 60000
) {
  console.log('🔄 useSunsetPosition called with:', userLocation);

  const [sunsetLocation, setSunsetLocation] =
    useState<Location | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const updateSunsetLocation = useCallback(() => {
    console.log('🔄 updateSunsetLocation called');
    try {
      console.log('🔍 About to call findNearestSunsetWest...');
      const nearestSunset = findNearestSunsetWest(userLocation);
      console.log(
        '✅ findNearestSunsetWest returned:',
        nearestSunset
      );
      setSunsetLocation(nearestSunset);
      setError(null);
    } catch (err) {
      console.error('❌ Error in findNearestSunsetWest:', err);
      setError('Failed to find sunset');
    } finally {
      console.log('🏁 Setting isLoading to false');
      setIsLoading(false);
    }
  }, [userLocation]);

  // Initial load
  useEffect(() => {
    console.log('🚀 useSunsetPosition useEffect running');
    updateSunsetLocation();
  }, [updateSunsetLocation]);

  //Auto-refresh interval
  useEffect(() => {
    const interval = setInterval(
      updateSunsetLocation,
      refreshInterval
    );
    return () => clearInterval(interval);
  }, [updateSunsetLocation, refreshInterval]);

  console.log('🔄 useSunsetPosition returning:', {
    sunsetLocation,
    isLoading,
    error,
  });

  return {
    sunsetLocation,
    isLoading,
    error,
    lastUpdated: new Date(),
  };
}
