import { buildStateView, type EntryView, type StateView, type ViewEntry } from '@/app/api/kiosk/solo/view';
import type { ScreenRow } from '@/app/lib/solo/store';
import type { Feed } from '@/app/lib/solo/types';
import { SOLO_VERSIONS, type SoloVersionSpec } from '@/app/lib/solo/versions';
import type { Solo2Dials } from '@/app/lib/solo2/types';

/**
 * Never cached (#238). Mirror spec §4.1 asked for one second at the edge, but
 * that header never took effect (force-dynamic strips s-maxage), and on
 * reading the follower closely it should not: the Pi glass follows this same
 * URL, and sunrise and sunset would be two cache keys going stale
 * independently. Both screens are late by the same ~0.7 s today, which is
 * what keeps the rendezvous together; a cache would make one screen change
 * on the beat while the other lags. Saying no-store outright means removing
 * force-dynamic can never switch a cache on by accident.
 *
 * The cost is that the mirror's load grows with its viewers. The daily digest
 * counts it (app/lib/mirrorTraffic.ts) and warns when it grows; #252 holds
 * the designs for bounding it before a permanent installation.
 */
export const MIRROR_CACHE_CONTROL = 'no-store';

/**
 * What one follower needs for one feed, and nothing the operator's studio
 * view carries: no bins, no tape, no queue beyond the next draw. The state
 * view is a megabyte; this is a few tens of KB.
 */
export interface MirrorView {
  feed: Feed;
  version: 'solo2';
  /** The live panelPreset name, so a follower scales to the glass's size. */
  panelPreset: string;
  /** The same Solo2Dials the server built for the engine, caption included. */
  dials: Solo2Dials;
  /** The screen's slot counter, whether or not anything is drawable; a follower watches it to know the glass moved. */
  slot: number;
  /** As the state view has it; null when the row has no frame or its frame left the pool. */
  current: StateView['current'];
  /**
   * The current run resolved to frames (play order, frames the pool has
   * since dropped omitted), then the next run. The drawn frame is last only
   * when the run's window around its peak reaches it. The
   * renderer resolves `current.shownSnapshotIds` against this and preloads
   * the rest.
   */
  entries: EntryView[];
  /** The projected next dwell's frames, play order. */
  next: EntryView[];
  build: string;
}

export function buildMirrorView(input: {
  feed: Feed;
  dials: Solo2Dials;
  entries: ViewEntry[];
  screen: ScreenRow | null;
  nowMs: number;
  panelPreset: string;
  build: string;
}): MirrorView {
  const version = SOLO_VERSIONS.solo2 as SoloVersionSpec;
  // The state view already ranks, stages and projects the queue with this
  // engine; the mirror is a trim of it, not a second derivation. Admitted
  // counts and the zone are pass-through fields it does not carry.
  //
  // `depth: 1` because the mirror reads only `next[0]`: the studio's default
  // projects a draw per eligible frame, each a sequential walk over the pool,
  // which on a big pool costs seconds per request for a queue this response
  // throws away. The first draw is the same at any depth.
  const state = buildStateView({
    feed: input.feed, dials: input.dials, entries: input.entries, screen: input.screen, nowMs: input.nowMs,
    admitted: { sunset: 0, nonSunset: 0 }, zone: { minDeg: 0, maxDeg: 0 }, version, depth: 1,
  });
  const all = new Map<number, EntryView>();
  for (const e of [...(state.current ? [state.current.entry] : []), ...state.next, ...state.bins.sunset, ...state.bins.nonSunset]) {
    all.set(e.snapshotId, e);
  }
  // The pinned ids from the ROW, not the state view's, which re-derives a
  // run for an unpinned row. The mirror does not: such a row plays the drawn
  // frame alone (spec §4.1).
  const pinnedIds = input.screen?.shownSnapshotIds?.length ? input.screen.shownSnapshotIds : null;
  const currentIds = state.current ? pinnedIds ?? [state.current.entry.snapshotId] : [];
  const run = currentIds.map((id) => all.get(id)).filter((e): e is EntryView => !!e);
  const first = state.next[0];
  const next = first
    ? version.shown(input.entries, first, input.dials).map((e) => all.get(e.snapshotId)).filter((e): e is EntryView => !!e)
    : [];
  const seen = new Set(run.map((e) => e.snapshotId));
  const entries = [...run, ...next.filter((e) => !seen.has(e.snapshotId))];
  return {
    feed: input.feed,
    version: 'solo2',
    panelPreset: input.panelPreset,
    dials: input.dials,
    slot: state.schedule.slot,
    current: state.current ? { ...state.current, shownSnapshotIds: currentIds } : null,
    entries,
    next,
    build: input.build,
  };
}
