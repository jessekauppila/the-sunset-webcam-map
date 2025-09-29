import { useEffect, useRef } from 'react';
import type { Location } from '../../../lib/types';

export function useFlyTo(
  map: mapboxgl.Map | null,
  mapLoaded: boolean,
  location: Location | null
) {
  const hasFlownRef = useRef(false);

  useEffect(() => {
    // Only run on client side
    if (typeof window === 'undefined') return;

    console.log('🔍 useFlyTo effect running:', {
      hasMap: !!map,
      mapLoaded,
      hasLocation: !!location,
      hasFlownBefore: hasFlownRef.current,
    });

    if (!map || !mapLoaded || !location) {
      console.log('⚠️ Skipping fly to - missing requirements:', {
        hasMap: !!map,
        mapLoaded,
        hasLocation: !!location,
      });
      return;
    }

    // Only fly to location once (on first render)
    if (hasFlownRef.current) {
      console.log('🚫 Skipping fly to - already flown before');
      return;
    }

    console.log('🎯 Flying to location (first time):', location);
    hasFlownRef.current = true; //have to make this true so it only runs once at load...

    // Smoothly fly to sunset location
    map.flyTo({
      center: [location.lng, location.lat],
      zoom: 2,
      duration: 2000,
      easing: (t) => t * (2 - t),
    });
  }, [map, mapLoaded, location]);
}
