'use client';

import { useState, useEffect, useRef } from 'react';
import {} from '@mui/icons-material';
import { useMap } from './hooks/useMap';
import { useFlyTo } from './hooks/useFlyTo';
import { useSetMarker } from './hooks/useSetMarker';
import { useSetWebcamMarkers } from './hooks/useSetWebcamMarkers';
import { useUpdateTerminatorRing } from './hooks/useUpdateTerminatorRing';
import { useMapInteractionPause } from './hooks/useMapInteractionPause';
import 'mapbox-gl/dist/mapbox-gl.css';
import type { Location } from '../../lib/types';
import { useCyclingWebcams } from './hooks/useCyclingWebcams';
import dynamic from 'next/dynamic';
const GlobeMap = dynamic(() => import('./GlobeMap'), {
  ssr: false, // Disable server-side rendering for Deck.gl
  loading: () => <div>Loading 3D Globe...</div>,
});

//import type { WindyWebcam } from '../../lib/types';
import { useTerminatorStore } from '@/app/store/useTerminatorStore';
import {
  TERMINATOR_PRECISION_DEG,
  SEARCH_RADIUS_DEG,
} from '@/app/lib/masterConfig';

interface SimpleMapProps {
  userLocation: Location;
  mode: 'map' | 'globe';
}

export default function SimpleMap({
  userLocation,
  mode,
}: SimpleMapProps) {
  const [currentTime, setCurrentTime] = useState(new Date());

  const { mapContainer, map, mapLoaded, mapReady } = useMap(
    userLocation,
    mode === 'map'
  );

  // Create a shared container ref for interaction detection
  const interactionContainerRef = useRef<HTMLDivElement>(null);

  //this used to call the api, but now is just used for updating the terminator ring visuals...
  useEffect(() => {
    const id = setInterval(() => setCurrentTime(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  //this brings in the Zustand "state" store
  const allTerminatorWebcams = useTerminatorStore((t) => t.combined);

  const { sunrise, sunset } = useUpdateTerminatorRing(
    map,
    mapLoaded,
    currentTime,
    {
      attachToMap: mode === 'map',
      showSearchRadius: true, // Enable search radius visualization
      precisionDeg: TERMINATOR_PRECISION_DEG, // Match cron job precision
      searchRadiusDegrees: SEARCH_RADIUS_DEG, // Match cron job search radius
    }
  );

  const {
    currentWebcam: nextLatitudeNorthSunsetWebCam,
    currentWebcamLocation: nextLatitudeNorthSunsetLocation,
    next: goToNextWebcam,
    resume: resumeWebcamCycling,
    pause: pauseWebcamCycling,
  } = useCyclingWebcams(allTerminatorWebcams, {
    startIndex: 0,
    intervalMs: 3000,
    autoStart: true,
  });

  // Track if user has interacted with the map (works for both mapbox and globe)
  const { isPaused, reset: resetInteractionPause } =
    useMapInteractionPause({
      containerRef: interactionContainerRef,
      mode, // Pass mode so pause state resets on mode change
    });

  console.log(
    `🎮 Auto-fly ${
      isPaused ? 'paused' : 'running'
    } due to user interaction`
  );

  console.log(
    `🎮 Cycling webcams ${
      isPaused ? 'paused' : 'running'
    } due to map interaction`
  );

  console.log(
    '📹 Next Latitude webcam: ',
    nextLatitudeNorthSunsetWebCam
  );

  useSetMarker(map, mapReady, mode === 'map' ? userLocation : null);

  useSetWebcamMarkers(
    map,
    mapLoaded,
    mode === 'map' ? allTerminatorWebcams : [],
    mode === 'map'
      ? {
          activeWebcamId:
            nextLatitudeNorthSunsetWebCam?.webcamId ?? null,
          onAdvance: () => {
            resetInteractionPause();
            resumeWebcamCycling();
            goToNextWebcam();
          },
          onPopupStateChange: (isOpen: boolean) => {
            if (isOpen) {
              pauseWebcamCycling();
            } else {
              resumeWebcamCycling();
            }
          },
        }
      : undefined
  );

  useFlyTo(
    map,
    mapLoaded,
    mode === 'map' ? nextLatitudeNorthSunsetLocation ?? null : null,
    isPaused,
    mode // Pass mode so it can detect mode changes
  );

  return (
    <div>
      {/* First Section - Full Screen Map */}
      <section className="map-container w-full h-screen">
        <div ref={interactionContainerRef} className="w-full h-full">
          {' '}
          {/* Add ref here */}
          {mode === 'map' ? (
            <div
              ref={mapContainer}
              className="w-full h-full"
              style={{
                position: 'relative',
                zIndex: 1,
                // Make map semi-transparent to see terminator visualization better
                // Remove this style to restore full opacity
                opacity: 1, // 30% opacity - adjust as needed (0.0 = invisible, 1.0 = fully opaque)
              }}
            />
          ) : (
            <div
              className="w-full h-full"
              style={{ position: 'relative', zIndex: 1 }}
            >
              <GlobeMap
                webcams={allTerminatorWebcams || []}
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
                        longitude:
                          nextLatitudeNorthSunsetLocation.lng,
                        latitude: nextLatitudeNorthSunsetLocation.lat,
                      }
                    : null
                }
                isPaused={isPaused}
                mode={mode}
              />
            </div>
          )}
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
      </section>
    </div>
  );
}
