import type { BinEntry } from '@/app/lib/solo/types';
import type { RunShape } from './types';

/**
 * The camera run (camera-run spec §3): in solo2 a camera's frames are one
 * item in the bin, and a dwell plays them oldest to newest. Pure over
 * whatever entries the caller holds; no query, no clock.
 */

/** A frame with, when known, the moment it was taken. Engine fixtures carry only `enteredAt`. */
export type RunEntry = BinEntry & { capturedAt?: number };

export const takenAt = (e: RunEntry): number => e.capturedAt ?? e.enteredAt;

/** Oldest first, then id, so two frames of one minute have one order everywhere. */
export function compareCapture(a: RunEntry, b: RunEntry): number {
  return takenAt(a) - takenAt(b) || a.snapshotId - b.snapshotId;
}

/** Every camera's frames, oldest first. */
export function cameraGroups<T extends RunEntry>(entries: T[]): Map<number, T[]> {
  const out = new Map<number, T[]>();
  for (const e of entries) {
    const list = out.get(e.webcamId);
    if (list) list.push(e); else out.set(e.webcamId, [e]);
  }
  for (const list of out.values()) list.sort(compareCapture);
  return out;
}

const scoreOf = (e: BinEntry) => (e.bin === 'sunset' ? e.quality ?? -1 : e.detection);

/**
 * The one entry that stands for a camera in the rules (§3.1): the newest
 * frame's identity, with the bin of the best frame, the best quality and
 * detection, the most showings, the latest showing, and new if any is.
 */
export function representative<T extends RunEntry>(frames: T[]): T {
  const newest = frames[frames.length - 1];
  const best = frames.reduce((a, b) => (scoreOf(b) > scoreOf(a) ? b : a), frames[0]);
  const max = (xs: (number | null | undefined)[]) => {
    const nums = xs.filter((x): x is number => typeof x === 'number');
    return nums.length ? Math.max(...nums) : null;
  };
  return {
    ...newest,
    bin: best.bin,
    quality: max(frames.map((f) => f.quality)),
    detection: max(frames.map((f) => f.detection)) ?? newest.detection,
    tally: max(frames.map((f) => f.tally)) ?? 0,
    lastShownAt: max(frames.map((f) => f.lastShownAt)),
    isNew: frames.some((f) => f.isNew),
  };
}

/** One synthetic entry per camera when the dial is on; every frame for itself when off. */
export function poolEntries<T extends RunEntry>(entries: T[], cameraRun: boolean): T[] {
  if (!cameraRun) return entries;
  return [...cameraGroups(entries).values()].map(representative);
}

/**
 * What a dwell of `entry` plays (§3.2): its camera's frames taken at or
 * before it, oldest first, `entry` last. `[entry]` when the dial is off.
 *
 * `cap` bounds the run (dwell-budget spec §4). When a camera has more frames
 * than the cap allows, the run plays the NEWEST `cap` of them — the window
 * sits against the chosen frame. Playback order is unchanged and
 * non-negotiable: oldest to newest, so the sun goes down. "Newest" selects
 * the window, not the direction. Taking the oldest instead would play frames
 * from hours earlier and then cut to the chosen one, and at high latitude
 * that window could be broad daylight.
 */
export function runOf<T extends RunEntry>(
  entry: T, entries: T[], cameraRun: boolean, cap = Number.POSITIVE_INFINITY,
): T[] {
  if (!cameraRun) return [entry];
  const earlier = entries
    .filter((e) => e.webcamId === entry.webcamId && e.snapshotId !== entry.snapshotId && compareCapture(e, entry) < 0)
    .sort(compareCapture);
  const keep = Math.max(1, Math.floor(cap)) - 1; // the chosen frame takes one place
  return [...earlier.slice(Math.max(0, earlier.length - keep)), entry];
}

export interface CapDials {
  runFramesSunset: number;
  runFramesOther: number;
  runShape?: RunShape;
}

/** Where a draw stands for the shaping rules: 1 for any sunset when the shape is flat, else its rank; 0 for a non-sunset. */
function standing<T extends RunEntry>(e: Pick<BinEntry, 'bin'> & Partial<T>, d: CapDials, entries: T[] | undefined, cameraRun: boolean): number {
  if (e.bin !== 'sunset') return 0;
  if (d.runShape !== 'rank' || !entries || e.webcamId === undefined) return 1;
  return qualityRank(e as T, entries, cameraRun);
}

/**
 * The entry the shaping rules must read for `e`: with the camera run on, the
 * camera's representative — the very entry `next2` chose the camera by.
 *
 * The rules see one synthetic entry per camera (`poolEntries`), and
 * `representative` stamps it with the BEST frame's bin and quality, so a
 * camera qualifies as a sunset if any of its frames is one. But `next2` then
 * returns the raw newest frame, because a draw has to name a real snapshot.
 * Reading the bin off that frame meant a camera was CHOSEN on its best picture
 * and SIZED on its newest: one snapshot landing the wrong side of the
 * detection threshold dropped the run from up to sixteen frames to five and the
 * budget to the dial less the trim. Measured 2026-09-08, 30 of 38 draws logged
 * non-sunset were of cameras still holding sunset frames — Stromness had 13 of
 * 23 and ran five.
 *
 * Resolving it here rather than at the call sites is deliberate: six surfaces
 * call `capFor`/`budgetS`, and a rule each of them has to remember is a rule
 * that drifts.
 *
 * Falls back to `e` when the run is off, when there is nothing to group
 * against, or when `e` carries no camera — the same three guards `standing`
 * already uses to decide there is nothing to rank.
 */
export function standsFor<T extends RunEntry>(
  e: Pick<BinEntry, 'bin'> & Partial<T>, entries: T[] | undefined, cameraRun: boolean,
): Pick<BinEntry, 'bin'> & Partial<T> {
  if (!cameraRun || !entries || e.webcamId === undefined) return e;
  return poolEntries(entries.filter((x) => x.webcamId === e.webcamId), cameraRun)[0] ?? e;
}

/** The two ends the budget swings between, as dial fields; both optional so older callers read as the dial. */
export interface BudgetDials { dwellS: number; dwellBoost?: number; dwellTrim?: number }

/**
 * The dwell budget for a draw of `e`, seconds (the `dwellS` the budget rule
 * of the dwell-budget spec §3 then shares among the run's frames). A
 * non-sunset, and the weakest sunset present, hold the dial less the trim;
 * the strongest sunset present holds the dial plus the boost; sunsets
 * between sit by rank. Two dials rather than one spread so the top and the
 * bottom can be set apart: how long the best may run and how short a grey
 * frame may get are different worries. The same shape as the frame cap,
 * applied to the clock, so a lone frame with no run to lengthen still
 * feels the difference.
 *
 * Read off the camera, not off the drawn frame (`standsFor`).
 */
export function budgetS<T extends RunEntry>(
  e: Pick<BinEntry, 'bin'> & Partial<T>, d: CapDials & BudgetDials, entries?: T[], cameraRun = true,
): number {
  const boost = (d.dwellBoost ?? 0) / 100;
  const trim = (d.dwellTrim ?? 0) / 100;
  if (boost === 0 && trim === 0) return d.dwellS;
  const stands = standsFor(e, entries, cameraRun);
  const rank = stands.bin === 'sunset' ? standing(stands, d, entries, cameraRun) : 0;
  return d.dwellS * (1 - trim + (trim + boost) * rank);
}

/** `d` with its dwell replaced by the draw's budget, ready for fitPlan. */
export function planDialsFor<T extends RunEntry, D extends CapDials & BudgetDials>(
  e: Pick<BinEntry, 'bin'> & Partial<T>, d: D, entries?: T[], cameraRun = true,
): D {
  return { ...d, dwellS: budgetS(e, d, entries, cameraRun) };
}

/**
 * Where this camera's best frame stands among the sunsets in the pool, 0 for
 * the weakest present to 1 for the strongest. A lone sunset is the best
 * available, so it ranks 1. Cameras are ranked, not frames: with the run
 * dial on, a camera holding eighteen frames of one evening would otherwise
 * fill the ranking with itself.
 */
export function qualityRank<T extends RunEntry>(e: T, entries: T[], cameraRun: boolean): number {
  const q = (x: BinEntry) => x.quality ?? -1;
  const peers = poolEntries(entries, cameraRun).filter((x) => x.bin === 'sunset');
  const mine = poolEntries(entries.filter((x) => x.webcamId === e.webcamId), cameraRun)[0] ?? e;
  if (peers.length <= 1) return 1;
  const below = peers.filter((x) => x.webcamId !== mine.webcamId && q(x) < q(mine)).length;
  return below / (peers.length - 1);
}

/**
 * The frame cap for a draw of `e` (spec §4). A non-sunset always gets the
 * non-sunset cap. A sunset gets the sunset cap when the shape is flat, and
 * when it is by rank, a run between the two caps in proportion to where the
 * camera stands among the sunsets present: the best sunset on offer plays
 * the whole cap, the weakest plays no longer than a non-sunset, and the
 * middle sits between. So the peak buys screen time and a grey sunset gives
 * it back, and both are measured against what is actually available rather
 * than a fixed number the model's scale could drift away from.
 *
 * Without `entries` there is nothing to rank against, and the cap is flat.
 *
 * The bin is read off the camera, not off the drawn frame (`standsFor`): a run
 * is a camera's frames, so the cap on it is a fact about the camera.
 */
export function capFor<T extends RunEntry>(
  e: Pick<BinEntry, 'bin'> & Partial<T>, d: CapDials, entries?: T[], cameraRun = true,
): number {
  const stands = standsFor(e, entries, cameraRun);
  if (stands.bin !== 'sunset') return d.runFramesOther;
  const lo = Math.min(d.runFramesOther, d.runFramesSunset);
  return Math.round(lo + (d.runFramesSunset - lo) * standing(stands, d, entries, cameraRun));
}
