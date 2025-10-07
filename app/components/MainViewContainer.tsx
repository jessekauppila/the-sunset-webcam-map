'use client';

import { useMemo } from 'react';
import SimpleMap from './Map/SimpleMap';
import { MosaicCanvas } from './WebcamsMosaicCanvas';
import { useTerminatorStore } from '@/app/store/useTerminatorStore';
import type { Location } from '../lib/types';

export type ViewMode = 'map' | 'globe' | 'mosaic';

interface MainViewContainerProps {
  userLocation: Location;
  mode: ViewMode;
}

export default function MainViewContainer({
  userLocation,
  mode,
}: MainViewContainerProps) {
  // Get webcam data from Zustand store
  const sunriseWebcams = useTerminatorStore((t) => t.sunrise);
  const sunsetWebcams = useTerminatorStore((t) => t.sunset);

  // Render different views based on mode
  switch (mode) {
    case 'map':
    case 'globe':
      return <SimpleMap userLocation={userLocation} mode={mode} />;

    case 'mosaic':
      return (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'auto auto', // left | right
            minHeight: '100vh',
          }}
        >
          <MosaicCanvas
            webcams={sunsetWebcams || []}
            width={window.innerWidth / 2}
            height={window.innerHeight}
            rows={12}
            maxImages={90}
            padding={2}
            ratingSizeEffect={0.75}
            viewSizeEffect={0.1}
            baseHeight={80}
            onSelect={(webcam) => {
              console.log(
                'Selected webcam:',
                webcam.webcamId,
                webcam.title
              );
            }}
          />
          <MosaicCanvas
            webcams={sunriseWebcams || []}
            width={window.innerWidth / 2}
            height={window.innerHeight}
            rows={12}
            maxImages={90}
            padding={2}
            ratingSizeEffect={0.75}
            viewSizeEffect={0.1}
            baseHeight={80}
            onSelect={(webcam) => {
              console.log(
                'Selected webcam:',
                webcam.webcamId,
                webcam.title
              );
            }}
          />
        </div>
      );

    default:
      return (
        <div className="w-full h-screen flex items-center justify-center">
          <p>Unknown view mode: {mode}</p>
        </div>
      );
  }
}
