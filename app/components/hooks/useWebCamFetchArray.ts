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
    console.log(
      '🔄 useWebcamFetchArray triggered with locations:',
      locations.length
    );

    if (locations.length === 0) {
      console.log('❌ No locations provided');
      setWebcams([]);
      setIsLoading(false);
      return;
    }

    const fetchWindyWebcams = async () => {
      console.log(
        '🚀 Starting to fetch webcams for',
        locations.length,
        'locations'
      );
      try {
        setIsLoading(true);
        setError(null);

        const allWebcams: WindyWebcam[] = [];

        //LIMITS LOCATIONS
        const limitedLocations = locations.slice(0);
        for (let i = 0; i < limitedLocations.length; i++) {
          const location = limitedLocations[i];

          try {
            // 🎯 Pass center coordinates and box size
            const centerLat = location.lat;
            const centerLng = location.lng;
            const boxSize = 5;

            console.log(
              `🌐 Fetching webcams for location ${i + 1}/${
                limitedLocations.length
              }: lat=${centerLat}, lng=${centerLng}`
            );

            // 🌐 Call our API route WITH coordinates
            const response = await fetch(
              `/api/webcams?centerLat=${centerLat}&centerLng=${centerLng}&boxSize=${boxSize}`
            );

            if (!response.ok) {
              console.log(
                `❌ API call ${i + 1} failed with status ${
                  response.status
                }, skipping...`
              );
              continue; // Skip this location and continue to the next one
            }

            const data: WindyResponse = await response.json();
            console.log(
              `📍 API response for lat=${centerLat}, lng=${centerLng}:`,
              data
            );
            console.log(
              `📍 Found ${data.webcams?.length || 0} webcams`
            );

            allWebcams.push(...(data.webcams || []));
          } catch (err) {
            console.log(
              `❌ Error fetching webcams for location ${
                i + 1
              }, continuing...`
            );
            // Continue to next location instead of stopping
          }

          // Add delay between requests
          if (i < limitedLocations.length - 1) {
            await new Promise((resolve) => setTimeout(resolve, 1000));
          }
        }
        setWebcams(allWebcams);
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

  console.log('📊 Hook returning:', {
    webcams: webcams.length,
    isLoading,
    error,
  });

  // 🎯 RETURN: What do we want other components to use?
  return {
    webcams,
    isLoading,
    error,
    totalCount: webcams.length,
  };
}
