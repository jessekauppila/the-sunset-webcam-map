'use client';

import { useMap } from './hooks/useMap';
import { useFlyTo } from './hooks/useFlyTo';
import { useSunsetPosition } from './hooks/useSunsetPosition';
import { useSetMarker } from './hooks/useSetMarker';
import mapboxgl from 'mapbox-gl';
import { useEffect } from 'react';

import type { Location } from '../../lib/types';

interface SimpleMapProps {
  userLocation: Location;
}

export default function SimpleMap({ userLocation }: SimpleMapProps) {
  const { mapContainer, map, mapLoaded, hasToken } =
    useMap(userLocation);
  const { sunsetLocation, isLoading, error } =
    useSunsetPosition(userLocation);

  useFlyTo(map, mapLoaded, sunsetLocation);
  //useSetMarker(map, mapLoaded, sunsetLocation);

  // Simple test marker with useEffect
  useEffect(() => {
    if (map && mapLoaded && hasToken) {
      console.log('🎯 Adding test marker...');
      try {
        const center = map.getCenter();
        const zoom = map.getZoom();
        const bounds = map.getBounds();

        console.log('🗺️ Map state:', {
          center: { lng: center.lng, lat: center.lat },
          zoom,
          bounds: bounds
            ? {
                north: bounds.getNorth(),
                south: bounds.getSouth(),
                east: bounds.getEast(),
                west: bounds.getWest(),
              }
            : null,
        });

        // Test: Add marker using the EXACT same coordinates as map center
        const centerEl = document.createElement('div');
        centerEl.style.width = '40px';
        centerEl.style.height = '40px';
        centerEl.style.backgroundColor = 'yellow';
        centerEl.style.borderRadius = '50%';
        centerEl.style.border = '4px solid black';
        centerEl.style.boxShadow = '0 0 15px rgba(0,0,0,0.8)';

        // Use the exact coordinates from map.getCenter()
        new mapboxgl.Marker(centerEl)
          .setLngLat([center.lng, center.lat])
          .addTo(map);
        console.log('✅ Yellow marker added at map center!');

        // Test: Add marker at user location (should be NYC)
        const userEl = document.createElement('div');
        userEl.style.width = '40px';
        userEl.style.height = '40px';
        userEl.style.backgroundColor = 'red';
        userEl.style.borderRadius = '50%';
        userEl.style.border = '4px solid white';
        userEl.style.boxShadow = '0 0 15px rgba(0,0,0,0.8)';

        new mapboxgl.Marker(userEl)
          .setLngLat([userLocation.lng, userLocation.lat])
          .addTo(map);
        console.log('✅ Red marker added at user location!');
      } catch (error) {
        console.error('❌ Error adding test marker:', error);
      }
    }
  }, [map, mapLoaded, hasToken, userLocation]);

  //now use useToFly to fly to the Sunset Location and set that as the location that the

  if (!hasToken) {
    return (
      <div className="h-96 bg-red-50 flex items-center justify-center mb-8">
        <div className="text-center text-red-600">
          <p>❌ Mapbox access token not found!</p>
          <p className="text-sm">
            Add NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN to .env.local
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-96 relative">
      {' '}
      {/* Remove extra styling */}
      {/* Main Map */}
      <div
        ref={mapContainer}
        className="w-full h-full"
        style={{
          position: 'relative',
          zIndex: 1,
        }}
      />
      {/* Loading Overlay */}
      {!mapLoaded && (
        <div
          className="absolute inset-0 bg-gray-500 flex items-center justify-center"
          style={{ zIndex: 2 }}
        >
          <div className="text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500 mx-auto mb-2"></div>
            <p>Loading map...</p>
          </div>
        </div>
      )}
      {/* Sunset Loading Overlay */}
      {isLoading && (
        <div
          className="absolute top-2 left-2 bg-blue-50 border border-blue-200 rounded p-2"
          style={{ zIndex: 3 }}
        >
          <div className="flex items-center gap-2">
            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-500"></div>
            <span className="text-sm text-blue-700">
              Finding sunset...
            </span>
          </div>
        </div>
      )}
      {/* Error Overlay */}
      {error && (
        <div
          className="absolute top-2 right-2 bg-red-50 border border-red-200 rounded p-2 max-w-xs"
          style={{ zIndex: 3 }}
        >
          <p className="text-sm text-red-700">⚠️ {error}</p>
        </div>
      )}
      {/* Sunset Info Overlay */}
      {sunsetLocation && !isLoading && !error && (
        <div
          className="absolute top-14 left-2 bg-green-50 border border-green-200 rounded p-2"
          style={{ zIndex: 3 }}
        >
          <p className="text-sm text-green-700">
            🌅 Sunset: {sunsetLocation.lat.toFixed(2)},{' '}
            {sunsetLocation.lng.toFixed(2)}
          </p>
        </div>
      )}
      {/* User Location Overlay */}
      {userLocation && !isLoading && !error && (
        <div
          className="absolute top-2 left-2 bg-green-50 border border-green-200 rounded p-2"
          style={{ zIndex: 3 }}
        >
          <p className="text-sm text-green-700">
            🌅 User: {userLocation.lat.toFixed(2)},{' '}
            {userLocation.lng.toFixed(2)}
          </p>
        </div>
      )}
    </div>
  );
}
