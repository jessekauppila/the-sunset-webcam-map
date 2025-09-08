import { useState, useEffect } from 'react';
import type { WindyWebcam, Location } from '../../lib/types';

interface WindyResponse {
  webcams: WindyWebcam[];
}

export function useWebcamFetchArray(locations: Location[]) {
  // 🎯 STATE: What data do we want to track?
  const [webcams, setWebcams] = useState<WindyWebcam[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 🎯 EFFECT: When do we want to fetch data?
  useEffect(() => {
    if (locations.length === 0) {
      setWebcams([]);
      setIsLoading(false);
      return;
    }
    const fetchWindyWebcams = async () => {
      try {
        setIsLoading(true);
        setError(null);

        const allWebcams: WindyWebcam[] = [];

        for (let i = 0; i < locations.length; i++) {
          const location = locations[i];

          // 🎯 Pass center coordinates and box size
          const centerLat = location.lat;
          const centerLng = location.lng;
          const boxSize = 5; // degrees in each direction

          // 🌐 Call our API route WITH coordinates
          const response = await fetch(
            `/api/webcams?centerLat=${centerLat}&centerLng=${centerLng}&boxSize=${boxSize}`
          );

          if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
          }

          const data: WindyResponse = await response.json();

          allWebcams.push(...(data.webcams || []));
        }
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
  }, [locations]); // Re-run when coordinates change

  // 🎯 RETURN: What do we want other components to use?
  return {
    webcams,
    isLoading,
    error,
    totalCount: webcams.length,
  };
}
