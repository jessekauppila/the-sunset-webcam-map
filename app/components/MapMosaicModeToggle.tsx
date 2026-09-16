'use client';

import { ToggleButton, ToggleButtonGroup } from '@mui/material';
import { useRouter } from 'next/navigation';
import type { ViewMode } from './MainViewContainer';
import { homeHrefFor } from './viewModeParam';

/**
 * Routes, not homepage views, so they are not ViewModes.
 *
 * `mirror` in particular is NOT the `gallery` ViewMode, which is a different
 * and unrelated string already spoken for in MainViewContainer. The piece is
 * a page of its own, outside the homepage's chrome entirely, because a
 * navigation band over it would be the one thing in the window that is not
 * the work.
 */
const ROUTE_TARGETS = { studio: '/studio', mirror: '/mirror' } as const;

type RouteTarget = keyof typeof ROUTE_TARGETS;

export type ToggleTarget = ViewMode | RouteTarget;

/**
 * A guard rather than a bare lookup, so the branch below still narrows the
 * remainder to a ViewMode — which is what `onModeChange` takes. Indexing the
 * table proves nothing to the compiler and lost that narrowing.
 */
const isRouteTarget = (target: ToggleTarget): target is RouteTarget =>
  Object.hasOwn(ROUTE_TARGETS, target);

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
 *
 * Renders inline: the caller decides where it lives in the page chrome. It
 * used to float absolutely in the top-right corner, which put it over
 * whatever the page drew there — the studio's tile-detail card opened under
 * it, and a map popup near the top edge could never rise above it because
 * the popup lives inside the map's own stacking context.
 */
export function MapMosaicModeToggle({
  mode,
  onModeChange,
}: MapMosaicModeToggleProps) {
  const router = useRouter();
  return (
    <ToggleButtonGroup
      value={mode}
      exclusive
      onChange={(_, newTarget: ToggleTarget | null) => {
        if (newTarget === null || newTarget === mode) return;
        if (isRouteTarget(newTarget)) {
          router.push(ROUTE_TARGETS[newTarget]);
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
      {/* The piece: both gallery screens, live. Public, like the globe. */}
      <ToggleButton value="mirror">Mirror</ToggleButton>
      <ToggleButton value="studio">Studio</ToggleButton>
      <ToggleButton value="my-cameras">My Cameras</ToggleButton>
      {/*<ToggleButton value="rating">Rating</ToggleButton>
      <ToggleButton value="swipe">Swipe</ToggleButton>
      <ToggleButton value="gallery">Gallery</ToggleButton> */}
    </ToggleButtonGroup>
  );
}
