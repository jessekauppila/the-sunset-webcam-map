'use client';

import { useState, useEffect } from 'react';
import {
  Drawer,
  IconButton,
  Box,
  // Typography,
  ToggleButton,
  ToggleButtonGroup,
} from '@mui/material';
import {
  KeyboardArrowUp,
  KeyboardArrowDown,
} from '@mui/icons-material';
import { useMap } from './hooks/useMap';
import { useFlyTo } from './hooks/useFlyTo';
import { useSetMarker } from './hooks/useSetMarker';
import { useSetWebcamMarkers } from './hooks/useSetWebcamMarkers';
import { WebcamConsole } from '../WebcamConsole';
// import { WebcamDisplay } from '../WebcamDisplay';
import { useUpdateTerminatorRing } from './hooks/useUpdateTerminatorRing';
import { useMapInteractionPause } from './hooks/useMapInteractionPause';
import 'mapbox-gl/dist/mapbox-gl.css';
import type { Location } from '../../lib/types';
//import { useWebcamFetchArray } from '../hooks/useWebCamFetchArray';
//import { useClosestWebcams } from './hooks/useClosestWebcams';
import { useCyclingWebcams } from './hooks/useCyclingWebcams';
// import { useCombineSunriseSunsetWebcams } from './hooks/useCombinedSunriseSunsetWebcams';
import GlobeMap from './GlobeMap';
//import type { WindyWebcam } from '../../lib/types';
import { useTerminatorStore } from '@/app/store/useTerminatorStore';

interface SimpleMapProps {
  userLocation: Location;
}

export default function SimpleMap({ userLocation }: SimpleMapProps) {
  const [mode, setMode] = useState<'map' | 'globe'>('map');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [currentTime, setCurrentTime] = useState(new Date());

  const { mapContainer, map, mapLoaded, mapReady } = useMap(
    userLocation,
    mode === 'map'
  );

  //this used to call the api, but now is just used for updating the terminator ring visuals...
  useEffect(() => {
    const id = setInterval(() => setCurrentTime(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  //this brings in the Zustand "state" store
  const allTerminatorWebcams = useTerminatorStore((t) => t.combined);
  const sunriseWebcams = useTerminatorStore((t) => t.sunrise);
  const sunsetWebcams = useTerminatorStore((t) => t.sunset);

  const {
    // sunsetCoords,
    // sunriseCoords,
    // allTerminatorCoords,
    sunrise,
    sunset,
  } = useUpdateTerminatorRing(map, mapLoaded, currentTime, {
    attachToMap: mode === 'map',
  });

  // const {
  //   combinedWebcams,
  //   sunriseWebcams,
  //   sunsetWebcams,
  //   // isLoading: webcamsLoading,
  // } = useCombineSunriseSunsetWebcams(sunriseCoords, sunsetCoords);

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

  // console.log(
  //   `🌅 Sunrise webcams: ${sunriseCount}, 🌅 Sunset webcams: ${sunsetCount}, 📹 Total: ${combinedWebcams.length}`
  // );

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

  return (
    <div>
      {/* First Section - Full Screen Map */}
      <section className="map-container w-full h-screen">
        <div className="w-full h-full">
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
              />
            </div>
          )}

          {/* Mode Toggle */}
          <Box
            sx={{
              position: 'absolute',
              top: 16,
              right: 16,
              zIndex: 3,
            }}
          >
            <ToggleButtonGroup
              value={mode}
              exclusive
              onChange={(_, newMode) => {
                if (newMode !== null) {
                  setMode(newMode);
                }
              }}
              size="small"
              sx={{
                backgroundColor: 'rgba(0, 0, 0, 0.7)',
                '& .MuiToggleButton-root': {
                  color: 'white',
                  borderColor: 'rgba(255, 255, 255, 0.3)',
                  padding: '4px 8px', // Add this to make buttons smaller
                  fontSize: '8px', // Add this to make text smaller
                  minWidth: 'auto', // Add this to remove minimum width
                  '&.Mui-selected': {
                    backgroundColor: 'rgba(255, 255, 255, 0.2)',
                    color: 'white',
                    '&:hover': {
                      backgroundColor: 'rgba(255, 255, 255, 0.3)',
                    },
                  },
                  '&:hover': {
                    backgroundColor: 'rgba(255, 255, 255, 0.1)',
                  },
                },
              }}
            >
              <ToggleButton value="map">Mapbox</ToggleButton>
              <ToggleButton value="globe">DeckGL</ToggleButton>
            </ToggleButtonGroup>
          </Box>

          {/* Drawer Toggle Button */}
          <IconButton
            onClick={() => setDrawerOpen(!drawerOpen)}
            sx={{
              position: 'absolute',
              bottom: 16,
              left: '50%',
              transform: 'translateX(-50%)',
              backgroundColor: 'rgba(0, 0, 0, 0.7)',
              color: 'white',
              zIndex: 3,
              '&:hover': {
                backgroundColor: 'rgba(0, 0, 0, 0.9)',
              },
            }}
          >
            {drawerOpen ? <KeyboardArrowDown /> : <KeyboardArrowUp />}
          </IconButton>

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

      {/* MUI Drawer */}
      <Drawer
        anchor="bottom"
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        PaperProps={{
          sx: {
            height: '60vh',
            borderTopLeftRadius: 16,
            borderTopRightRadius: 16,
            backgroundColor: '#1f2937', // gray-800
          },
        }}
      >
        <Box sx={{ p: 3, height: '100%', overflow: 'auto' }}>
          {/* Webcam Display */}
          <Box sx={{ mb: 4 }}>
            {/* <div className="canvas-container">
              {nextLatitudeNorthSunsetWebCam && (
                <WebcamDisplay
                  webcam={nextLatitudeNorthSunsetWebCam}
                />
              )}
            </div> */}
          </Box>

          {/* Webcam Consoles */}
          <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
            <Box sx={{ flex: 1, minWidth: 300 }}>
              <WebcamConsole
                webcams={sunsetWebcams || []}
                title={'Sunsets'}
              />
            </Box>

            <Box sx={{ flex: 1, minWidth: 300 }}>
              <WebcamConsole
                webcams={sunriseWebcams || []}
                title={'Sunrises'}
              />
            </Box>
          </Box>
        </Box>
      </Drawer>
    </div>
  );
}
