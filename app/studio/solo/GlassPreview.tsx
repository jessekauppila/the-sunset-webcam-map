'use client';

import { useEffect, useState } from 'react';
import { SoloFrame } from '@/app/components/solo/SoloFrame';
import { Solo2Frame } from '@/app/components/solo2/Solo2Frame';
import { StudioPanelFrame } from '../StudioPanelFrame';
import type { EntryView, StateView } from '@/app/api/kiosk/solo/view';
import type { Feed, SoloDials } from '@/app/lib/solo/types';
import { SOLO_VERSIONS, type SoloVersionSpec } from '@/app/lib/solo/versions';
import type { Solo2Dials } from '@/app/lib/solo2/types';
import { fitPlan } from '@/app/lib/solo2/plan';
import { runOf } from '@/app/lib/solo2/run';
import { useLoopingStage } from './useLoopingStage';
import { useSoloPreview } from './useSoloPreview';

const mono = 'ui-monospace, SFMono-Regular, Menlo, monospace';
const SIDE: Record<Feed, string> = { sunrise: 'left screen', sunset: 'right screen' };

/** One screen's inputs: what the glass holds, and the queue re-projected on the studio dials. */
export interface PreviewScreen {
  feed: Feed;
  server: StateView | null;
  /** `useSoloState`'s re-projection: what these dials would draw next. */
  projected: StateView | null;
  error?: string | null;
}

/**
 * A wall clock for the countdown only. The dwell itself is `useSoloPreview`'s
 * business; this just re-renders often enough for `next in N s` to fall.
 */
function useNow(tickMs = 250): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), Math.max(1, tickMs));
    return () => clearInterval(t);
  }, [tickMs]);
  return now;
}

/**
 * One screen, playing (spec §5): the on-glass frame and then the projected
 * queue, each for the studio's dwell, on a local clock, so a dial move is
 * visible in motion instead of on one held frame. The header keeps the live
 * truth in sight — `on glass now` only while the preview is on the frame the
 * glass is actually showing.
 *
 * Both versions play here. solo crossfades on `fadeS`; solo2 additionally
 * plays each dwell's camera run, its stage clock restarted by the preview's
 * index so the run and the dwell step together. `previous` comes from the
 * same state update as the new frame, as the kiosk does.
 */
function PlayingScreen({ feed, server, projected, error, dials, panel, version }: PreviewScreen & {
  dials: SoloDials; panel: { width: number; height: number }; version: SoloVersionSpec;
}) {
  const current = server?.current?.entry ?? null;
  const order: EntryView[] = current ? [current, ...(projected?.next ?? [])] : [];
  const dwell = useSoloPreview(order, dials.dwellS);
  const now = useNow();

  // Hooks run on both versions; only solo2 reads the stage.
  const solo2 = version.name === 'solo2';
  const d2 = dials as Solo2Dials;
  const run = solo2 && dwell.entry ? runOf(dwell.entry, server?.entries ?? [], d2.cameraRun) : [];
  const plan = fitPlan({ dwellS: dials.dwellS, leadS: d2.leadS ?? 0 }, Math.max(1, run.length));
  const stage = useLoopingStage(plan, dwell.index);

  const remainingS = Math.max(0, Math.ceil((dwell.startMs + dials.dwellS * 1000 - now) / 1000));
  const status = dwell.entry
    ? (dwell.index === 0
      ? `on glass now · frame ${dwell.entry.snapshotId}`
      : `preview · frame ${dwell.entry.snapshotId} · next in ${remainingS} s`)
    : error ?? 'nothing on glass';

  return (
    <section style={{ display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0 }}>
      <div style={{ fontFamily: mono, fontSize: 11, color: '#8b95a7', padding: '0 0 6px', display: 'flex', gap: 10 }}>
        <span style={{ color: '#e5e7eb' }}>{feed} · {SIDE[feed]}</span>
        <span>{status}</span>
        <span style={{ marginLeft: 'auto' }}>{panel.width} × {panel.height}</span>
      </div>
      <div data-testid={`preview-${feed}`} style={{ flex: 1, minHeight: 0, background: '#000', border: '1px solid #1d2432' }}>
        {dwell.entry ? (
          <StudioPanelFrame panel={panel}>
            {solo2 ? (
              <Solo2Frame entry={dwell.entry} run={run} previous={dwell.previous} stage={stage} plan={plan} dials={d2}
                width={panel.width} height={panel.height} feed={feed} />
            ) : (
              // No key: SoloFrame's fade is a mount animation on an <img> keyed
              // by the snapshot id, so a new entry replays it on its own.
              <SoloFrame entry={dwell.entry} previous={dwell.previous} fadeS={dials.fadeS} dials={dials}
                width={panel.width} height={panel.height} feed={feed} />
            )}
          </StudioPanelFrame>
        ) : (
          <div style={{ height: '100%', display: 'grid', placeItems: 'center', color: '#4b5568', fontFamily: mono, fontSize: 12 }}>
            no frame to preview
          </div>
        )}
      </div>
    </section>
  );
}

/**
 * The two screens as the glass draws them, by the same component the glass
 * uses, with the studio dials instead of the live ones: what Deploy will
 * send. Each screen composes at the shared panel preset's true pixels and
 * StudioPanelFrame scales it to the box it is given, so the caption is sized
 * exactly as on glass and both screens fit above the fold. Always on screen
 * in the solo studio, whichever rail page is up, so a picture dial shows its
 * effect without a tab switch. Both versions play the projected queue (§5).
 */
export function GlassPreview({ screens, dials, panel, version = SOLO_VERSIONS.solo as SoloVersionSpec }: {
  screens: PreviewScreen[];
  dials: SoloDials;
  /** The glass geometry: the frame composes at this size. */
  panel: { width: number; height: number };
  version?: SoloVersionSpec;
}) {
  return (
    <>
      {screens.map((screen) => (
        <PlayingScreen key={screen.feed} {...screen} dials={dials} panel={panel} version={version} />
      ))}
    </>
  );
}
