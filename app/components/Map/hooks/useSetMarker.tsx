// Add a marker at sunset location
import type { Location } from '../../../lib/types';
import mapboxgl from 'mapbox-gl';
import { useEffect } from 'react';

export function useSetMarker(
  map: mapboxgl.Map | null,
  mapLoaded: boolean,
  location: Location | null
) {
  useEffect(() => {
    if (!map || !mapLoaded || !location) {
      console.log(
        '⚠️ Skipping marker setting - missing requirements:',
        {
          hasMap: !!map,
          mapLoaded,
          hasLocation: !!location,
        }
      );
      return;
    }

    // Remove the setTimeout temporarily for debugging
    try {
      // Create a default Marker and add it to the map.
      const marker = new mapboxgl.Marker()
        .setLngLat([location.lng, location.lat])
        .addTo(map);

      return () => {
        if (marker) {
          marker.remove();
        }
      };
    } catch (error) {
      console.error('❌ Error creating marker:', error);
    }
  }, [map, mapLoaded, location]);
}
