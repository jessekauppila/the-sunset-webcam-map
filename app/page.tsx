'use client';

import { useState } from 'react';
import SimpleMap from './components/Map/SimpleMap';
import { useLoadTerminatorWebcams } from '@/app/store/useLoadTerminatorWebcams';
import { useLoadAllWebcams } from '@/app/store/useLoadAllWebcams';

import { useMemo } from 'react';
import { useTerminatorStore } from '@/app/store/useTerminatorStore';
import { useAllWebcamsStore } from '@/app/store/useAllWebcamsStore';
import { WebcamConsole } from './components/WebcamConsole';
import {
  Tabs,
  Tab,
  Drawer,
  Box,
  IconButton,
  ToggleButton,
  ToggleButtonGroup,
} from '@mui/material';
import {
  KeyboardArrowUp,
  KeyboardArrowDown,
} from '@mui/icons-material';
import { MosaicCanvas } from '@/app/components/WebcamsMosaicCanvas';

export default function Home() {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [tabValue, setTabValue] = useState(0); // Add tab state
  const [mode, setMode] = useState<'map' | 'globe'>('map');

  // Bellingham, Washington location need to put in user's location eventually
  const userLocation = useMemo(
    () => ({ lat: 48.7519, lng: -122.4787 }),
    []
  );

  // Fetches sunrise/sunset webcams from database and stores in Zustand
  // Automatically refreshes every 60 seconds using SWR
  // Splits webcams into sunrise[] and sunset[] arrays by phase
  useLoadTerminatorWebcams();
  useLoadAllWebcams();

  //Bring in terminator webcams from Zustand Store
  const sunriseWebcams = useTerminatorStore((t) => t.sunrise);
  const sunsetWebcams = useTerminatorStore((t) => t.sunset);
  const allWebcams = useAllWebcamsStore((t) => t.allWebcams);

  return (
    <main className="relative w-full">
      <div>
        {/* First Section - Full Screen Map */}
        <SimpleMap userLocation={userLocation} mode={mode} />

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
          <Box
            sx={{
              height: '100%',
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            {/* Tabs Header */}
            <Tabs
              value={tabValue}
              onChange={(_, newValue) => setTabValue(newValue)}
              sx={{
                borderBottom: 1,
                borderColor: 'divider',
                backgroundColor: '#374151', // gray-700
                '& .MuiTab-root': {
                  color: 'white',
                  '&.Mui-selected': {
                    color: '#60a5fa', // blue-400
                  },
                },
                '& .MuiTabs-indicator': {
                  backgroundColor: '#60a5fa', // blue-400
                },
              }}
            >
              <Tab label="Current Terminator" />
              <Tab label="All Webcams" />
              <Tab label="Sunrise Mosaic Display" />
              <Tab label="Sunset Mosaic Display" />
            </Tabs>

            {/* Tab Content */}
            <Box sx={{ flex: 1, overflow: 'auto', p: 3 }}>
              {tabValue === 0 && (
                // Current Terminator Tab
                <Box
                  sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}
                >
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
              )}

              {tabValue === 1 && (
                // All Webcams Tab
                <Box>
                  <WebcamConsole
                    webcams={allWebcams || []}
                    title={'All Webcams'}
                  />
                </Box>
              )}

              {tabValue === 2 && (
                <Box sx={{ p: 2 }}>
                  {/* choose which set to render */}
                  <MosaicCanvas
                    webcams={sunriseWebcams} // or sunsetWebcams
                    width={1200}
                    height={800}
                    rows={12}
                    maxImages={180}
                    padding={2}
                    ratingSizeEffect={0.65}
                    viewSizeEffect={0.2}
                    baseHeight={80}
                    onSelect={(w) => {
                      // show detail, focus the map, open drawer, etc.
                      console.log('clicked', w.webcamId, w.title);
                    }}
                  />
                </Box>
              )}

              {tabValue === 3 && (
                <Box sx={{ p: 2 }}>
                  {/* choose which set to render */}
                  <MosaicCanvas
                    webcams={sunsetWebcams} // or sunsetWebcams
                    width={1200}
                    height={800}
                    rows={12}
                    maxImages={180}
                    padding={2}
                    ratingSizeEffect={0.75}
                    viewSizeEffect={0.1}
                    baseHeight={80}
                    onSelect={(w) => {
                      // show detail, focus the map, open drawer, etc.
                      console.log('clicked', w.webcamId, w.title);
                    }}
                  />
                </Box>
              )}
            </Box>
          </Box>
        </Drawer>
      </div>
    </main>
  );
}

//allWebcams

{
  /*
<Box sx={{ p: 3, height: '100%', overflow: 'auto' }}>
            {/* Webcam Display 
            <Box sx={{ mb: 4 }}>
              {/* <div className="canvas-container">
              {nextLatitudeNorthSunsetWebCam && (
                <WebcamDisplay
                  webcam={nextLatitudeNorthSunsetWebCam}
                />
              )}
            </div> 
            </Box>
            */
}
