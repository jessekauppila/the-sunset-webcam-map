import { useEffect, useRef, useState } from 'react';
import type { Location } from '../../../lib/types';
import mapboxgl from 'mapbox-gl';

export function useMap(
  userLocation: Location,
  enabled: boolean = true
) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [mapReady, setMapReady] = useState(false);

  const initialCenterRef = useRef<[number, number]>([
    userLocation.lng,
    userLocation.lat,
  ]);

  // Set Mapbox token
  mapboxgl.accessToken =
    process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN || '';

  // Initialize map
  useEffect(() => {
    // Function to calculate sun position and update map lighting
    const updateSunLighting = (date: Date = new Date()) => {
      if (!map.current || !map.current.isStyleLoaded()) return;

      // Calculate sun position (simplified - you can use a more accurate calculation)
      const sunPosition = calculateSunPosition(date);

      // Update the map's light source
      map.current.setLight({
        anchor: 'map',
        color: '#ffffff',
        intensity: 1,
        position: sunPosition,
      });
    };

    // Simple sun position calculation (you can make this more accurate)
    const calculateSunPosition = (date: Date) => {
      const time = date.getTime() / 1000; // Convert to seconds
      const dayOfYear = Math.floor(
        (date.getTime() -
          new Date(date.getFullYear(), 0, 0).getTime()) /
          86400000
      );

      // Simplified sun position calculation
      const declination =
        23.45 * Math.sin(((284 + dayOfYear) * Math.PI) / 180);
      const hourAngle = (time % 86400) / 3600 - 12; // Hours from noon

      const lat = declination;
      const lng = hourAngle * 15; // Convert hours to degrees

      return [lng, lat, 1] as [number, number, number]; // [longitude, latitude, altitude]
    };
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

    console.log('🚀 Initializing map...');

    map.current = new mapboxgl.Map({
      container: mapContainer.current,

      //style: 'mapbox://styles/mapbox/dark-v11',
      //this is the older dark version that was fantastic...!

      
      // Use dark style - terminator visualization should be visible on top
      // To see ONLY the terminator visualization, you can set map opacity via CSS
      style: 'mapbox://styles/mapbox/dark-v11', // Normal dark map
      // Alternative: Use a very minimal style (may cause errors if not properly formatted)
      // style: { version: 8, sources: {}, layers: [] } as mapboxgl.Style,
      center: initialCenterRef.current, // ← Use the ref instead
      zoom: 6,
    });

    map.current.on('load', () => {
      console.log('✅ Map loaded successfully!');
      setMapLoaded(true);

      // Set initial sun lighting
      updateSunLighting();
    });

    map.current.on('style.load', () => {
      console.log('✅ Map style loaded!');
      setMapReady(true);

      // Update sun lighting when style loads
      updateSunLighting();
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
        setMapLoaded(false);
        setMapReady(false);
      }
    };
  }, [enabled]);

  // Function to update sun lighting (can be called from parent components)
  // const updateSunPosition = (date: Date) => {
  //   updateSunLighting(date);
  // };

  return {
    mapContainer,
    map: map.current || null,
    mapLoaded,
    mapReady,
    hasToken: !!mapboxgl.accessToken,
    // updateSunPosition, // Export this function
  };
}
