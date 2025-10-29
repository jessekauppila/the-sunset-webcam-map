'use client';

import { useRef, useState, useEffect } from 'react';
import SimpleMap from './Map/SimpleMap';
import { MosaicCanvas } from './MosaicCanvas';
import { useTerminatorStore } from '@/app/store/useTerminatorStore';
import { SwipeSnapshotGallery } from './SwipeSnapshotGallery';
import type { Location } from '../lib/types';

export type ViewMode =
  | 'map'
  | 'globe'
  | 'mosaic'
  | 'mosaic2'
  | 'swipe'
  | 'gallery';

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

  // Refs for measuring actual available space
  const sunsetContainerRef = useRef<HTMLDivElement>(null);
  const sunriseContainerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({
    width:
      typeof window !== 'undefined' ? window.innerWidth / 2 : 900,
    height: typeof window !== 'undefined' ? window.innerHeight : 800,
  });

  // Measure actual available space in containers
  useEffect(() => {
    const updateDimensions = () => {
      if (sunsetContainerRef.current) {
        const rect =
          sunsetContainerRef.current.getBoundingClientRect();
        setDimensions({
          width: rect.width,
          height: rect.height,
        });
      }
    };

    updateDimensions();
    window.addEventListener('resize', updateDimensions);
    return () =>
      window.removeEventListener('resize', updateDimensions);
  }, []);

  //const canvasImageRows = 12;
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
          <div className="grid grid-cols-2 h-full">
            <div className="flex flex-col h-full">
              <h1
                className="text-center text-gray-500 text-xl py-2"
                style={{ fontFamily: 'Roboto, Arial, sans-serif' }}
              >
                Sunsets
              </h1>
              <div ref={sunsetContainerRef} className="flex-1">
                {dimensions.height > 0 && (
                  <MosaicCanvas
                    webcams={sunsetWebcams || []}
                    width={dimensions.width}
                    height={dimensions.height}
                    maxImages={canvasMaxImages}
                    padding={canvasPadding}
                    ratingSizeEffect={0.75}
                    viewSizeEffect={0.1}
                    fillScreenHeight={true}
                    onSelect={(webcam) => {
                      console.log(
                        'Selected webcam:',
                        webcam.webcamId,
                        webcam.title
                      );
                    }}
                  />
                )}
              </div>
            </div>

            <div className="flex flex-col h-full">
              <h1
                className="text-center text-gray-500 text-xl py-2"
                style={{ fontFamily: 'Roboto, Arial, sans-serif' }}
              >
                Sunrises
              </h1>
              <div ref={sunriseContainerRef} className="flex-1">
                {dimensions.height > 0 && (
                  <MosaicCanvas
                    webcams={sunriseWebcams || []}
                    width={dimensions.width}
                    height={dimensions.height}
                    maxImages={canvasMaxImages}
                    padding={canvasPadding}
                    ratingSizeEffect={0.75}
                    viewSizeEffect={0.1}
                    fillScreenHeight={true}
                    onSelect={(webcam) => {
                      console.log(
                        'Selected webcam:',
                        webcam.webcamId,
                        webcam.title
                      );
                    }}
                  />
                )}
              </div>
            </div>
          </div>
        </section>
      );

    case 'swipe':
      return <SwipeSnapshotGallery />;

    case 'gallery':
      // TODO: Implement SnapshotGallery component
      return (
        <div className="w-full h-screen flex items-center justify-center bg-black">
          <p className="text-white">Gallery view coming soon...</p>
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
