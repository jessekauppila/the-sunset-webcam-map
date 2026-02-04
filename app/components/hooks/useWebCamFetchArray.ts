import { useState, useEffect, useRef } from 'react';
import type { WindyWebcam, Location } from '../../lib/types';
import { SEARCH_RADIUS_DEG } from '@/app/lib/terminatorConfig';

interface WindyResponse {
  webcams: WindyWebcam[];
}

export function useWebcamFetchArray(locations: Location[]) {
  // 🎯 STATE: What data do we want to track?
  const [webcams, setWebcams] = useState<WindyWebcam[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const byIndexRef = useRef<Map<number, WindyWebcam[]>>(new Map());

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

    let cancelled = false;

    const uniqueById = (arr: WindyWebcam[]) =>
      arr.filter(
        (w, i, self) =>
          i === self.findIndex((v) => v.webcamId === w.webcamId)
      );

    const recompute = () => {
      const combined = uniqueById(
        Array.from(byIndexRef.current.values()).flat()
      );
      setWebcams(combined);
    };

    // prune old indices (locations list changed)
    for (const key of Array.from(byIndexRef.current.keys())) {
      if (key >= locations.length) byIndexRef.current.delete(key);
    }
    recompute(); // apply pruning immediately

    const fetchWindyWebcams = async () => {
      try {
        setIsLoading(true);
        setError(null);

        const limitedLocations = locations.slice(0);

        for (let i = 0; i < limitedLocations.length; i++) {
          const loc = limitedLocations[i];
          try {
            const res = await fetch(
              `/api/webcams?centerLat=${loc.lat}&centerLng=${loc.lng}&boxSize=${SEARCH_RADIUS_DEG}`
            );
            if (!res.ok) continue;
            const data: WindyResponse = await res.json();

            if (!cancelled) {
              byIndexRef.current.set(i, data.webcams || []);
              recompute(); // incremental update per location
            }
          } catch {}
          if (i < limitedLocations.length - 1) {
            await new Promise((r) => setTimeout(r, 600));
          }
        }
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : 'Failed to fetch webcams'
        );
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    fetchWindyWebcams();
    return () => {
      cancelled = true;
    };
  }, [locations]);

  console.log('📊 Hook returning:', {
    webcams: webcams.length,
    isLoading,
    error,
  });

  // �� RETURN: What do we want other components to use?
  return {
    webcams,
    isLoading,
    error,
    totalCount: webcams.length,
  };
}
