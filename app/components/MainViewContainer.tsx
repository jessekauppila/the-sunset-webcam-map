'use client';

import { useRef, useState, useEffect } from 'react';
import SimpleMap from './Map/SimpleMap';
import { RatingPanel } from './Rating/RatingPanel';
import { MosaicCanvas } from './MosaicCanvas';
import { useTerminatorStore } from '@/app/store/useTerminatorStore';
import type { Location } from '../lib/types';

export type ViewMode =
  | 'map'
  | 'globe'
  | 'sunrise-mosaic'
  | 'sunset-mosaic'
  | 'rating';

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

  // Refs for measuring actual available space (full screen for each mode)
  const sunsetContainerRef = useRef<HTMLDivElement>(null);
  const sunriseContainerRef = useRef<HTMLDivElement>(null);
  const [sunsetDimensions, setSunsetDimensions] = useState({
    width: typeof window !== 'undefined' ? window.innerWidth : 900,
    height: typeof window !== 'undefined' ? window.innerHeight : 800,
  });
  const [sunriseDimensions, setSunriseDimensions] = useState({
    width: typeof window !== 'undefined' ? window.innerWidth : 900,
    height: typeof window !== 'undefined' ? window.innerHeight : 800,
  });

  // Measure actual available space for sunset container
  useEffect(() => {
    const updateDimensions = () => {
      if (sunsetContainerRef.current) {
        const rect =
          sunsetContainerRef.current.getBoundingClientRect();
        setSunsetDimensions({
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

  // Measure actual available space for sunrise container
  useEffect(() => {
    const updateDimensions = () => {
      if (sunriseContainerRef.current) {
        const rect =
          sunriseContainerRef.current.getBoundingClientRect();
        setSunriseDimensions({
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

  const canvasMaxImages = 90;
  const canvasPadding = 2;

  // Render different views based on mode
  switch (mode) {
    case 'map':
    case 'globe':
      return <SimpleMap userLocation={userLocation} mode={mode} />;

    case 'rating':
      return (
        <section className="map-container w-full h-screen">
          <div className="flex flex-col h-full">
            <div className="flex-1" style={{ position: 'relative' }}>
              <RatingPanel variant="fullscreen" />
            </div>
          </div>
        </section>
      );

    case 'sunset-mosaic':
      return (
        <section className="map-container w-full h-screen">
          <div className="flex flex-col h-full">
            {/* <h1
              className="text-center text-gray-500 text-xl py-2"
              style={{ fontFamily: 'Roboto, Arial, sans-serif' }}
            >
              Sunsets
            </h1> */}
            <div ref={sunsetContainerRef} className="flex-1">
              {sunsetDimensions.height > 0 && (
                <MosaicCanvas
                  webcams={sunsetWebcams || []}
                  width={sunsetDimensions.width}
                  height={sunsetDimensions.height}
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
        </section>
      );

    case 'sunrise-mosaic':
      return (
        <section className="map-container w-full h-screen">
          <div className="flex flex-col h-full">
            {/* <h1
              className="text-center text-gray-500 text-xl py-2"
              style={{ fontFamily: 'Roboto, Arial, sans-serif' }}
            >
              Sunrises
            </h1> */}
            <div ref={sunriseContainerRef} className="flex-1">
              {sunriseDimensions.height > 0 && (
                <MosaicCanvas
                  webcams={sunriseWebcams || []}
                  width={sunriseDimensions.width}
                  height={sunriseDimensions.height}
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
