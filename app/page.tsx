'use client';

import { useState } from 'react';
import SimpleMap from './components/Map/SimpleMap';
import { useLoadTerminatorWebcams } from '@/app/store/useLoadTerminatorWebcams';
import { useMemo } from 'react';
import { useTerminatorStore } from '@/app/store/useTerminatorStore';
import { WebcamConsole } from './components/WebcamConsole';
import { Drawer, Box, IconButton } from '@mui/material';
import {
  KeyboardArrowUp,
  KeyboardArrowDown,
} from '@mui/icons-material';

export default function Home() {
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Bellingham, Washington location need to put in user's location eventually
  const userLocation = useMemo(
    () => ({ lat: 48.7519, lng: -122.4787 }),
    []
  );

  // Fetches sunrise/sunset webcams from database and stores in Zustand
  // Automatically refreshes every 60 seconds using SWR
  // Splits webcams into sunrise[] and sunset[] arrays by phase
  useLoadTerminatorWebcams();

  //Bring in terminator webcams from Zustand Store
  const sunriseWebcams = useTerminatorStore((t) => t.sunrise);
  const sunsetWebcams = useTerminatorStore((t) => t.sunset);
  const allWebcams = useTerminatorStore((t) => t.allWebcams);

  return (
    <main className="relative w-full">
      <div>
        {/* First Section - Full Screen Map */}
        <SimpleMap userLocation={userLocation} />

        {/* Drawer Toggle Button - positioned over the map */}
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
                  title={'Current Sunsets'}
                />
              </Box>

              <Box sx={{ flex: 1, minWidth: 300 }}>
                <WebcamConsole
                  webcams={sunriseWebcams || []}
                  title={'Current Sunrises'}
                />
              </Box>
            </Box>
          </Box>
        </Drawer>
      </div>
    </main>
  );
}

//allWebcams
