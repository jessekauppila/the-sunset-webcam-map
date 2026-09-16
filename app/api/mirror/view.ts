import { buildStateView, type EntryView, type StateView, type ViewEntry } from '@/app/api/kiosk/solo/view';
import type { ScreenRow } from '@/app/lib/solo/store';
import type { Feed } from '@/app/lib/solo/types';
import { SOLO_VERSIONS, type SoloVersionSpec } from '@/app/lib/solo/versions';
import type { Solo2Dials } from '@/app/lib/solo2/types';

/**
 * One second at the edge (mirror spec §4.1). The beat gives a follower one
 * beat to see a new slot, and one origin call per second per feed per region
 * is the cost ceiling whatever the visitor count. The stale window is what
 * the follower's retry tolerates, not a longer TTL.
 */
export const MIRROR_CACHE_CONTROL = 'public, s-maxage=1, stale-while-revalidate=4';

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
   * The current run resolved to frames (play order, drawn frame last,
   * frames the pool has since dropped omitted), then the next run. The
   * renderer resolves `current.shownSnapshotIds` against this and preloads
   * the rest.
   */
  entries: EntryView[];
  /** The projected next dwell's frames, play order, drawn frame last. */
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
  const state = buildStateView({
    feed: input.feed, dials: input.dials, entries: input.entries, screen: input.screen, nowMs: input.nowMs,
    admitted: { sunset: 0, nonSunset: 0 }, zone: { minDeg: 0, maxDeg: 0 }, version,
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
