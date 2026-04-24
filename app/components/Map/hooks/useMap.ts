import { useEffect, useRef, useState } from 'react';
import type { Location } from '../../../lib/types';
import mapboxgl from 'mapbox-gl';

export interface UseMapOptions {
  projection?: 'globe' | 'mercator';
}

export function useMap(
  userLocation: Location,
  enabled: boolean = true,
  options: UseMapOptions = {},
) {
  const projection = options.projection ?? 'mercator';

  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [mapReady, setMapReady] = useState(false);

  const initialCenterRef = useRef<[number, number]>([
    userLocation.lng,
    userLocation.lat,
  ]);

  // Set Mapbox token once
  mapboxgl.accessToken =
    process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN || '';

  useEffect(() => {
    if (!enabled) {
      if (map.current) {
        console.log('🧹 Cleaning up map (disabled)...');
        map.current.remove();
        map.current = null;
        setMapLoaded(false);
        setMapReady(false);
      }
      return;
    }

    if (!mapContainer.current || map.current) return;

    if (!mapboxgl.accessToken) {
      console.error('❌ No Mapbox access token found!');
      return;
    }

    console.log(`🚀 Initializing map (projection=${projection})...`);

    map.current = new mapboxgl.Map({
      container: mapContainer.current,
      style: 'mapbox://styles/mapbox/dark-v11',
      center: initialCenterRef.current,
      zoom: projection === 'globe' ? 0 : 6,
      projection: { name: projection },
    });

    map.current.on('load', () => {
      console.log('✅ Map loaded successfully!');
      setMapLoaded(true);
    });

    map.current.on('style.load', () => {
      console.log('✅ Map style loaded!');
      setMapReady(true);
    });

    map.current.on('error', (e) => {
      console.error('🚨 Map error:', e);
    });

    return () => {
      if (map.current) {
        console.log('🧹 Cleaning up map...');
        map.current.remove();
        map.current = null;
        setMapLoaded(false);
        setMapReady(false);
      }
    };
  }, [enabled, projection]);

  return {
    mapContainer,
    map: map.current || null,
    mapLoaded,
    mapReady,
    hasToken: !!mapboxgl.accessToken,
  };
}
