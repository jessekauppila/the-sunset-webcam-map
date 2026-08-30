'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { resolveMosaic } from '@/app/components/mosaic/registry';
import { useTerminatorStore } from '@/app/store/useTerminatorStore';
import { useLoadTerminatorWebcams } from '@/app/store/useLoadTerminatorWebcams';
import { useKioskRuntime } from '../useKioskRuntime';
import { KioskDozeOverlay } from '../KioskDozeOverlay';
import { parsePanelPreview } from '../panelPreview';
import { PanelFrame } from '../PanelFrame';

function SunriseKioskContent() {
  const { dozing } = useKioskRuntime();
  useLoadTerminatorWebcams({ paused: dozing });
  const webcams = useTerminatorStore((t) => t.sunrise);
  const searchParams = useSearchParams();
  const queryString = searchParams.toString();
  const Mosaic = resolveMosaic(searchParams.get('v'));
  const panel = useMemo(
    () => parsePanelPreview(new URLSearchParams(queryString)),
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

  const stage = panel ?? dimensions;

  const mosaic = (
    <>
      <Mosaic
        webcams={webcams}
        width={stage.width}
        height={stage.height}
        feed="sunrise"
        setupMode={searchParams.get('setup') === '1'}
        search={queryString}
      />
      <KioskDozeOverlay dozing={dozing} />
    </>
  );

  return panel ? <PanelFrame panel={panel}>{mosaic}</PanelFrame> : mosaic;
}

export default function SunriseKioskPage() {
  return (
    <Suspense fallback={null}>
      <SunriseKioskContent />
    </Suspense>
  );
}
