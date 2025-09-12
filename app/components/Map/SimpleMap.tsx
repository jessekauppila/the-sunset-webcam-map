'use client';

import { useState } from 'react';
import { useMap } from './hooks/useMap';
import { useFlyTo } from './hooks/useFlyTo';
import { useSetMarker } from './hooks/useSetMarker';
import { useSetWebcamMarkers } from './hooks/useSetWebcamMarkers';
import { WebcamConsole } from '../WebcamConsole';
import { WebcamDisplay } from '../WebcamDisplay';
import { useUpdateTerminatorRing } from './hooks/useUpdateTerminatorRing';
import 'mapbox-gl/dist/mapbox-gl.css';
import type { Location, WindyWebcam } from '../../lib/types';
import { useWebcamFetchArray } from '../hooks/useWebCamFetchArray';
import { useClosestWebcams } from './hooks/useClosestWebcams';
import { useCyclingWebcams } from './hooks/useCyclingWebcams';
import GlobeMap from './GlobeMap';

interface SimpleMapProps {
  userLocation: Location;
}

export default function SimpleMap({ userLocation }: SimpleMapProps) {
  const [mode, setMode] = useState<'map' | 'globe'>('map');
  const { mapContainer, map, mapLoaded } = useMap(
    userLocation,
    mode === 'map'
  );

  //this is used to get subsolar location as well as many more webcams...
  const { currentTime, sunsetCoords, sunrise, sunset } =
    useUpdateTerminatorRing(map, mapLoaded, {
      attachToMap: mode === 'map',
    });

  const { webcams: moreWebcams } = useWebcamFetchArray(sunsetCoords);

  //Create a new element that holds a canvas image of the webcam or a canvas video

  useClosestWebcams(userLocation, moreWebcams);

  const {
    currentWebcam: nextLatitudeNorthSunsetWebCam,
    currentWebcamLocation: nextLatitudeNorthSunsetLocation,
  } = useCyclingWebcams(moreWebcams, {
    getValue: (webcam: WindyWebcam) => webcam.location.latitude,
    direction: 'asc',
    intervalMs: 5000,
    wrap: true,
  });

  console.log(
    '📹 Next Latitude webcam: ',
    nextLatitudeNorthSunsetWebCam
  );

  useSetMarker(map, mapLoaded, mode === 'map' ? userLocation : null);
  useSetWebcamMarkers(
    map,
    mapLoaded,
    mode === 'map' ? moreWebcams : []
  );
  useFlyTo(
    map,
    mapLoaded,
    mode === 'map' ? nextLatitudeNorthSunsetLocation ?? null : null
  );
  return (
    <div className="max-w-4xl mx-auto">
      <div className="map-container">
        {mode === 'map' ? (
          <div
            ref={mapContainer}
            className="w-full h-full"
            style={{
              position: 'relative',
              zIndex: 1,
            }}
          />
        ) : (
          <div
            className="w-full h-full"
            style={{ position: 'relative', zIndex: 1 }}
          >
            <GlobeMap
              webcams={moreWebcams || []}
              sunrise={sunrise}
              sunset={sunset}
              currentTime={currentTime}
              initialViewState={{
                longitude: userLocation.lng,
                latitude: userLocation.lat,
                zoom: 0,
              }}
              targetLocation={
                nextLatitudeNorthSunsetLocation
                  ? {
                      longitude: nextLatitudeNorthSunsetLocation.lng,
                      latitude: nextLatitudeNorthSunsetLocation.lat,
                    }
                  : null
              }
            />
          </div>
        )}

        {/* Mode Toggle */}
        <div
          className="absolute top-2 right-2 flex gap-2"
          style={{ zIndex: 3 }}
        >
          <button
            onClick={() => setMode('map')}
            className={`mode-toggle-btn ${
              mode === 'map' ? 'active' : 'inactive'
            }`}
          >
            2D Map
          </button>
          <button
            onClick={() => setMode('globe')}
            className={`mode-toggle-btn ${
              mode === 'globe' ? 'active' : 'inactive'
            }`}
          >
            3D Globe
          </button>
        </div>
        {/* Data layers for top of  Main Map */}
        {/* Loading Overlay */}
        {mode === 'map' && !mapLoaded && (
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

      <div className="canvas-container">
        {nextLatitudeNorthSunsetWebCam && (
          <WebcamDisplay webcam={nextLatitudeNorthSunsetWebCam} />
        )}
      </div>

      <WebcamConsole webcams={moreWebcams || []} />
    </div>
  );
}
