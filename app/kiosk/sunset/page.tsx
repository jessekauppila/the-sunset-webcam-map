'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { resolveMosaic, resolveMosaicName } from '@/app/components/mosaic/registry';
import { SHARED_SCHEMA } from '@/app/lib/settings/sharedSchema';
import { mergeSettings } from '@/app/lib/settings/schema';
import { useTerminatorStore } from '@/app/store/useTerminatorStore';
import { useLoadTerminatorWebcams } from '@/app/store/useLoadTerminatorWebcams';
import { useKioskRuntime } from '../useKioskRuntime';
import { KioskDozeOverlay } from '../KioskDozeOverlay';
import { parsePanelPreview } from '../panelPreview';
import { PanelFrame } from '../PanelFrame';

function SunsetKioskContent() {
  const { dozing, liveSettings } = useKioskRuntime();
  useLoadTerminatorWebcams({ paused: dozing });
  const webcams = useTerminatorStore((t) => t.sunset);
  const searchParams = useSearchParams();
  const queryString = searchParams.toString();
  const liveShared = mergeSettings(SHARED_SCHEMA, liveSettings?.namespaces.shared);
  const versionParam = searchParams.get('v') ?? (liveShared.activeVersion as string);
  const Mosaic = resolveMosaic(versionParam);
  const versionName = resolveMosaicName(versionParam);
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
        feed="sunset"
        setupMode={searchParams.get('setup') === '1'}
        search={queryString}
        settings={liveSettings?.namespaces[versionName]}
      />
      <KioskDozeOverlay dozing={dozing} />
    </>
  );

  return panel ? <PanelFrame panel={panel}>{mosaic}</PanelFrame> : mosaic;
}

export default function SunsetKioskPage() {
  return (
    <Suspense fallback={null}>
      <SunsetKioskContent />
    </Suspense>
  );
}
