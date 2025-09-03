import { useEffect } from 'react';
import type { Location } from '@/app/lib/types';

export function useFlyTo(
  map: mapboxgl.Map | null,
  mapLoaded: boolean,
  sunsetLocation: Location | null
) {
  useEffect(() => {
    if (!map || !mapLoaded || !sunsetLocation) {
      console.log(
        '⚠️ Skipping marker setting - missing requirements:',
        {
          hasMap: !!map,
          mapLoaded,
          hasSunsetLocation: !!sunsetLocation,
        }
      );
      return;
    }

    console.log('🎯 Set fly to:', sunsetLocation);

    // Smoothly fly to sunset location
    map.flyTo({
      center: [sunsetLocation.lng, sunsetLocation.lat],
      zoom: 2,
      duration: 6000,
    });

    // // Add a marker at sunset location
    // const marker = new mapboxgl.Marker({ color: '#ff6b35' })
    //   .setLngLat([sunsetLocation.lng, sunsetLocation.lat])
    //   .setPopup(
    //     new mapboxgl.Popup().setHTML(
    //       `<div class="text-center">
    //         <div class="text-lg">🌅</div>
    //         <div><strong>Sunset Location</strong></div>
    //         <div class="text-sm">${sunsetLocation.lat.toFixed(
    //           4
    //         )}, ${sunsetLocation.lng.toFixed(4)}</div>
    //         <div class="text-xs">Distance: ${distance.toFixed(
    //           1
    //         )}° west</div>
    //       </div>`
    //     )
    //   )
    //   .addTo(map.current);

    //console.log('📍 Added sunset marker');
  }, [map, mapLoaded, sunsetLocation]);
}
