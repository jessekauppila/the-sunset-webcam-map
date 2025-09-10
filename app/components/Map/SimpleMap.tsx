'use client';

//import DeckGL from '@deck.gl/react';
//import { useEffect, useState, useCallback } from 'react';
import { useMap } from './hooks/useMap';
import { useFlyTo } from './hooks/useFlyTo';
import { useSunsetPosition } from './hooks/useSunsetPosition';
import { useSetMarker } from './hooks/useSetMarker';
import { useSetWebcamMarkers } from './hooks/useSetWebcamMarkers';
//import WebcamFetchDisplay from '../WebcamFetchDisplay';
import { WebcamConsole } from '../WebcamConsole';
import { WebcamDisplay } from '../WebcamDisplay';

import { useUpdateTimeAndTerminatorRing } from './hooks/useUpdateTimeAndTerminatorRing';
import 'mapbox-gl/dist/mapbox-gl.css';
import type { Location } from '../../lib/types';
//import { useWebcamFetch } from '../hooks/useWebCamFetch';
import { useWebcamFetchArray } from '../hooks/useWebCamFetchArray';
import { useClosestWebcams } from './hooks/useClosestWebcams';

interface SimpleMapProps {
  userLocation: Location;
}

export default function SimpleMap({ userLocation }: SimpleMapProps) {
  const { mapContainer, map, mapLoaded, hasToken } =
    useMap(userLocation);

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

  //Create a new element that holds a canvas image of the webcam or a canvas video

  const { closestWebcam, webcamsWithDistance, closestLocation } =
    useClosestWebcams(userLocation, moreWebcams);

  console.log('📹 Closet webcam: ', closestWebcam);
  console.log('📍 Closet webcam location: ', webcamsWithDistance);
  console.log('Closet webcam with distance: ', closestLocation);

  useSetMarker(map, mapLoaded, userLocation);
  //useSetWebcamMarkers(map, mapLoaded, webcams);

  useSetWebcamMarkers(map, mapLoaded, moreWebcams);

  useFlyTo(map, mapLoaded, closestLocation ?? null);

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
      <div className="map-container">
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
        {/* User Location Overlay */}
        {userLocation && (
          <div
            className="absolute top-2 left-2 bg-gray-300 border border-gray-800 rounded p-2"
            style={{ zIndex: 3 }}
          >
            <p className="text-sm text-green-700">
              User: {userLocation.lat.toFixed(2)},{' '}
              {userLocation.lng.toFixed(2)}
            </p>
          </div>
        )}
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
      </div>

      <div className="map-container">
        {closestWebcam && <WebcamDisplay webcam={closestWebcam} />}
      </div>

      <WebcamConsole webcams={moreWebcams || []} />
    </div>
  );
}
