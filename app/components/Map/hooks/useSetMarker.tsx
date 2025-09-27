// Add a marker at sunset location
import type { Location } from '../../../lib/types';
import { useEffect } from 'react';

type MapInstance = {
  isStyleLoaded?: () => boolean;
  getContainer?: () => HTMLElement | null;
};

export function useSetMarker(
  map: MapInstance | null,
  mapReady: boolean,
  location: Location | null
) {
  useEffect(() => {
    // Only run on client side
    if (typeof window === 'undefined') return;

    console.log('🔍 useSetMarker effect running:', {
      hasMap: !!map,
      mapReady,
      hasLocation: !!location,
      locationType: typeof location,
      locationKeys: location ? Object.keys(location) : 'null',
      locationValue: location,
      mapType: typeof map,
      mapConstructor: map?.constructor?.name,
      mapKeys: map ? Object.keys(map) : 'null',
    });

    // More robust validation
    if (
      !map ||
      !mapReady ||
      !location ||
      typeof location !== 'object' ||
      !location.lng ||
      !location.lat ||
      (typeof map === 'object' && Object.keys(map).length === 0) // Check if map is empty object
    ) {
      console.log(
        '⚠️ Skipping marker setting - missing requirements:',
        {
          hasMap: !!map,
          mapReady,
          hasLocation: !!location,
          hasLng: location?.lng !== undefined,
          hasLat: location?.lat !== undefined,
          locationType: typeof location,
          locationValue: location,
        }
      );
      return;
    }

    // Dynamic import to avoid SSR issues
    import('mapbox-gl').then((mapboxgl) => {
      try {
        // More comprehensive validation
        if (
          !map ||
          !(map as MapInstance).isStyleLoaded ||
          !(map as MapInstance).getContainer
        ) {
          console.log('⚠️ Map not ready, skipping marker creation');
          return;
        }

        // Check if map container exists and is properly initialized
        const mapContainer = (map as MapInstance).getContainer?.();
        if (!mapContainer) {
          console.log(
            '⚠️ Map container not available, skipping marker creation'
          );
          return;
        }

        // Check if map is actually a Mapbox GL map instance
        const mapboxMap = map as unknown as mapboxgl.Map;
        if (!mapboxMap.isStyleLoaded || !mapboxMap.isStyleLoaded()) {
          console.log(
            '⚠️ Map style not loaded, skipping marker creation'
          );
          return;
        }

        console.log('✅ Creating marker for location:', location);
        // Create a default Marker and add it to the map.
        const marker = new mapboxgl.default.Marker({
          color: '#374151',
        })
          .setLngLat([location.lng, location.lat])
          .addTo(mapboxMap);

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
    });
  }, [map, mapReady, location]);
}
