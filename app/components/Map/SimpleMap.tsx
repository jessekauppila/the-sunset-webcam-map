//subsolar point and termination ring calculation...

//This whole thing needs to be put into a useEffect that runs every minute

//That will pull the subpolar point and get the ra and gmsthours info

//That will come bck into the terminatorRing function and return data points

//Those same points will be used to either create markers or something else
//that can be used by a deck GL heatmap.

//Those same data points can be used by WebCamFetch to search for webcams

//Need to set up custom Markers that will take the WebCamFetch webcams
//these need to show little thumbnail images

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

'use client';

//import DeckGL from '@deck.gl/react';
//import { useEffect, useState, useCallback } from 'react';
import { useMap } from './hooks/useMap';
import { useFlyTo } from './hooks/useFlyTo';
import { useSunsetPosition } from './hooks/useSunsetPosition';
import { useSetMarker } from './hooks/useSetMarker';
import { useSetWebcamMarkers } from './hooks/useSetWebcamMarkers';
import WebcamFetchDisplay from '../WebcamFetchDisplay';
import WebcamDisplay from '../WebcamDisplay';
import { useUpdateTimeAndTerminatorRing } from './hooks/useUpdateTimeAndTerminatorRing';
import 'mapbox-gl/dist/mapbox-gl.css';
import type { Location } from '../../lib/types';
import { useWebcamFetch } from '../hooks/useWebCamFetch';
import { useWebcamFetchArray } from '../hooks/useWebCamFetchArray';

interface SimpleMapProps {
  userLocation: Location;
}

export default function SimpleMap({ userLocation }: SimpleMapProps) {
  const { mapContainer, map, mapLoaded, hasToken } =
    useMap(userLocation);

  //this is used as a point to get ONE location to then search for webcams at...
  //this might not be correct now...
  const { sunsetLocation, isLoading, error } =
    useSunsetPosition(userLocation);

  //this needs to change to accept an array of locations
  const { webcams } = useWebcamFetch(
    sunsetLocation?.lat ?? 0,
    sunsetLocation?.lng ?? 0
  );

  //this is used to get subsolar location as well as many more webcams...
  const {
    subsolarLocation,
    sunriseCoords,
    sunsetCoords,
    sunrise,
    sunset,
    terminatorRingLineLayer,
  } = useUpdateTimeAndTerminatorRing(map, mapLoaded);

  const {
    webcams: moreWebcams,
    totalCount: totalCountSunsetWebcams,
  } = useWebcamFetchArray(sunsetCoords);

  useSetMarker(map, mapLoaded, userLocation);
  useSetMarker(map, mapLoaded, sunsetLocation);
  useSetMarker(map, mapLoaded, subsolarLocation);
  useSetWebcamMarkers(map, mapLoaded, webcams);

  useSetWebcamMarkers(map, mapLoaded, moreWebcams);

  useFlyTo(map, mapLoaded, sunsetLocation);

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
        {/* ORIIGINGAL Main Map */}
        <div
          ref={mapContainer}
          className="w-full h-full"
          style={{
            position: 'relative',
            zIndex: 1,
          }}
        />
        {/* Data layers for top of  Main Map */}
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
      {/* {sunsetLocation && (
        <WebcamFetchDisplay userLocation={sunsetLocation} />
      )} */}

      <WebcamDisplay webcams={moreWebcams || []} />

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
