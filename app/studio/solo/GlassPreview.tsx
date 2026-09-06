'use client';

import { useState } from 'react';
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

const mono = 'ui-monospace, SFMono-Regular, Menlo, monospace';
const SIDE: Record<Feed, string> = { sunrise: 'left screen', sunset: 'right screen' };

/**
 * solo2's screen, playing (camera-run spec §5.1): the on-glass camera's run
 * on the STUDIO dials, over and over on a local clock, so the dissolves and
 * the camera-change transition are visible here and dialled from this
 * page. `previous` is derived in the same render as the new frame, as the
 * kiosk does.
 */
function PlayingScreen({ current, entries, dials, feed, panel }: {
  current: EntryView; entries: StateView['entries']; dials: Solo2Dials; feed: Feed; panel: { width: number; height: number };
}) {
  const [track, setTrack] = useState<{ entry: EntryView; previous: EntryView | null }>({ entry: current, previous: null });
  if (current.snapshotId !== track.entry.snapshotId) setTrack({ entry: current, previous: track.entry });
  const run = runOf(current, entries, dials.cameraRun);
  const plan = fitPlan(dials, run.length);
  const stage = useLoopingStage(plan, current.snapshotId);
  return (
    <Solo2Frame entry={current} run={run} previous={track.previous} stage={stage} plan={plan} dials={dials}
      width={panel.width} height={panel.height} feed={feed} />
  );
}

/**
 * The two screens as the glass draws them right now, by the same component
 * the glass uses, with the studio dials instead of the live ones: what Deploy
 * will send. Each screen composes at the shared panel preset's true pixels
 * and StudioPanelFrame scales it to the box it is given, so the caption is
 * sized exactly as on glass and both screens fit above the fold. Always on
 * screen in the solo studio, whichever rail page is up, so a picture dial
 * shows its effect without a tab switch. solo2's screens play (§5.1).
 */
export function GlassPreview({ screens, dials, panel, version = SOLO_VERSIONS.solo as SoloVersionSpec }: {
  screens: { feed: Feed; server: StateView | null; error?: string | null }[];
  dials: SoloDials;
  /** The glass geometry: the frame composes at this size. */
  panel: { width: number; height: number };
  version?: SoloVersionSpec;
}) {
  return (
    <>
      {screens.map(({ feed, server, error }) => {
        const current = server?.current?.entry ?? null;
        return (
          <section key={feed} style={{ display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0 }}>
            <div style={{ fontFamily: mono, fontSize: 11, color: '#8b95a7', padding: '0 0 6px', display: 'flex', gap: 10 }}>
              <span style={{ color: '#e5e7eb' }}>{feed} · {SIDE[feed]}</span>
              <span>{current ? `on glass now · frame ${current.snapshotId}` : error ?? 'nothing on glass'}</span>
              <span style={{ marginLeft: 'auto' }}>{panel.width} × {panel.height}</span>
            </div>
            <div data-testid={`preview-${feed}`} style={{ flex: 1, minHeight: 0, background: '#000', border: '1px solid #1d2432' }}>
              {current ? (
                <StudioPanelFrame panel={panel}>
                  {version.name === 'solo2' ? (
                    <PlayingScreen current={current} entries={server?.entries ?? []} dials={dials as Solo2Dials} feed={feed} panel={panel} />
                  ) : (
                    <SoloFrame entry={current} previous={null} fadeS={0} dials={dials} width={panel.width} height={panel.height} feed={feed} />
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
      })}
    </>
  );
}
