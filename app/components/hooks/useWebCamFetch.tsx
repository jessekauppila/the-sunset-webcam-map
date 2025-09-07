import { useState, useEffect } from 'react';
export interface WindyWebcam {
  webcamId: number;
  title: string;
  viewCount: number;
  status: string;
  images?: {
    current?: {
      preview?: string;
      thumbnail?: string;
      icon?: string;
    };
  };
  location: {
    city: string;
    region: string;
    longitude: number;
    latitude: number;
    country: string;
    continent: string;
  };

  categories: Array<{
    id: string;
    name: string;
  }>;
  lastUpdatedOn?: string;
}

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
        const centerLat = latitude;
        const centerLng = longitude;
        const boxSize = 5; // degrees in each direction

        // 🌐 Call our API route WITH coordinates
        const response = await fetch(
          `/api/webcams?centerLat=${centerLat}&centerLng=${centerLng}&boxSize=${boxSize}`
        );

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data: WindyResponse = await response.json();

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
