'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { GeoMosaic } from '@/app/components/GeoMosaic/GeoMosaic';
import { useTerminatorStore } from '@/app/store/useTerminatorStore';
import { useLoadTerminatorWebcams } from '@/app/store/useLoadTerminatorWebcams';
import { useKioskRuntime } from '../useKioskRuntime';
import { KioskDozeOverlay } from '../KioskDozeOverlay';

function SunriseKioskContent() {
  const { dozing } = useKioskRuntime();
  useLoadTerminatorWebcams({ paused: dozing });
  const webcams = useTerminatorStore((t) => t.sunrise);
  const searchParams = useSearchParams();

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
    <>
      <GeoMosaic
        webcams={webcams}
        width={dimensions.width}
        height={dimensions.height}
        feed="sunrise"
        setupMode={searchParams.get('setup') === '1'}
      />
      <KioskDozeOverlay dozing={dozing} />
    </>
  );
}

export default function SunriseKioskPage() {
  return (
    <Suspense fallback={null}>
      <SunriseKioskContent />
    </Suspense>
  );
}
