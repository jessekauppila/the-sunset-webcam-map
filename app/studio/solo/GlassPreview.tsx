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
import { capFor, runOf } from '@/app/lib/solo2/run';
import { useLoopingStage } from './useLoopingStage';
import { useSoloPreview } from './useSoloPreview';

const mono = 'ui-monospace, SFMono-Regular, Menlo, monospace';
const SIDE: Record<Feed, string> = { sunrise: 'left screen', sunset: 'right screen' };
/**
 * The panel's own edge, drawn on the scaled panel and nowhere else. Amber
 * because it must not be mistaken for the chrome around it: the preview column
 * used to carry the only visible rectangle, so the eye read the column's
 * border as the glass and judged the caption against a line the glass does
 * not have. This one is the glass.
 */
const PANEL_EDGE = '#f5a344';

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
  // The queue plays whether or not anything is on glass. `current` is resolved
  // by id against the live pool (view.ts), so it goes null the moment the
  // on-glass frame ages out — which is where a screen sits any time nothing is
  // advancing it. Gating the whole order on it blanked a screen whose queue was
  // eight frames deep.
  const queue = projected?.next ?? [];
  const order: EntryView[] = current ? [current, ...queue] : queue;

  // Only solo2 reads the stage, but the run and the plan are what say how long
  // a dwell lasts, so they are derived for every version before the walker.
  const solo2 = version.name === 'solo2';
  const d2 = dials as Solo2Dials;
  // The same capped run and the same budget rule the glass uses, so the
  // preview steps at the rate the glass will (dwell-budget spec §3, §4).
  const runFor = (e: EntryView) => (
    solo2 ? runOf(e, server?.entries ?? [], d2.cameraRun, capFor(e, d2)) : []
  );
  // The fades only for solo2: its dwell opens with an arrival segment
  // (dwell-budget spec §3.3); solo's does not, so its walker must not wait one out.
  const planFor = (e: EntryView | null) => fitPlan(
    {
      dwellS: dials.dwellS, leadS: d2.leadS ?? 0, minStepS: d2.minStepS ?? dials.dwellS,
      ...(solo2 ? { transition: d2.transition, fadeS: d2.fadeS, sameCameraFadeS: d2.sameCameraFadeS } : {}),
    },
    Math.max(1, e ? runFor(e).length : 1),
  );
  // Per frame, not once: the budget stretches a dwell past the dial whenever a
  // run has more frames than the floor can divide it into, so a walker on the
  // dial alone cut a stretched run short — the preview jumped to the next
  // camera mid-timelapse while the glass played the run out.
  const dwell = useSoloPreview(order, (e) => planFor(e).dwellS);
  const now = useNow();

  const run = dwell.entry ? runFor(dwell.entry) : [];
  const plan = planFor(dwell.entry);
  // Keyed on the dwell start, not the index: the start changes on every step
  // AND every restart (a server advance while sitting at index 0 still gets
  // a fresh start), but never on a bare tick, so this is the one value that
  // means "the dwell actually changed."
  const stage = useLoopingStage(plan, dwell.startMs);

  // This dwell's own length, so the countdown agrees with when the walker will move.
  const remainingS = Math.max(0, Math.ceil((dwell.startMs + plan.dwellS * 1000 - now) / 1000));
  // Index 0 is the on-glass frame only when there IS one; with a dark glass
  // it is the first queued frame, and saying `on glass now` there would be a
  // lie about the thing this header exists to keep in sight.
  const dark = current ? '' : 'nothing on glass · ';
  const status = dwell.entry
    ? (current && dwell.index === 0
      ? `on glass now · frame ${dwell.entry.snapshotId}`
      : `${dark}preview · frame ${dwell.entry.snapshotId} · next in ${remainingS} s`)
    : error ?? 'nothing on glass';

  return (
    <section style={{ display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0 }}>
      <div style={{ fontFamily: mono, fontSize: 11, color: '#8b95a7', padding: '0 0 6px', display: 'flex', gap: 10 }}>
        <span style={{ color: '#e5e7eb' }}>{feed} · {SIDE[feed]}</span>
        <span>{status}</span>
        <span style={{ marginLeft: 'auto' }}>{panel.width} × {panel.height}</span>
      </div>
      {/* No border here: this box is the column, not the panel. The panel draws its own edge. */}
      <div data-testid={`preview-${feed}`} style={{ flex: 1, minHeight: 0, background: '#000' }}>
        {dwell.entry ? (
          <StudioPanelFrame panel={panel} edge={PANEL_EDGE}>
            {solo2 ? (
              <Solo2Frame entry={dwell.entry} run={run} previous={dwell.previous} stage={stage} plan={plan} dials={d2} dwellKey={dwell.startMs}
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
