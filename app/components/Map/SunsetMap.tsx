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

  // Initialize map
  useEffect(() => {
    if (!mapContainer.current || map.current) return;

    map.current = new mapboxgl.Map({
      container: mapContainer.current,
      style: 'mapbox://styles/mapbox/satellite-v9', // Satellite view for sunset!
      center: [userLocation.lng, userLocation.lat], // Start at user location
      zoom: 6,
    });

    map.current.on('load', () => {
      setMapLoaded(true);
    });

    // Cleanup
    return () => {
      if (map.current) {
        map.current.remove();
        map.current = null;
      }
    };
  }, [userLocation]);

  // Center map on sunset location when it updates
  useEffect(() => {
    if (!map.current || !mapLoaded || !sunsetLocation) return;

    console.log('Centering map on sunset:', sunsetLocation);

    // Smoothly fly to sunset location
    map.current.flyTo({
      center: [sunsetLocation.lng, sunsetLocation.lat],
      zoom: 8,
      duration: 2000, // 2 second animation
    });

    // Add a marker at sunset location
    new mapboxgl.Marker({ color: '#ff6b35' }) // Orange sunset marker
      .setLngLat([sunsetLocation.lng, sunsetLocation.lat])
      .setPopup(
        new mapboxgl.Popup().setHTML(
          `<div class="text-center">
              <div class="text-lg">🌅</div>
              <div><strong>Sunset Location</strong></div>
              <div class="text-sm">${sunsetLocation.lat.toFixed(
                4
              )}, ${sunsetLocation.lng.toFixed(4)}</div>
            </div>`
        )
      )
      .addTo(map.current);
  }, [sunsetLocation, mapLoaded]);

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
      className={`h-96 bg-white border border-gray-300 rounded ${className}`}
    >
      <div className="p-4">
        <div
          ref={mapContainer}
          className="mt-4 h-64 bg-gray-100 border border-gray-200 rounded flex items-center justify-center"
        >
          <div className="text-center">
            <div className="text-2xl mb-2">🗺️</div>
            <p className="text-sm text-gray-800">
              Map will center here
            </p>
            {sunsetLocation && (
              <p className="text-xs mt-1 text-black">
                Lat: {sunsetLocation.lat.toFixed(4)}
                <br />
                Lng: {sunsetLocation.lng.toFixed(4)}
              </p>
            )}
            <div ref={mapContainer} className="w-full h-full" />
          </div>
        </div>
      </div>
    </div>
  );
}
