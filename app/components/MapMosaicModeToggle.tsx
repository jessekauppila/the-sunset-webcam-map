'use client';

import { Box, ToggleButton, ToggleButtonGroup } from '@mui/material';
import { useRouter } from 'next/navigation';
import type { ViewMode } from './MainViewContainer';
import { homeHrefFor } from './viewModeParam';

/** Studio is a route, not a homepage view, so it is not a ViewMode. */
export type ToggleTarget = ViewMode | 'studio';

interface MapMosaicModeToggleProps {
  /** Which entry reads as current. 'studio' when rendered inside /studio. */
  mode: ToggleTarget;
  /**
   * Switch a homepage view in place. Omitted on surfaces that are not the
   * homepage (/studio), where every homepage entry has to navigate instead.
   */
  onModeChange?: (mode: ViewMode) => void;
}

/**
 * The one navigation control, rendered on the homepage and in /studio so the
 * two are reachable from each other.
 *
 * The two mosaic entries are gone: a single-feed mosaic on a desktop browser
 * was never the thing being designed, and /studio shows both panels at true
 * kiosk geometry with the dials attached.
 *
 * Studio and My Cameras are both shown to everyone. Each gates itself on
 * arrival (OwnerGate), which puts the sign-in prompt where someone actually
 * asked for the thing rather than hiding the door.
 */
export function MapMosaicModeToggle({
  mode,
  onModeChange,
}: MapMosaicModeToggleProps) {
  const router = useRouter();
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
        onChange={(_, newTarget: ToggleTarget | null) => {
          if (newTarget === null || newTarget === mode) return;
          if (newTarget === 'studio') {
            router.push('/studio');
            return;
          }
          // On the homepage this is a state flip; from /studio there is no
          // state to flip, so the view rides along in the URL instead.
          if (onModeChange) onModeChange(newTarget);
          else router.push(homeHrefFor(newTarget));
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
            fontFamily: 'Roboto, Arial, sans-serif', // Explicitly set Roboto font
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
        <ToggleButton value="globe">Globe</ToggleButton>
        <ToggleButton value="studio">Studio</ToggleButton>
        <ToggleButton value="my-cameras">My Cameras</ToggleButton>
        {/*<ToggleButton value="rating">Rating</ToggleButton>
        <ToggleButton value="swipe">Swipe</ToggleButton>
        <ToggleButton value="gallery">Gallery</ToggleButton> */}
      </ToggleButtonGroup>
    </Box>
  );
}
