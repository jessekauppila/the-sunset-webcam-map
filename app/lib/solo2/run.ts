import type { BinEntry } from '@/app/lib/solo/types';

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
 */
export function runOf<T extends RunEntry>(entry: T, entries: T[], cameraRun: boolean): T[] {
  if (!cameraRun) return [entry];
  const earlier = entries
    .filter((e) => e.webcamId === entry.webcamId && e.snapshotId !== entry.snapshotId && compareCapture(e, entry) < 0)
    .sort(compareCapture);
  return [...earlier, entry];
}
