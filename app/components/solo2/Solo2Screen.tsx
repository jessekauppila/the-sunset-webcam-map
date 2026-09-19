'use client';

import { useEffect, useState } from 'react';
import type { EntryView } from '@/app/api/kiosk/solo/view';
import type { SoloGlass } from '@/app/components/solo/useSoloGlass';
import type { Feed } from '@/app/lib/solo/types';
import type { Solo2Dials } from '@/app/lib/solo2/types';
import { changeBeatsOf, fitPlan } from '@/app/lib/solo2/plan';
import { capFor, planDialsFor, runOf } from '@/app/lib/solo2/run';
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
  /**
   * The frame actually up on glass, which the next change fades out. Not
   * `entry`: a run windows around its peak, and the drawn frame (the newest)
   * plays only when the window reaches it. Fading out a frame the window cut
   * put a picture that was never on glass, and often never loaded, under the
   * closing veil: the handoff flash of 2026-09-18.
   */
  up: EntryView | null;
  /** When the dwell began: the server's shown-since when it has one, else the boundary just passed. */
  startMs: number;
}

/**
 * The solo2 screen, given its source (mirror spec §5): the dwell state, the
 * pinned run and plan, the stage clock, the preload of the next run, and
 * the frame. It cannot tell whether `glass` came from the kiosk's hook or
 * the public follower, which is the point.
 */
export function Solo2Screen({ glass, dials, width, height, feed, debug = false }: {
  glass: SoloGlass;
  dials: Solo2Dials;
  width: number;
  height: number;
  feed: Feed;
  debug?: boolean;
}) {
  const current = glass.current;
  // The server stamps shown-since; without one, treat the dwell as starting
  // now rather than working backwards from an end and a dial, which a budget
  // makes wrong (spec §5.1).
  const startFor = () => glass.shownSince ?? Date.now();
  const [state, setDwell] = useState<Dwell>(() => ({ entry: current, previous: null, up: null, startMs: startFor() }));
  let dwell = state;
  // Derived during render, so the new dwell and its previous frame commit together.
  if ((current?.snapshotId ?? null) !== (dwell.entry?.snapshotId ?? null)) {
    dwell = { entry: current, previous: dwell.up ?? dwell.entry, up: null, startMs: startFor() };
    setDwell(dwell);
  }
  const previous = dwell.previous;

  /**
   * The fallback is the old derivation, reached only for a screen row written
   * before the dwell was pinned.
   */
  const byId = new Map(glass.entries.map((e) => [e.snapshotId, e]));
  const pinnedIds = glass.shownSnapshotIds;
  // A frame the pool dropped mid-dwell cannot be drawn, but it keeps its place
  // in the timing: `plan.frames` stays the pinned count, so the step rate is
  // unchanged and only the missing picture is skipped.
  const pinnedRun = pinnedIds.map((id) => byId.get(id)).filter((e): e is EntryView => !!e);
  // The run the draw pinned. On the beat the plan is integers over that
  // count, so the glass can only land on the tick the server did; nothing
  // here re-reads the pool (beat spec §2.4).
  const pinned = pinnedRun.length > 0;
  const run = pinned
    ? pinnedRun
    : current ? runOf(current, glass.entries, dials.cameraRun, capFor(current, dials, glass.entries, dials.cameraRun)) : [];
  // When the draw is pinned, the server published the dwell's span; the rest
  // is whatever that span holds beyond the change and the frames. Read, not
  // re-derived: the pool moves every minute and the rank with it, and a plan
  // that follows the pool changes dwellS under a clock that has already
  // started (2026-09-08, again 2026-09-14).
  const plan = pinned && glass.endsAtMs != null && glass.shownSince != null
    ? fitPlan({
        ...dials,
        dwellBeats: Math.max(1, Math.round((glass.endsAtMs - glass.shownSince) / 1000 / dials.beatS) - changeBeatsOf(dials)),
      }, pinnedIds.length)
    : fitPlan(current ? planDialsFor(current, dials, glass.entries, dials.cameraRun) : dials, run.length);
  const stage = useStage(plan, dwell.startMs);
  // What Solo2Frame puts up, remembered for the next change.
  const up = run.length > 0 ? run[Math.min(stage.index, run.length - 1)] : current;
  if ((up?.snapshotId ?? null) !== (dwell.up?.snapshotId ?? null)) setDwell({ ...dwell, up });

  // Preload the projected next frame and its run, so the arrival is clean.
  const nextEntry = glass.nextEntries[0] ?? null;
  const nextId = nextEntry?.snapshotId ?? null;
  useEffect(() => {
    if (!nextEntry) return;
    for (const f of runOf(nextEntry, glass.entries, dials.cameraRun, capFor(nextEntry, dials, glass.entries, dials.cameraRun))) preload(f.imageUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nextId, dials.cameraRun]);

  return (
    <div style={{ position: 'relative', width, height, background: '#000' }}>
      {current ? (
        <Solo2Frame entry={current} run={run} previous={previous} stage={stage} plan={plan} dials={dials} dwellKey={dwell.startMs}
          width={width} height={height} feed={feed} />
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
