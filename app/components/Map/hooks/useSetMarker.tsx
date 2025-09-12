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
    console.log('🔍 useSetMarker effect running:', {
      hasMap: !!map,
      mapLoaded,
      hasLocation: !!location,
      mapType: typeof map,
      mapConstructor: map?.constructor?.name
    });

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

    // Additional safety check to ensure map is a valid Mapbox map
    if (!map || typeof (map as any).addTo !== 'function') {
      console.error('❌ Map object is not a valid Mapbox map:', map);
      return;
    }

    try {
      console.log('✅ Creating marker for location:', location);
      // Create a default Marker and add it to the map.
      const marker = new mapboxgl.Marker()
        .setLngLat([location.lng, location.lat])
        .addTo(map);

      console.log('✅ Marker created and added successfully');

      return () => {
        if (marker) {
          console.log('🧹 Removing marker');
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
