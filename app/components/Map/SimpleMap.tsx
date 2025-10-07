'use client';

import { useState, useEffect } from 'react';
import {
  Box,
  // Typography,
  // ToggleButton,
  // ToggleButtonGroup,
} from '@mui/material';
import {} from '@mui/icons-material';
import { useMap } from './hooks/useMap';
import { useFlyTo } from './hooks/useFlyTo';
import { useSetMarker } from './hooks/useSetMarker';
import { useSetWebcamMarkers } from './hooks/useSetWebcamMarkers';
// import { WebcamDisplay } from '../WebcamDisplay';
import { useUpdateTerminatorRing } from './hooks/useUpdateTerminatorRing';
import { useMapInteractionPause } from './hooks/useMapInteractionPause';
import 'mapbox-gl/dist/mapbox-gl.css';
import type { Location } from '../../lib/types';
//import { useWebcamFetchArray } from '../hooks/useWebCamFetchArray';
//import { useClosestWebcams } from './hooks/useClosestWebcams';
import { useCyclingWebcams } from './hooks/useCyclingWebcams';
// import { useCombineSunriseSunsetWebcams } from './hooks/useCombinedSunriseSunsetWebcams';
import dynamic from 'next/dynamic';

const GlobeMap = dynamic(() => import('./GlobeMap'), {
  ssr: false, // Disable server-side rendering for Deck.gl
  loading: () => <div>Loading 3D Globe...</div>,
});

//import type { WindyWebcam } from '../../lib/types';
import { useTerminatorStore } from '@/app/store/useTerminatorStore';

interface SimpleMapProps {
  userLocation: Location;
  mode: 'map' | 'globe';
}

export default function SimpleMap({
  userLocation,
  mode,
}: SimpleMapProps) {
  // Remove local mode state - now comes from props
  console.log('SimpleMap: Received mode prop:', mode);

  const [currentTime, setCurrentTime] = useState(new Date());

  const { mapContainer, map, mapLoaded, mapReady } = useMap(
    userLocation,
    mode === 'map' // Only initialize map when mode is 'map'
  );

  //this used to call the api, but now is just used for updating the terminator ring visuals...
  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  //this brings in the Zustand "state" store
  const allTerminatorWebcams = useTerminatorStore((t) => t.combined);

  const { sunrise, sunset } = useUpdateTerminatorRing(
    map,
    mapLoaded,
    currentTime,
    {
      attachToMap: mode === 'map',
    }
  );

  const {
    currentWebcam: nextLatitudeNorthSunsetWebCam,
    currentWebcamLocation: nextLatitudeNorthSunsetLocation,
    pause,
    resume,
  } = useCyclingWebcams(allTerminatorWebcams, {
    startIndex: 0, // index
    intervalMs: 3000,
    autoStart: true,
  });

  // Add map interaction pause functionality
  // this isn't working as expected...
  const { isPaused } = useMapInteractionPause({
    map,
    mapReady: mapReady && mode === 'map',
    onPause: pause,
    onResume: resume,
    pauseDelayMs: 0, // Immediate pause when interaction starts
    resumeDelayMs: 10000, // Resume after 15 seconds
  });

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
    mode === 'map' ? allTerminatorWebcams : []
  );

  useFlyTo(
    map,
    mapLoaded,
    mode === 'map' ? nextLatitudeNorthSunsetLocation ?? null : null
  );

  // Bring in terminator webcams from Zustand Store
  const sunriseWebcams = useTerminatorStore((t) => t.sunrise);
  const sunsetWebcams = useTerminatorStore((t) => t.sunset);

  return (
    <div className="relative w-full h-screen">
      <section className="relative w-full h-full">
        <div className="relative w-full h-full">
          {mode === 'map' ? (
            <div
              ref={mapContainer}
              className="w-full h-full"
              style={{ minHeight: '100vh' }}
            />
          ) : (
            <div className="w-full h-full">
              <GlobeMap
                webcams={[...sunsetWebcams, ...sunriseWebcams]}
                currentTime={currentTime}
                targetLocation={userLocation}
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
