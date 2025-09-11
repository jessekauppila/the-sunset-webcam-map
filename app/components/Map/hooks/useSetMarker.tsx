// Add a marker at sunset location
import type { Location } from '../../../lib/types';
import mapboxgl from 'mapbox-gl';
import { useEffect, useRef } from 'react';

export function useSetMarker(
  map: mapboxgl.Map | null,
  mapLoaded: boolean,
  location: Location | null
) {
  const markerRef = useRef<mapboxgl.Marker | null>(null);

  useEffect(() => {
    if (!map || !mapLoaded || !location) return;

    const container = (map as any).getContainer?.();
    if (!container || !container.isConnected) return; // map is tearing down

    try {
      if (!markerRef.current) {
        markerRef.current = new mapboxgl.Marker()
          .setLngLat([location.lng, location.lat])
          .addTo(map);
      } else {
        markerRef.current.setLngLat([location.lng, location.lat]);
      }
    } catch {
      // ignore if map is being torn down
    }

    return () => {
      try {
        markerRef.current?.remove();
      } catch {}
      markerRef.current = null;
    };
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
