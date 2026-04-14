'use client';

import { useEffect, useState } from 'react';
import { MosaicCanvas } from '@/app/components/MosaicCanvas';
import { useTerminatorStore } from '@/app/store/useTerminatorStore';
import { useLoadTerminatorWebcams } from '@/app/store/useLoadTerminatorWebcams';
import {
  KIOSK_MOSAIC_MAX_IMAGE_HEIGHT_PX,
  KIOSK_MOSAIC_MIN_IMAGE_HEIGHT_PX,
  KIOSK_CANVAS_MAX_IMAGES,
} from '@/app/lib/masterConfig';

export default function SunriseKioskPage() {
  useLoadTerminatorWebcams();
  const webcams = useTerminatorStore((t) => t.sunrise);

  const [dimensions, setDimensions] = useState({
    width: typeof window !== 'undefined' ? window.innerWidth : 1080,
    height: typeof window !== 'undefined' ? window.innerHeight : 1920,
  });

  useEffect(() => {
    const handleResize = () => {
      setDimensions({
        width: window.innerWidth,
        height: window.innerHeight,
      });
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return (
    <MosaicCanvas
      webcams={webcams}
      width={dimensions.width}
      height={dimensions.height}
      maxImages={KIOSK_CANVAS_MAX_IMAGES}
      padding={2}
      ratingSizeEffect={0.75}
      viewSizeEffect={0.1}
      fillScreenHeight={true}
      maxImageHeight={KIOSK_MOSAIC_MAX_IMAGE_HEIGHT_PX}
      minImageHeight={KIOSK_MOSAIC_MIN_IMAGE_HEIGHT_PX}
    />
  );
}
