'use client';

import { Box, ToggleButton, ToggleButtonGroup } from '@mui/material';

interface MapMosaicModeToggleProps {
  mode: 'map' | 'globe';
  onModeChange: (mode: 'map' | 'globe') => void;
}

export function MapMosaicModeToggle({
  mode,
  onModeChange,
}: MapMosaicModeToggleProps) {
  return (
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
            onModeChange(newMode);
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
  );
}
