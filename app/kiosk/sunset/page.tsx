'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { GeoMosaic } from '@/app/components/GeoMosaic/GeoMosaic';
import { useTerminatorStore } from '@/app/store/useTerminatorStore';
import { useLoadTerminatorWebcams } from '@/app/store/useLoadTerminatorWebcams';
import { useKioskRuntime } from '../useKioskRuntime';
import { KioskDozeOverlay } from '../KioskDozeOverlay';
import { parseCompositionOverrides } from '../compositionOverrides';

function SunsetKioskContent() {
  const { dozing } = useKioskRuntime();
  useLoadTerminatorWebcams({ paused: dozing });
  const webcams = useTerminatorStore((t) => t.sunset);
  const searchParams = useSearchParams();
  const queryString = searchParams.toString();
  const configOverrides = useMemo(
    () => parseCompositionOverrides(new URLSearchParams(queryString)),
    [queryString]
  );

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
        feed="sunset"
        setupMode={searchParams.get('setup') === '1'}
        config={configOverrides}
      />
      <KioskDozeOverlay dozing={dozing} />
    </>
  );
}

export default function SunsetKioskPage() {
  return (
    <Suspense fallback={null}>
      <SunsetKioskContent />
    </Suspense>
  );
}
