'use client';

import { useEffect, useRef, useState } from 'react';
import type { MosaicProps } from '@/app/components/mosaic/types';
import type { EntryView } from '@/app/api/kiosk/solo/view';
import { mergeSettings } from '@/app/lib/settings/schema';
import { SOLO2_SETTINGS_SCHEMA, dialsFrom2 } from '@/app/lib/solo2/settingsSchema';
import { fitPlan } from '@/app/lib/solo2/plan';
import { preludeFor } from '@/app/lib/solo2/prelude';
import { useSoloGlass } from '@/app/components/solo/useSoloGlass';
import { Solo2Frame } from './Solo2Frame';
import { useStage } from './useStage';

const mono = 'ui-monospace, SFMono-Regular, Menlo, monospace';

function preload(url: string) {
  const img = new Image();
  img.src = url;
}

/**
 * solo2 as a registered version (spec §5.3): solo's bins and schedule, with
 * rhythm decided on the server and the prelude, lead, transition and local
 * time drawn here. Everything it shows comes from /api/kiosk/solo with
 * `version=solo2`.
 */
export function Solo2Kiosk(props: MosaicProps) {
  const dials = dialsFrom2(mergeSettings(SOLO2_SETTINGS_SCHEMA, props.settings));
  const glass = useSoloGlass({
    feed: props.feed,
    dials,
    drive: props.driveSchedule !== false,
    dozing: props.dozing === true,
    version: 'solo2',
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

  const prelude = current && dials.prelude ? preludeFor(current, glass.entries, dials.preludeFrames) : [];
  const plan = fitPlan(dials, prelude.length);
  // The dwell began one dwell before the next boundary; both are pure clock math.
  const startMs = glass.boundaryMs - dials.dwellS * 1000;
  const stage = useStage(plan, startMs);

  // Preload the projected next frame and its prelude, so the cut is clean.
  const nextEntry = glass.nextEntries[0] ?? null;
  const nextId = nextEntry?.snapshotId ?? null;
  useEffect(() => {
    if (!nextEntry) return;
    preload(nextEntry.imageUrl);
    if (dials.prelude) for (const p of preludeFor(nextEntry, glass.entries, dials.preludeFrames)) preload(p.imageUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nextId, dials.prelude, dials.preludeFrames]);

  const debug = props.allowDebugOverlays !== false && (props.search ?? '').includes('debug=1');

  return (
    <div style={{ position: 'relative', width: props.width, height: props.height, background: '#000' }}>
      {current ? (
        <Solo2Frame entry={current} prelude={prelude} previous={previous} stage={stage} plan={plan} dials={dials}
          width={props.width} height={props.height} />
      ) : null}
      {debug && (
        <div style={{
          position: 'absolute', top: 8, left: 8, fontFamily: mono, fontSize: 12, color: '#7ee2ac',
          background: 'rgba(0,0,0,.7)', padding: '4px 8px', borderRadius: 4,
        }}>
          slot {glass.slot} · next in {Math.max(0, Math.ceil((glass.boundaryMs - Date.now()) / 1000))} s
          · queue {glass.queueLength} · {stage.layer === 'prelude' ? `prelude ${stage.index + 1}/${plan.preludeFrames}` : `hold, lead ${Math.round(stage.leadProgress * 100)}%`}
          {plan.clamped ? ' · clamped' : ''}{glass.error ? ` · ${glass.error}` : ''}
        </div>
      )}
    </div>
  );
}
