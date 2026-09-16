import { replayPair, type Landing, type ReplayEntry, type RendezvousCounts, type StripFrame } from '@/app/lib/solo/replay';
import type { StateView, ViewEntry } from '@/app/api/kiosk/solo/view';
import type { Feed, SoloDials } from '@/app/lib/solo/types';
import type { SoloVersionSpec } from '@/app/lib/solo/versions';
import { cameraGroups, peakOf } from '@/app/lib/solo2/run';
import { changeBeatsOf } from '@/app/lib/solo2/plan';
import type { Solo2Dials } from '@/app/lib/solo2/types';

/**
 * Both screens projected from the live state (one-tape spec §4.1): the same
 * replayPair the CLI runs, over each screen's live pool and draw log, from the
 * instant its current dwell ends. Once with the dials as given and once with
 * the rendezvous off, so the tape can show where a peak would have landed.
 * Pure: no fetch, no clock.
 */
export interface PairProjection {
  sunrise: StripFrame[];
  sunset: StripFrame[];
  /** Projected rendezvous, from replayPair. */
  landings: Landing[];
  counts: RendezvousCounts;
  /** Per strip, per block: where the block's peak would land with the rendezvous off (null when the block has no peak). */
  ghosts: Record<Feed, (number | null)[]>;
}

const toReplayEntry = (e: ViewEntry): ReplayEntry => ({
  ...e, removedAt: null, firstShownAt: null, capturedAt: e.capturedAt, title: e.title, imageUrl: e.imageUrl,
});

function options(feed: Feed, v: StateView, dials: SoloDials, version: SoloVersionSpec, nowMs: number, horizonMs: number, pinned: boolean) {
  const cur = v.current;
  const priorDraws = [
    ...v.tape.map((t) => ({ slot: t.slot, shownAt: t.shownAt, snapshotId: t.snapshotId, shownSnapshotIds: t.shownSnapshotIds, bin: t.bin })),
    ...(cur && cur.slot != null && cur.shownSince != null
      ? [{ slot: cur.slot, shownAt: cur.shownSince, snapshotId: cur.entry.snapshotId, shownSnapshotIds: cur.shownSnapshotIds, bin: cur.entry.bin }]
      : []),
  ];
  const fromMs = cur?.endsAtMs ?? nowMs;
  return {
    feed, version, dials, entries: v.entries.map(toReplayEntry), priorDraws, fromMs, toMs: nowMs + horizonMs,
    pinnedAtMs: pinned ? cur?.peakAtMs ?? null : null,
  };
}

export function projectPair(input: { sunrise: StateView; sunset: StateView; dials: SoloDials; version: SoloVersionSpec; nowMs: number; horizonMs: number }): PairProjection {
  const { dials, version, nowMs, horizonMs } = input;
  const withR = replayPair({
    sunrise: options('sunrise', input.sunrise, dials, version, nowMs, horizonMs, true),
    sunset: options('sunset', input.sunset, dials, version, nowMs, horizonMs, true),
  });
  const off = { ...dials, rendezvous: false } as SoloDials;
  const without = replayPair({
    sunrise: options('sunrise', input.sunrise, off, version, nowMs, horizonMs, false),
    sunset: options('sunset', input.sunset, off, version, nowMs, horizonMs, false),
  });
  const d2 = dials as Partial<Solo2Dials>;
  const beatMs = (d2.beatS ?? 0) * 1000;
  const change = d2.changeBeats != null ? changeBeatsOf({ changeBeats: d2.changeBeats, transition: d2.transition }) : 0;
  const ghostsOf = (feed: Feed, v: StateView): (number | null)[] => {
    const groups = cameraGroups(v.entries.map(toReplayEntry));
    // The unfitted landing of each block, matched to the with-rendezvous strip by slot.
    const bySlot = new Map(without[feed].frames.map((f) => [f.slot, f]));
    return withR[feed].frames.map((f) => {
      const u = bySlot.get(f.slot);
      if (!u || u.webcamId == null || beatMs === 0) return null;
      const peak = peakOf(groups.get(u.webcamId) ?? []);
      if (!peak) return null;
      const i = u.shownSnapshotIds.indexOf(peak.snapshotId);
      return i < 0 ? null : u.shownAt + (change + i) * beatMs;
    });
  };
  return {
    sunrise: withR.sunrise.frames, sunset: withR.sunset.frames,
    landings: withR.rendezvous.landings, counts: withR.rendezvous,
    ghosts: { sunrise: ghostsOf('sunrise', input.sunrise), sunset: ghostsOf('sunset', input.sunset) },
  };
}
