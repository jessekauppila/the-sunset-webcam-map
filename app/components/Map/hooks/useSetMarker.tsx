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
      console.log('⚠️ Skipping map center - missing requirements:', {
        hasMap: !!map,
        mapLoaded,
        hasSunsetLocation: !!location,
      });
      return;
    }

    console.log('📍 Setting marker at:', location);

    const marker = new mapboxgl.Marker({ color: '#ff6b35' })
      .setLngLat([location.lng, location.lat])
      .setPopup(
        new mapboxgl.Popup().setHTML(
          `<div class="text-center">
            <div class="text-lg">🌅</div>
            <div><strong>Sunset Location</strong></div>
            <div class="text-sm">${location.lat.toFixed(
              4
            )}, ${location.lng.toFixed(4)}</div>
          </div>`
        )
      )
      .addTo(map);

    console.log('📍 Added sunset marker');

    return () => {
      if (marker) {
        marker.remove();
      }
    };
  }, [map, mapLoaded, location]);
}
