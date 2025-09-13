import { useEffect } from 'react';
import type { Location } from '../../../lib/types';

export function useFlyTo(
  map: mapboxgl.Map | null,
  mapLoaded: boolean,
  location: Location | null
) {
  useEffect(() => {
    console.log('🔍 useFlyTo effect running:', {
      hasMap: !!map,
      mapLoaded,
      hasLocation: !!location,
      mapType: typeof map,
      mapConstructor: map?.constructor?.name,
    });

    if (!map || !mapLoaded || !location) {
      console.log('⚠️ Skipping fly to - missing requirements:', {
        hasMap: !!map,
        mapLoaded,
        hasLocation: !!location,
      });
      return;
    }

    console.log('🎯 Set fly to:', location);

    // Smoothly fly to sunset location
    map.flyTo({
      center: [location.lng, location.lat],
      zoom: 2,
      duration: 2000, // Reduce from 6000 to 2000ms
      easing: (t) => t * (2 - t), // Add smooth easing
    });
  }, [map, mapLoaded, location]);
}
