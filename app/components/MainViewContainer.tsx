'use client';

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

  const canvasImageRows = 12;
  const canvasMaxImages = 90;
  const canvasPadding = 2;

  // Render different views based on mode
  switch (mode) {
    case 'map':
    case 'globe':
      return <SimpleMap userLocation={userLocation} mode={mode} />;

    case 'mosaic':
      return (
        <section className="map-container w-full h-screen">
          <div className="grid grid-cols-2">
            <div>
              <h1 className="text-center text-gray-600 text-xl font-serif">
                Sunset
              </h1>
              <MosaicCanvas
                webcams={sunsetWebcams || []}
                width={window.innerWidth / 2}
                height={window.innerHeight}
                //rows={canvasImageRows}
                maxImages={canvasMaxImages}
                padding={canvasPadding}
                ratingSizeEffect={0.75}
                viewSizeEffect={0.1}
                baseHeight={150}
                onSelect={(webcam) => {
                  console.log(
                    'Selected webcam:',
                    webcam.webcamId,
                    webcam.title
                  );
                }}
              />
            </div>

            <div>
              <h1 className="text-center text-gray-600 text-xl font-serif">
                Sunrise
              </h1>
              <MosaicCanvas
                webcams={sunriseWebcams || []}
                width={window.innerWidth / 2}
                height={window.innerHeight}
                //rows={canvasImageRows}
                maxImages={canvasMaxImages}
                padding={canvasPadding}
                ratingSizeEffect={0.75}
                viewSizeEffect={0.1}
                baseHeight={150}
                onSelect={(webcam) => {
                  console.log(
                    'Selected webcam:',
                    webcam.webcamId,
                    webcam.title
                  );
                }}
              />
            </div>
          </div>
        </section>
      );

    default:
      return (
        <div className="w-full h-screen flex items-center justify-center">
          <p>Unknown view mode: {mode}</p>
        </div>
      );
  }
}
