'use client';

import { useEffect, useState } from 'react';
import type { MosaicProps } from '@/app/components/mosaic/types';
import type { EntryView } from '@/app/api/kiosk/solo/view';
import { mergeSettings } from '@/app/lib/settings/schema';
import { SOLO2_SETTINGS_SCHEMA, dialsFrom2 } from '@/app/lib/solo2/settingsSchema';
import { withCaption } from '@/app/lib/solo/captionSchema';
import { fitPlan, planOf } from '@/app/lib/solo2/plan';
import { capFor, planDialsFor, runOf } from '@/app/lib/solo2/run';
import { useSoloGlass } from '@/app/components/solo/useSoloGlass';
import { Solo2Frame } from './Solo2Frame';
import { useStage } from './useStage';

const mono = 'ui-monospace, SFMono-Regular, Menlo, monospace';

function preload(url: string) {
  const img = new Image();
  img.src = url;
}

/**
 * What the glass remembers across dwells: the frame on glass, the one before
 * it, and when this dwell began. All three change in ONE state update when
 * the server's current frame changes, so no render sees a new frame with
 * the old previous, and a follower tab whose boundary ticks past without an
 * advance keeps the start it had (the audit of 2026-09-05 found both).
 */
interface Dwell {
  entry: EntryView | null;
  previous: EntryView | null;
  /** When the dwell began: the server's shown-since when it has one, else the boundary just passed. */
  startMs: number;
}

/**
 * solo2 as a registered version (rhythm spec §5.3): solo's bins and
 * schedule, with rhythm decided on the server and the camera run, lead,
 * transition and local time drawn here. Everything it shows comes from
 * /api/kiosk/solo with `version=solo2`.
 */
export function Solo2Kiosk(props: MosaicProps) {
  const dials = dialsFrom2(withCaption(mergeSettings(SOLO2_SETTINGS_SCHEMA, props.settings), props.shared));
  const glass = useSoloGlass({
    feed: props.feed,
    drive: props.driveSchedule !== false,
    dozing: props.dozing === true,
    version: 'solo2',
  });
  const current = glass.current;
  // The server stamps shown-since; without one, treat the dwell as starting
  // now rather than working backwards from an end and a dial, which a budget
  // makes wrong (spec §5.1).
  const startFor = () => glass.shownSince ?? Date.now();
  const [dwell, setDwell] = useState<Dwell>(() => ({ entry: current, previous: null, startMs: startFor() }));
  // Derived during render, so the new dwell and its previous frame commit together.
  if ((current?.snapshotId ?? null) !== (dwell.entry?.snapshotId ?? null)) {
    setDwell({ entry: current, previous: dwell.entry, startMs: startFor() });
  }
  const previous = dwell.previous;

  /**
   * The run and the plan are READ, not re-derived: the draw pinned both, and
   * the server publishes them as `shownSnapshotIds` and `endsAtMs`.
   *
   * This used to call `runOf`/`fitPlan` over `glass.entries` on every render.
   * That pool is refetched every minute and changes every minute, the frame
   * cap is a rank within it, and `runOf` anchors its window at the newest
   * frame — so a wider cap PREPENDED older frames while the dwell's clock was
   * already running, and the clock-driven index landed on a different picture.
   * On glass that read as the run stepping backwards and the caption's
   * "minutes ago" counting up (reported 2026-09-08).
   *
   * The fallback is the old derivation, reached only for a screen row written
   * before the dwell was pinned.
   */
  const byId = new Map(glass.entries.map((e) => [e.snapshotId, e]));
  const pinnedIds = glass.shownSnapshotIds;
  // A frame the pool dropped mid-dwell cannot be drawn, but it keeps its place
  // in the timing: `plan.frames` stays the pinned count, so the step rate is
  // unchanged and only the missing picture is skipped.
  const pinnedRun = pinnedIds.map((id) => byId.get(id)).filter((e): e is EntryView => !!e);
  const pinnedTotalS = glass.endsAtMs != null && glass.shownSince != null
    ? (glass.endsAtMs - glass.shownSince) / 1000
    : null;
  const pinned = pinnedRun.length > 0 && pinnedTotalS != null && pinnedTotalS > 0;
  const run = pinned
    ? pinnedRun
    : current ? runOf(current, glass.entries, dials.cameraRun, capFor(current, dials, glass.entries, dials.cameraRun)) : [];
  const plan = pinned
    ? planOf(pinnedTotalS, pinnedIds.length, dials)
    : fitPlan(current ? planDialsFor(current, dials, glass.entries, dials.cameraRun) : dials, run.length);
  const stage = useStage(plan, dwell.startMs);

  // Preload the projected next frame and its run, so the arrival is clean.
  const nextEntry = glass.nextEntries[0] ?? null;
  const nextId = nextEntry?.snapshotId ?? null;
  useEffect(() => {
    if (!nextEntry) return;
    for (const f of runOf(nextEntry, glass.entries, dials.cameraRun, capFor(nextEntry, dials, glass.entries, dials.cameraRun))) preload(f.imageUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nextId, dials.cameraRun]);

  const debug = props.allowDebugOverlays !== false && (props.search ?? '').includes('debug=1');

  return (
    <div style={{ position: 'relative', width: props.width, height: props.height, background: '#000' }}>
      {current ? (
        <Solo2Frame entry={current} run={run} previous={previous} stage={stage} plan={plan} dials={dials} dwellKey={dwell.startMs}
          width={props.width} height={props.height} feed={props.feed} />
      ) : null}
      {debug && (
        <div style={{
          position: 'absolute', top: 8, left: 8, fontFamily: mono, fontSize: 12, color: '#7ee2ac',
          background: 'rgba(0,0,0,.7)', padding: '4px 8px', borderRadius: 4,
        }}>
          slot {glass.slot} · next in {Math.max(0, Math.ceil((glass.boundaryMs - Date.now()) / 1000))} s
          · queue {glass.queueLength} · frame {stage.index + 1}/{plan.frames} · lead {Math.round(stage.leadProgress * 100)}%
          {glass.error ? ` · ${glass.error}` : ''}
        </div>
      )}
    </div>
  );
}
