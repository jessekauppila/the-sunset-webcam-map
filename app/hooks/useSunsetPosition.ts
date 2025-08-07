import { useState, useEffect, useCallback } from 'react';
import {
  getSimpleSunsetLine,
  getSunPositionAtLocation,
} from '../lib/simple-sunset';
import type { Location } from '../lib/types';

interface SimpleSunsetData {
  sunsetLine: Location[];
  timestamp: Date;
}

interface UseSunsetPositionReturn {
  sunsetData: SimpleSunsetData | null;
  isLoading: boolean;
  error: string | null;
  refresh: () => void;
}

/**
 * Custom hook to manage sunset position data
 * Calculates and updates sunset terminator line and sun position
 */

export function useSunsetPosition(
  userLocation?: Location
): UseSunsetPositionReturn {
  const [sunsetData, setSunsetData] =
    useState<SimpleSunsetData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const calculateSunsetData = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);

      const now = new Date();
      const data = getSimpleSunsetLine(now);

      setSunsetData(data);
    } catch (err) {
      setError('Failed to calculate sunset position');
      console.error('Sunset calculation error:', err);
    } finally {
      setIsLoading(false);
    }
  }, [userLocation]);

  // Calculate sunset data on mount and when location changes
  useEffect(() => {
    calculateSunsetData();
  }, [calculateSunsetData]);

  // Set up auto-refresh every 5 minutes to keep data current
  useEffect(() => {
    const interval = setInterval(calculateSunsetData, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [calculateSunsetData]);

  const refresh = useCallback(() => {
    calculateSunsetData();
  }, [calculateSunsetData]);

  return {
    sunsetData,
    isLoading,
    error,
    refresh,
  };
}
