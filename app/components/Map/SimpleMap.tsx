'use client';

import { useMap } from '../../hooks/useMap';
import type { Location } from '../../lib/types';

interface SimpleMapProps {
  userLocation: Location;
}

export default function SimpleMap({ userLocation }: SimpleMapProps) {
  const { mapContainer, mapLoaded, hasToken } = useMap(userLocation);

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
    <div className="h-96 bg-white border border-gray-300 rounded overflow-hidden mb-8">
      <div ref={mapContainer} className="w-full h-full" />
      {!mapLoaded && (
        <div className="absolute inset-0 bg-gray-100 flex items-center justify-center">
          <div className="text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500 mx-auto mb-2"></div>
            <p>Loading map...</p>
          </div>
        </div>
      )}
    </div>
  );
}
