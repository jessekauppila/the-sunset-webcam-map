import { useEffect, useRef, useState } from 'react';
import type { Location } from '../../../lib/types';
import mapboxgl from 'mapbox-gl';

export function useMap(userLocation: Location) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [mapReady, setMapReady] = useState(false); // New state

  // Set Mapbox token
  mapboxgl.accessToken =
    process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN || '';

  // Initialize map
  useEffect(() => {
    if (!mapContainer.current || map.current) return;

    if (!mapboxgl.accessToken) {
      console.error('❌ No Mapbox access token found!');
      return;
    }

    console.log('🚀 Initializing map...');

    map.current = new mapboxgl.Map({
      container: mapContainer.current,
      style: 'mapbox://styles/mapbox/satellite-v9',
      center: [userLocation.lng, userLocation.lat],
      zoom: 6,
    });

    map.current.on('load', () => {
      console.log('✅ Map loaded successfully!');
      setMapLoaded(true);
    });

    map.current.on('style.load', () => {
      console.log('✅ Map style loaded!');
      setMapReady(true); // Map is fully ready
    });

    map.current.on('error', (e) => {
      console.error('🚨 Map error:', e);
    });

    // Cleanup
    return () => {
      if (map.current) {
        console.log('🧹 Cleaning up map...');
        map.current.remove();
        map.current = null;
      }
    };
  }, [userLocation]);

  return {
    mapContainer,
    map: map.current,
    mapLoaded,
    mapReady,
    hasToken: !!mapboxgl.accessToken,
  };
}
