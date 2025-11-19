'use client';

import { useState } from 'react';
import MainViewContainer from './components/MainViewContainer';
import { useLoadTerminatorWebcams } from '@/app/store/useLoadTerminatorWebcams';
import { useLoadAllWebcams } from '@/app/store/useLoadAllWebcams';

import { useMemo } from 'react';
import { useTerminatorStore } from '@/app/store/useTerminatorStore';
import { useAllWebcamsStore } from '@/app/store/useAllWebcamsStore';
import { WebcamConsole } from './components/WebcamConsole';
import { SnapshotConsole } from './components/SnapshotConsole';
import { Tabs, Tab, Drawer, Box, IconButton } from '@mui/material';
import {
  KeyboardArrowUp,
  KeyboardArrowDown,
} from '@mui/icons-material';
import { MapMosaicModeToggle } from '@/app/components/MapMosaicModeToggle';
import type { ViewMode } from './components/MainViewContainer';

export default function Home() {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [tabValue, setTabValue] = useState(0); // Add tab state
  const [mode, setMode] = useState<ViewMode>('globe');

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

  // Note: Snapshot archiving now handled by cron job at /api/cron/capture-snapshots
  // Snapshot loading is now handled by SnapshotConsole component using fetchMore()

  //Bring in terminator webcams from Zustand Store
  const sunriseWebcams = useTerminatorStore((t) => t.sunrise);
  const sunsetWebcams = useTerminatorStore((t) => t.sunset);
  const allWebcams = useAllWebcamsStore((t) => t.allWebcams);

  return (
    <main className="relative w-full">
      <div>
        {/* Main View Container - handles map, globe, and mosaic modes */}
        <MainViewContainer userLocation={userLocation} mode={mode} />

        {/* Mode Toggle */}
        <MapMosaicModeToggle
          mode={
            mode as
              | 'map'
              | 'globe'
              | 'sunrise-mosaic'
              | 'sunset-mosaic'
              | 'rating'
              | 'swipe'
              | 'gallery'
          }
          onModeChange={(newMode) => setMode(newMode as ViewMode)}
        />

        {/* Drawer Toggle Button - positioned over the map */}
        <IconButton
          onClick={() => setDrawerOpen(!drawerOpen)}
          sx={{
            position: 'absolute',
            bottom: 16,
            left: '50%',
            transform: 'translateX(-50%)',
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
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
              <Tab label="Snapshot Archive" />
              <Tab label="Curated" />
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
                // Snapshot Archive Tab
                <Box>
                  <SnapshotConsole
                    mode="archive"
                    title={'Snapshot Archive'}
                  />
                </Box>
              )}

              {tabValue === 3 && (
                // Curated Tab
                <Box>
                  <SnapshotConsole
                    mode="curated"
                    title={'Curated Snapshots'}
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
