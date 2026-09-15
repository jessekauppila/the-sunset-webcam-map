import { cameraGroups, capFor, compareCapture, qualityRank, runOf, type RunEntry } from './run';
import type { Role, Solo2Dials } from './types';

/**
 * The rendezvous (beat-and-rendezvous spec §3): both screens land on their
 * best frame on the same tick. Pure: no clock, no I/O. The server calls
 * `fitNext` once per advance with its own side and the other screen's
 * pinned peak; the replay calls it the same way over recorded pools. The
 * count of frames is the only knob — a peak moves one beat for every frame
 * dropped ahead of it or added ahead of it; nothing holds, nothing changes
 * rate (§3.5).
 */

/**
 * `Solo2Dials` does not yet carry `rendezvous`/`rendezvousRank` (Task 5 adds
 * them), so they are added here explicitly until then.
 */
export type RendezvousDials = Pick<Solo2Dials,
  'beatS' | 'changeBeats' | 'transition' | 'cameraRun' | 'runFramesSunset' | 'runFramesOther' | 'runShape'> & {
  rendezvous: boolean;
  rendezvousRank: number;
};

const q = (e: RunEntry) => (e.bin === 'sunset' && e.quality != null ? e.quality : -1);

/** The room a cap leaves besides the one frame it always holds (the peak, or `runOf`'s chosen frame). */
const roomOf = (cap: number) => Math.max(1, Math.floor(cap)) - 1;

/**
 * The best-rated sunset frame of a series, or null when it has none. Ties go
 * to the earlier frame — scans in capture order regardless of the array's
 * own order, so the guarantee holds for any caller, not just one that
 * happens to pass a capture-sorted series.
 */
export function peakOf<T extends RunEntry>(series: T[]): T | null {
  let best: T | null = null;
  for (const e of series.slice().sort(compareCapture)) if (q(e) >= 0 && (best === null || q(e) > q(best))) best = e;
  return best;
}

/**
 * `before` frames of the climb, keeping the one nearest the peak and
 * spreading the rest evenly (§3.5): keep index
 * round((P − 1) − j · (P − 1) / (before − 1)), j = 0 … before − 1.
 */
export function thinClimb<T>(climb: T[], before: number): { kept: T[]; dropped: T[] } {
  const P = climb.length;
  const n = Math.max(0, Math.min(P, Math.floor(before)));
  if (n >= P) return { kept: climb.slice(), dropped: [] };
  const keep = new Set<number>();
  if (n === 1) keep.add(P - 1);
  else for (let j = 0; j < n; j++) keep.add(Math.round((P - 1) - (j * (P - 1)) / (n - 1)));
  return { kept: climb.filter((_, i) => keep.has(i)), dropped: climb.filter((_, i) => !keep.has(i)) };
}

/**
 * The window around the peak (§3.6): `before` frames ahead of it, the peak,
 * then what the cap leaves after it. Without `before` the climb comes first:
 * the newest `cap − 1` of it, and the remainder goes after the peak. The
 * peak always plays.
 */
export function windowAround<T extends RunEntry>(series: T[], peak: T, cap: number, before?: number): { frames: T[]; dropped: T[] } {
  const sorted = series.slice().sort(compareCapture);
  const p = sorted.findIndex((e) => e.snapshotId === peak.snapshotId);
  const climb = sorted.slice(0, Math.max(0, p));
  const after = sorted.slice(p + 1);
  const room = roomOf(cap);
  const b = Math.max(0, Math.min(climb.length, room, before ?? room));
  // The default takes the NEWEST b of the climb (nothing dropped from inside
  // it); an explicit before thins the whole climb evenly.
  const climbPart = before === undefined
    ? { kept: climb.slice(climb.length - b), dropped: [] as T[] }
    : thinClimb(climb, b);
  const a = Math.max(0, Math.min(after.length, room - climbPart.kept.length));
  return { frames: [...climbPart.kept, sorted[p], ...after.slice(0, a)], dropped: climbPart.dropped };
}

export interface MySide<T extends RunEntry> {
  /** The tick this draw would start on: the previous dwell's end. */
  t0Ms: number;
  /** The engine's pick (the camera's newest frame). */
  pick: T;
  /** This screen's whole pool. */
  entries: T[];
  /** The rhythm role of this draw; a valley is never eligible. */
  role: Role;
  /** The dwell that is ending on this screen, if any: its camera and the last frame it played. */
  ending: { webcamId: number; lastShownId: number } | null;
}

export interface TheirSide {
  /** The other screen's pinned landing, ms, or null. */
  peakAtMs: number | null;
}

export type Decision<T> =
  | { kind: 'plain'; frames: T[]; dropped: T[]; peakAtMs: null }
  | { kind: 'pin'; frames: T[]; dropped: T[]; peakAtMs: number }
  | { kind: 'fit'; frames: T[]; dropped: T[]; peakAtMs: number }
  /** Do not draw yet: extend the ending dwell by these frames of its own camera, in order. */
  | { kind: 'grow'; add: T[] }
  | { kind: 'nofit'; why: 'too soon' | 'nothing to add'; frames: T[]; dropped: T[]; peakAtMs: null };

const changeBeats = (d: RendezvousDials) => (d.transition === 'cut' ? 0 : Math.max(0, Math.floor(d.changeBeats)));

/**
 * The greedy fit (§3.4), one seam for the search version to replace later
 * (§3.9): whoever draws first pins, the other fits.
 */
export function fitNext<T extends RunEntry>(mine: MySide<T>, theirs: TheirSide, d: RendezvousDials): Decision<T> {
  const series = cameraGroups(mine.entries).get(mine.pick.webcamId) ?? [mine.pick];
  const cap = capFor(mine.pick, d, mine.entries, d.cameraRun);
  const peak = peakOf(series);
  const plain = (): Decision<T> => ({ kind: 'plain', frames: runOf(mine.pick, mine.entries, d.cameraRun, cap), dropped: [], peakAtMs: null });
  const eligible = d.rendezvous && mine.role === 'peak' && peak !== null && d.cameraRun
    && qualityRank(mine.pick, mine.entries, d.cameraRun) >= d.rendezvousRank;
  if (!eligible || peak === null) return plain();

  const beatMs = d.beatS * 1000;
  const change = changeBeats(d);
  const climbMax = Math.min(series.slice().sort(compareCapture).findIndex((e) => e.snapshotId === peak.snapshotId), roomOf(cap));
  const landing = (before: number) => mine.t0Ms + (change + before) * beatMs;

  const T = theirs.peakAtMs;
  if (T == null) {
    const w = windowAround(series, peak, cap);
    return { kind: 'pin', frames: w.frames, dropped: w.dropped, peakAtMs: landing(w.frames.findIndex((e) => e.snapshotId === peak.snapshotId)) };
  }
  const avail = Math.round((T - mine.t0Ms) / beatMs) - change;
  if (avail < 0 || (T - mine.t0Ms) % beatMs !== 0) {
    const w = windowAround(series, peak, cap);
    return { kind: 'nofit', why: 'too soon', frames: w.frames, dropped: w.dropped, peakAtMs: null };
  }
  if (avail <= climbMax) {
    const w = windowAround(series, peak, cap, avail);
    return { kind: 'fit', frames: w.frames, dropped: w.dropped, peakAtMs: T };
  }
  // The climb is too short: grow the run that is ending, from its own night.
  const need = avail - climbMax;
  if (mine.ending) {
    const theirSeries = (cameraGroups(mine.entries).get(mine.ending.webcamId) ?? []).slice().sort(compareCapture);
    const last = theirSeries.findIndex((e) => e.snapshotId === mine.ending!.lastShownId);
    const add = last >= 0 ? theirSeries.slice(last + 1, last + 1 + need) : [];
    if (add.length === need) return { kind: 'grow', add };
  }
  const w = windowAround(series, peak, cap);
  return { kind: 'nofit', why: 'nothing to add', frames: w.frames, dropped: w.dropped, peakAtMs: null };
}
