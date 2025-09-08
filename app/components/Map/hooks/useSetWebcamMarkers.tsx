// Add a marker at sunset location
//import type { Location } from '../../../lib/types';
import mapboxgl from 'mapbox-gl';
import { useEffect } from 'react';
import type { WindyWebcam } from '../../../lib/types';

export function useSetWebcamMarkers(
  map: mapboxgl.Map | null,
  mapLoaded: boolean,
  //locations: Location[]
  webcams: WindyWebcam[]
) {
  useEffect(() => {
    if (!map || !mapLoaded || !webcams || webcams.length === 0) {
      console.log(
        '⚠️ Skipping marker setting - missing requirements:',
        {
          hasMap: !!map,
          mapLoaded,
          hasLocation: !!webcams,
        }
      );
      return;
    }

    console.log('📍 Setting markers:', webcams);
    const markers: mapboxgl.Marker[] = [];

    for (let i = 0; i < webcams.length; i++) {
      const webcam = webcams[i];
      try {
        const marker = new mapboxgl.Marker()
          .setLngLat([
            webcam.location.longitude,
            webcam.location.latitude,
          ])
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
  }, [map, mapLoaded, webcams]);
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
