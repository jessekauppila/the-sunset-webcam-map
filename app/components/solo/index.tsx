'use client';

import { useEffect, useRef, useState } from 'react';
import type { MosaicProps } from '@/app/components/mosaic/types';
import type { EntryView } from '@/app/api/kiosk/solo/view';
import { mergeSettings } from '@/app/lib/settings/schema';
import { SOLO_SETTINGS_SCHEMA, dialsFrom } from '@/app/lib/solo/settingsSchema';
import { SoloFrame } from './SoloFrame';
import { useSoloGlass } from './useSoloGlass';

const mono = 'ui-monospace, SFMono-Regular, Menlo, monospace';

/**
 * The solo kiosk as a registered version (spec §6.3): one archived frame per
 * screen, chosen by the server from the bins, advancing on the wall clock.
 * Ignores the pool props entirely; everything it shows comes from
 * /api/kiosk/solo.
 */
export function SoloKiosk(props: MosaicProps) {
  const dials = dialsFrom(mergeSettings(SOLO_SETTINGS_SCHEMA, props.settings));
  const glass = useSoloGlass({
    feed: props.feed,
    dials,
    drive: props.driveSchedule !== false,
    dozing: props.dozing === true,
  });
  const current = glass.current;
  const [previous, setPrevious] = useState<EntryView | null>(null);
  const lastRef = useRef<EntryView | null>(null);
  useEffect(() => {
    if (current && lastRef.current && current.snapshotId !== lastRef.current.snapshotId) {
      setPrevious(lastRef.current);
    }
    lastRef.current = current;
  }, [current]);

  const debug = props.allowDebugOverlays !== false && (props.search ?? '').includes('debug=1');

  return (
    <div style={{ position: 'relative', width: props.width, height: props.height, background: '#000' }}>
      {current ? (
        <SoloFrame entry={current} previous={previous} fadeS={dials.fadeS} dials={dials}
          width={props.width} height={props.height} />
      ) : null}
      {debug && (
        <div style={{
          position: 'absolute', top: 8, left: 8, fontFamily: mono, fontSize: 12, color: '#7ee2ac',
          background: 'rgba(0,0,0,.7)', padding: '4px 8px', borderRadius: 4,
        }}>
          slot {glass.slot} · next in {Math.max(0, Math.ceil((glass.boundaryMs - Date.now()) / 1000))} s
          · queue {glass.queueLength}{glass.error ? ` · ${glass.error}` : ''}
        </div>
      )}
    </div>
  );
}
