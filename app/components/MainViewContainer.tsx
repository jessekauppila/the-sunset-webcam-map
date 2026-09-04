'use client';

import SimpleMap from './Map/SimpleMap';
import { RatingPanel } from './Rating/RatingPanel';
import { OwnerGate } from './auth/OwnerGate';
import { SwipeSnapshotGallery } from './SwipeSnapshotGallery';
import { MyCamerasView } from './MyCameras/MyCamerasView';
import type { Location } from '../lib/types';

/**
 * The single-feed `sunrise-mosaic` / `sunset-mosaic` views are gone. /studio
 * renders both panels at true kiosk geometry with the dials attached, which
 * is the surface the composition is actually designed on; a full-window
 * single feed in a desktop browser was a second rendering path to maintain
 * for no question it answered better. Recover them from git history if a
 * per-feed browser view earns its keep later.
 */
export type ViewMode =
  | 'map'
  | 'globe'
  | 'rating'
  | 'swipe'
  | 'gallery'
  | 'my-cameras';

interface MainViewContainerProps {
  userLocation: Location;
  mode: ViewMode;
}

export default function MainViewContainer({
  userLocation,
  mode,
}: MainViewContainerProps) {
  // Render different views based on mode
  switch (mode) {
    case 'map':
    case 'globe':
      return <SimpleMap userLocation={userLocation} mode={mode} />;

    case 'my-cameras':
      return (
        <OwnerGate label="My Cameras">
          <MyCamerasView userLocation={userLocation} />
        </OwnerGate>
      );

    case 'rating':
      return (
        <section className="map-container w-full h-full">
          <div className="flex flex-col h-full">
            <div className="flex-1" style={{ position: 'relative' }}>
              <RatingPanel variant="fullscreen" />
            </div>
          </div>
        </section>
      );

    case 'swipe':
      return <SwipeSnapshotGallery />;

    case 'gallery':
      // TODO: Implement SnapshotGallery component
      return (
        <div className="w-full h-full flex items-center justify-center bg-black">
          <p className="text-white">Gallery view coming soon...</p>
        </div>
      );

    default:
      return (
        <div className="w-full h-full flex items-center justify-center">
          <p>Unknown view mode: {mode}</p>
        </div>
      );
  }
}
