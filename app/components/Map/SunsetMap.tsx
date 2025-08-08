'use client';

import { useEffect, useRef, useState } from 'react';
import { useSunsetPosition } from '../../hooks/useSunsetPosition';
import type { Location } from '../../lib/types';

interface SimpleSunsetMapProps {
  userLocation: Location;
  className?: string;
}

export default function SimpleSunsetMap({
  userLocation,
  className = '',
}: SimpleSunsetMapProps) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const [map, setMap] = useState<any>(null);

  // Get sunset location
  const { sunsetLocation, isLoading, error } =
    useSunsetPosition(userLocation);

  // Initialize map (without Mapbox for now - let's use a simple placeholder)
  useEffect(() => {
    if (!mapContainer.current || map) return;

    // For MVP, let's just show coordinates instead of a real map
    // You can add Mapbox later when you get the API key
    console.log('Map would center on:', sunsetLocation);
  }, [sunsetLocation]);

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
          </div>
        </div>
      </div>
    </div>
  );
}
