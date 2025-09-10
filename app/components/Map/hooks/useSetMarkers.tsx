// Add a marker at sunset location
import type { Location } from '../../../lib/types';
import mapboxgl from 'mapbox-gl';
import { useEffect } from 'react';

export function useSetMarkers(
  map: mapboxgl.Map | null,
  mapLoaded: boolean,
  locations: Location[]
) {
  useEffect(() => {
    if (!map || !mapLoaded || !locations || locations.length === 0) {
      console.log(
        '⚠️ Skipping marker setting - missing requirements:',
        {
          hasMap: !!map,
          mapLoaded,
          hasLocation: !!locations,
        }
      );
      return;
    }

    console.log('📍 Setting markers:', locations);
    const markers: mapboxgl.Marker[] = [];

    for (let i = 0; i < locations.length; i++) {
      const location = locations[i];
      try {
        const marker = new mapboxgl.Marker()
          .setLngLat([location.lng, location.lat])
          .addTo(map);

        markers.push(marker);
        console.log('📍 Added sunset marker successfully');
      } catch (error) {
        console.error('❌ Error creating marker:', error);
      }
    }

    return () => {
      markers.forEach((marker) => marker.remove());
    };
  }, [map, mapLoaded, locations]);
}
