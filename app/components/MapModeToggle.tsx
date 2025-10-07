'use client';

import { Box, ToggleButton, ToggleButtonGroup } from '@mui/material';

interface MapModeToggleProps {
  mode: 'map' | 'globe';
  onModeChange: (mode: 'map' | 'globe') => void;
}

export function MapModeToggle({
  mode,
  onModeChange,
}: MapModeToggleProps) {
  console.log('🔘 MapModeToggle render - current mode:', mode);

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
        onChange={(event, newMode) => {
          console.log(
            '🔘 Toggle clicked! Event:',
            event.type,
            'New mode:',
            newMode
          );
          if (newMode !== null) {
            console.log('🔘 Calling onModeChange with:', newMode);
            onModeChange(newMode);
          } else {
            console.log('🔘 newMode was null, ignoring');
          }
        }}
        size="small"
        sx={{
          backgroundColor: 'rgba(0, 0, 0, 0.7)',
          '& .MuiToggleButton-root': {
            color: 'white',
            borderColor: 'rgba(255, 255, 255, 0.3)',
            padding: '4px 8px',
            fontSize: '8px',
            minWidth: 'auto',
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
