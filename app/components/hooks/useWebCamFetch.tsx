import { useState, useEffect } from 'react';
import type { WindyWebcam } from '@/app/lib/types';
import { SEARCH_RADIUS_DEG } from '@/app/lib/terminatorConfig';

interface WindyResponse {
  webcams: WindyWebcam[];
}

export function useWebcamFetch(latitude: number, longitude: number) {
  // 🎯 STATE: What data do we want to track?
  const [webcams, setWebcams] = useState<WindyWebcam[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 🎯 EFFECT: When do we want to fetch data?
  useEffect(() => {
    const fetchWindyWebcams = async () => {
      try {
        setIsLoading(true);
        setError(null);

        // 🎯 Pass center coordinates and box size
        const centerLat = latitude; // NYC latitude
        const centerLng = longitude; // NYC longitude
        // Keep client-side fetch radius consistent with terminator config
        const boxSize = SEARCH_RADIUS_DEG; // degrees in each direction was 5

        // console.log(`Hook Latitude: ${centerLat}`);
        // console.log(`Hook Longitude: ${centerLng}`);

        // 🌐 Call our API route WITH coordinates
        const response = await fetch(
          `/api/webcams?centerLat=${centerLat}&centerLng=${centerLng}&boxSize=${boxSize}`
        );

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data: WindyResponse = await response.json();
        // console.log('🌐 Windy API Response:', data);

        setWebcams(data.webcams || []);
      } catch (err) {
        console.error('❌ Windy API Error:', err);
        setError(
          err instanceof Error
            ? err.message
            : 'Failed to fetch webcams'
        );
      } finally {
        setIsLoading(false);
      }
    };

    fetchWindyWebcams();
  }, [latitude, longitude]); // Re-run when coordinates change

  // 🎯 RETURN: What do we want other components to use?
  return {
    webcams,
    isLoading,
    error,
    totalCount: webcams.length,
  };
}
