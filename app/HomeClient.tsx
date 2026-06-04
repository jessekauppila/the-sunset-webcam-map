'use client';

import { useState, useEffect } from 'react';
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
import type { ManifestEntry } from '@/app/lib/modelRuns.types';
import { ModelAnalysisTab } from './components/ModelAnalysis/ModelAnalysisTab';
import { AuthControl } from './components/auth/AuthControl';
import { useIsOperator } from './components/auth/useIsOperator';
import { LeaderboardTab } from './components/Leaderboard/LeaderboardTab';

interface Props {
  manifestRuns: ManifestEntry[];
}

export function HomeClient({ manifestRuns }: Props) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [tabKey, setTabKey] = useState<string>('current');
  const [mode, setMode] = useState<ViewMode>('globe');

  const { isOperator } = useIsOperator();

  // Stable-keyed tabs so hiding operator-only tabs for the public doesn't shift
  // indices. Operator-only tabs (labeling + management) are removed entirely for
  // the public, not disabled. The server (requireOwner) is the real gate; this
  // is presentation.
  const ALL_TABS = [
    { key: 'current', label: 'Current Sunrises/Sunsets', operatorOnly: false },
    { key: 'best', label: '🌅 Best Sunsets', operatorOnly: false },
    { key: 'hard', label: '⚠ Hard Examples', operatorOnly: true },
    { key: 'archive', label: 'Snapshot Archive', operatorOnly: false },
    { key: 'curated', label: 'Curated', operatorOnly: false },
    { key: 'unrated', label: 'Unrated Queue', operatorOnly: true },
    { key: 'all', label: 'All Webcams', operatorOnly: true },
    { key: 'models', label: 'Model Analysis', operatorOnly: false },
  ] as const;
  const visibleTabs = ALL_TABS.filter((t) => isOperator || !t.operatorOnly);

  // If the active tab becomes hidden (e.g. operator signs out while on the
  // Unrated Queue), fall back to the first public tab.
  useEffect(() => {
    if (!visibleTabs.some((t) => t.key === tabKey)) {
      setTabKey('current');
    }
  }, [visibleTabs, tabKey]);

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
              value={tabKey}
              onChange={(_, newValue) => setTabKey(newValue)}
              variant="scrollable"
              scrollButtons="auto"
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
              {visibleTabs.map((t) => (
                <Tab key={t.key} value={t.key} label={t.label} />
              ))}
            </Tabs>

            {/* Tab Content */}
            <Box sx={{ flex: 1, overflow: 'auto', p: 3 }}>
              {tabKey === 'current' && (
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

              {tabKey === 'best' && (
                // Best Sunsets leaderboard (public)
                <Box>
                  <LeaderboardTab />
                </Box>
              )}

              {tabKey === 'hard' && (
                // Hard Examples — model-disagreement queue
                <Box>
                  <SnapshotConsole
                    mode="hard-examples"
                    title={'⚠ Hard Examples — confirm or correct the model'}
                    hotkeysEnabled={drawerOpen}
                  />
                </Box>
              )}

              {tabKey === 'archive' && (
                // Snapshot Archive Tab
                <Box>
                  <SnapshotConsole
                    mode="archive"
                    title={'Snapshot Archive'}
                  />
                </Box>
              )}

              {tabKey === 'curated' && (
                // Curated Tab
                <Box>
                  <SnapshotConsole
                    mode="curated"
                    title={'Curated Snapshots'}
                  />
                </Box>
              )}

              {tabKey === 'unrated' && (
                // Unrated Queue Tab
                <Box>
                  <SnapshotConsole
                    mode="unrated"
                    title={'Unrated Queue'}
                    hotkeysEnabled={drawerOpen}
                  />
                </Box>
              )}

              {tabKey === 'all' && (
                // All Webcams Tab
                <Box>
                  <WebcamConsole
                    webcams={allWebcams || []}
                    title={'All Webcams'}
                  />
                </Box>
              )}

              {tabKey === 'models' && (
                <Box sx={{ height: '100%' }}>
                  <ModelAnalysisTab runs={manifestRuns} />
                </Box>
              )}
            </Box>

            {/* Auth affordance — pinned at the drawer bottom, always visible */}
            <Box
              sx={{
                borderTop: 1,
                borderColor: 'divider',
                backgroundColor: '#374151', // gray-700
                px: 2,
                py: 1,
                display: 'flex',
                justifyContent: 'flex-end',
                alignItems: 'center',
              }}
            >
              <AuthControl />
            </Box>
          </Box>
        </Drawer>
      </div>
    </main>
  );
}
