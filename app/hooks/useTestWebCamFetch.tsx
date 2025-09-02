import { useState, useEffect } from 'react';

interface WindyWebcam {
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
}

interface WindyResponse {
  webcams: WindyWebcam[];
}

export function useTestWebCamFetch() {
  // 🎯 STATE: What data do we want to track?
  const [webcams, setWebcams] = useState<WindyWebcam[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  console.log('🌐 Fetching webcams via our API route...');

  // 🎯 EFFECT: When do we want to fetch data?
  useEffect(() => {
    const fetchWindyWebcams = async () => {
      try {
        setIsLoading(true);
        setError(null);

        // 🌐 Call our own API route
        const response = await fetch('/api/webcams');

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data: WindyResponse = await response.json();
        console.log('🌐 Windy API Response:', data);

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
  }, []); // Empty array = run once on mount

  // 🎯 RETURN: What do we want other components to use?
  return {
    webcams,
    isLoading,
    error,
    totalCount: webcams.length,
  };
}
