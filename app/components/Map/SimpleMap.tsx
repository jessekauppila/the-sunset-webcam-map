'use client';

import { useMap } from './hooks/useMap';
import { useFlyTo } from './hooks/useFlyTo';
import { useSunsetPosition } from './hooks/useSunsetPosition';
import { useSetMarker } from './hooks/useSetMarker';
// import { useWebcamFetch } from '@/app/hooks/useWebcamFetch';
import WebcamFetchDisplay from '../WebcamFetchDisplay';
import { subsolarPoint } from './lib/subsolarLocation';
import { splitTerminatorSunriseSunset } from './lib/terminatorRing';

import 'mapbox-gl/dist/mapbox-gl.css';

import type { Location } from '../../lib/types';

interface SimpleMapProps {
  userLocation: Location;
}

export default function SimpleMap({ userLocation }: SimpleMapProps) {
  const { mapContainer, map, mapLoaded, hasToken } =
    useMap(userLocation);
  const { sunsetLocation, isLoading, error } =
    useSunsetPosition(userLocation);

  useSetMarker(map, mapLoaded, userLocation);
  useFlyTo(map, mapLoaded, sunsetLocation);
  useSetMarker(map, mapLoaded, sunsetLocation);

  //subsolar point calculation
  const date = new Date(); // Today's date
  const { lat, lng, raHours, gmstHours } = subsolarPoint(date);

  console.log('raHours: ' + raHours);
  console.log('gmstHours: ' + gmstHours);

  const subsolarLocation = { lat, lng };
  console.log('Subsolar location: ' + subsolarLocation);
  console.log(subsolarLocation);
  useSetMarker(map, mapLoaded, subsolarLocation);

  splitTerminatorSunriseSunset(date, raHours, gmstHours);

  //   const {
  //     webcams,
  //     isLoading,
  //     error,
  //     selectedWebcam,
  //     selectWebcam,
  //     refresh,
  //   } = useWebcamFetch(sunsetLocation?.lat ?? 0, sunsetLocation?.lng ?? 0);

  //Ok, let's start be hooking up sunsetLocation to the WebcamFetch,
  // then we can fetch web cam's near where the nearest sunset west is...

  //--------------------------------------------

  //I need to bring in the WebCamFetch into here.

  // I might need to make something that finds Multiple Sunsets along the sunset band...

  //Put all these sunset location markers on the map...

  //Then I need to hook up sunsetLocation to the WebcamFetch

  //I need to destructure the WebCamFetch and take the webcam locations

  // I need to take those webcam locations and put locations for them on the map.
  // These should have tooltips or pop ups or something so that you can see an image of the sunset...

  // I need to find the closest location to the users location and then this needs to be some sort of pop up.

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
    <div className="max-w-4xl mx-auto">
      <div className="h-96 bg-white border border-gray-300 rounded overflow-hidden mb-8 relative">
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
      {/* Only show webcam display when we have a sunset location */}
      {sunsetLocation && (
        <WebcamFetchDisplay userLocation={sunsetLocation} />
      )}

      {/* Show message when no sunset location yet */}
      {!sunsetLocation && !isLoading && (
        <div className="p-4 bg-yellow-50 rounded-lg">
          <p className="text-yellow-700">
            Waiting for sunset location...
          </p>
        </div>
      )}
    </div>
  );
}
