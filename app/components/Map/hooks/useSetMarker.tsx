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
      locationType: typeof location,
      locationKeys: location ? Object.keys(location) : 'null',
      locationValue: location
    });

    // More robust validation
    if (!map || !mapLoaded || !location || typeof location !== 'object' || !location.lng || !location.lat) {
      console.log('⚠️ Skipping marker setting - missing requirements:', {
        hasMap: !!map,
        mapLoaded,
        hasLocation: !!location,
        hasLng: location?.lng !== undefined,
        hasLat: location?.lat !== undefined,
        locationType: typeof location,
        locationValue: location
      });
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