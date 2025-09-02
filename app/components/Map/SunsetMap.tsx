'use client';

import { useEffect, useRef, useState } from 'react';
import { useSunsetPosition } from '../../hooks/useSunsetPosition';
import type { Location } from '../../lib/types';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';

// Set Mapbox token
mapboxgl.accessToken =
  process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN || '';

interface SimpleSunsetMapProps {
  userLocation: Location;
  className?: string;
}

export default function SimpleSunsetMap({
  userLocation,
  className = '',
}: SimpleSunsetMapProps) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const [mapLoaded, setMapLoaded] = useState(false);

  // Get sunset location
  const { sunsetLocation, isLoading, error } =
    useSunsetPosition(userLocation);

  // Debug logs
  console.log('🏠 User Location:', userLocation);
  console.log('🌅 Sunset Location:', sunsetLocation);
  // console.log('⏳ Loading:', isLoading);
  // console.log('❌ Error:', error);
  // console.log('🗺️ Map Loaded:', mapLoaded);
  // console.log(
  //   '🔑 Mapbox Token:',
  //   mapboxgl.accessToken ? 'Present' : 'Missing'
  // );

  // Initialize map
  useEffect(() => {
    if (!mapContainer.current || map.current) return;

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

  // Center map on sunset location when it updates
  useEffect(() => {
    if (!map.current || !mapLoaded || !sunsetLocation) {
      console.log('⚠️ Skipping map center - missing requirements:', {
        hasMap: !!map.current,
        mapLoaded,
        hasSunsetLocation: !!sunsetLocation,
      });
      return;
    }

    console.log('🎯 Centering map on sunset:', sunsetLocation);

    // Calculate distance for logging
    const distance = Math.abs(userLocation.lng - sunsetLocation.lng);
    console.log(`📏 Distance west: ${distance.toFixed(1)}°`);

    // Smoothly fly to sunset location
    map.current.flyTo({
      center: [sunsetLocation.lng, sunsetLocation.lat],
      zoom: 8,
      duration: 2000,
    });

    // Add a marker at sunset location
    const marker = new mapboxgl.Marker({ color: '#ff6b35' })
      .setLngLat([sunsetLocation.lng, sunsetLocation.lat])
      .setPopup(
        new mapboxgl.Popup().setHTML(
          `<div class="text-center">
            <div class="text-lg">🌅</div>
            <div><strong>Sunset Location</strong></div>
            <div class="text-sm">${sunsetLocation.lat.toFixed(
              4
            )}, ${sunsetLocation.lng.toFixed(4)}</div>
            <div class="text-xs">Distance: ${distance.toFixed(
              1
            )}° west</div>
          </div>`
        )
      )
      .addTo(map.current);

    console.log('📍 Added sunset marker');
  }, [sunsetLocation, mapLoaded, userLocation]);

  if (isLoading) {
    return (
      <div
        className={`h-96 bg-gray-100 flex items-center justify-center ${className}`}
      >
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500 mx-auto mb-2"></div>
          <p>Finding sunset location...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div
        className={`h-96 bg-red-50 flex items-center justify-center ${className}`}
      >
        <div className="text-center text-red-600">
          <p>Error: {error}</p>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`h-96 bg-white border border-gray-300 rounded overflow-hidden ${className}`}
    >
      <div ref={mapContainer} className="w-full h-full" />
    </div>
  );
}
