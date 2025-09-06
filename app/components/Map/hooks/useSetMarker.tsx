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

    console.log('📍 Setting marker:', location);

    // Remove the setTimeout temporarily for debugging
    try {
      // Create a default Marker and add it to the map.
      const marker = new mapboxgl.Marker()
        .setLngLat([location.lng, location.lat])
        .addTo(map);

      console.log('📍 Added sunset marker successfully');

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

//const marker = new mapboxgl.Marker({ color: '#ff6b35' })

//     .setLngLat([location.lng, location.lat])
//     .setPopup(
//       new mapboxgl.Popup().setHTML(
//         `<div class="text-center">
//           <div class="text-lg">🌅</div>
//           <div><strong>Sunset Location</strong></div>

//         </div>`
//       )
//     )
//     .addTo(map);
