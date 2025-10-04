//Hook for manually loading ALL webcams (not auto-refreshing like terminator webcams)

'use client';

import { useState } from 'react';
import type { WindyWebcam } from '@/app/lib/types';
import { useAllWebcamsStore } from '@/app/store/useAllWebcamsStore';

export function useLoadAllWebcams() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setAllWebcams = useAllWebcamsStore((s) => s.setAllWebcams);

  const loadAllWebcams = async (): Promise<WindyWebcam[] | null> => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/db-all-webcams');

      if (!response.ok) {
        throw new Error(
          `Failed to fetch webcams: ${response.status}`
        );
      }

      const webcams: WindyWebcam[] = await response.json();

      // Update the Zustand store with all webcams
      setAllWebcams(webcams);

      return webcams;
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : 'Unknown error';
      setError(errorMessage);
      console.error('Error loading all webcams:', err);
      return null;
    } finally {
      setIsLoading(false);
    }
  };

  return {
    loadAllWebcams,
    isLoading,
    error,
  };
}
