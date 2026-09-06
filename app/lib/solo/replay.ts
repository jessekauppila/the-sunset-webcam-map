import { afterShowing } from './engine';
import { boundaryMs, slotFor } from './schedule';
import type { BinEntry, BinKind, Feed, ScreenState, SoloDials } from './types';
import type { SoloVersionSpec } from './versions';

/**
 * The replay (spec docs/superpowers/specs/2026-09-06-solo-replay-design.md
 * §4): re-run a version's engine over the pool the glass actually had,
 * under any dials, and shape the result like the studio's tape. Pure: no
 * I/O, no clock. The store supplies bin rows with `removedAt` and the draw
 * log; this module rebuilds the shown state from the draws rather than
 * trusting the rows, which hold today's values.
 */

/** An entry plus what a strip block shows of it. `StoredEntry` satisfies this. */
export interface FrameFacts extends BinEntry {
  capturedAt?: number;
  title?: string;
  imageUrl?: string;
}

/** A bin row as the replay needs it. `StoredEntry & { removedAt }` satisfies this. */
export interface ReplayEntry extends FrameFacts {
  /** When the row left the bin, ms since epoch; null while it is still in. */
  removedAt: number | null;
  /** The row's own record of its first showing, for draws older than the log. */
  firstShownAt?: number | null;
}

/** One logged draw, as much of it as the replay reads. `DrawRecord` satisfies this. */
export interface DrawLike {
  slot: number;
  shownAt: number;
  snapshotId: number;
  /** Every frame the dwell played; defaults to the drawn frame alone. */
  shownSnapshotIds?: number[];
  bin?: BinKind | null;
}

/** A block on a strip: a draw, actual or replayed. `snapshotId` null is a blank (nothing eligible). */
export interface StripFrame {
  slot: number;
  shownAt: number;
  snapshotId: number | null;
  webcamId: number | null;
  bin: BinKind | null;
  quality: number | null;
  detection: number | null;
  title: string;
  imageUrl: string;
  capturedAt: number | null;
  shownSnapshotIds: number[];
  /** Seen earlier on this strip. */
  repeat: boolean;
}

/** The slot grid a strip was drawn on; strips compare only on the same grid. */
export interface Grid {
  dwellS: number;
  offsetS: number;
}

export interface Strip {
  feed: Feed;
  /** The engine that drew, or 'actual' for the fact strip. */
  version: string;
  grid: Grid;
  fromMs: number;
  toMs: number;
  frames: StripFrame[];
}

/** Entries in the bin at `tMs`: entered on or before, not yet removed. */
export function poolAt<T extends ReplayEntry>(entries: T[], tMs: number): T[] {
  return entries.filter((e) => e.enteredAt <= tMs && (e.removedAt == null || e.removedAt > tMs));
}

/**
 * The admission rule for `isNew`: another frame of the same camera was in
 * the bin when this one arrived (binAdmission.ts `activeByFeed`).
 */
export function isNewAtEntry(entry: ReplayEntry, entries: ReplayEntry[]): boolean {
  return entries.some((o) =>
    o !== entry && o.snapshotId !== entry.snapshotId && o.webcamId === entry.webcamId &&
    o.enteredAt < entry.enteredAt && (o.removedAt == null || o.removedAt > entry.enteredAt));
}

/**
 * Rebuild the shown state as it stood at `windowStart`, after `priorDraws`:
 * tally, last shown and isNew come from the draws, not from the rows.
 * A row the log never saw drawn but whose own `firstShownAt` is before the
 * window was shown before the log began (the log is younger than the bins,
 * or was pruned); it is seeded from the row's record, which is exact when
 * its `lastShownAt` is also before the window and a lower bound otherwise.
 * Bins expire at 24 h, so a 24 h lookback of draws makes the fallback moot
 * once the log is a day old. Returns copies; the inputs are never mutated.
 */
export function seedFromDraws<T extends ReplayEntry>(entries: T[], priorDraws: DrawLike[], windowStart = -Infinity): T[] {
  const shownAt = new Map<number, number>();
  const tally = new Map<number, number>();
  for (const d of priorDraws) {
    for (const id of d.shownSnapshotIds?.length ? d.shownSnapshotIds : [d.snapshotId]) {
      shownAt.set(id, Math.max(shownAt.get(id) ?? -Infinity, d.shownAt));
      tally.set(id, (tally.get(id) ?? 0) + 1);
    }
  }
  return entries.map((e) => {
    const logged = shownAt.get(e.snapshotId);
    if (logged != null) {
      return { ...e, tally: tally.get(e.snapshotId) ?? 0, lastShownAt: logged, isNew: false };
    }
    const first = e.firstShownAt ?? null;
    if (first != null && first < windowStart) {
      const last = e.lastShownAt != null && e.lastShownAt < windowStart ? e.lastShownAt : first;
      return { ...e, tally: Math.max(1, e.tally), lastShownAt: last, isNew: false };
    }
    return { ...e, tally: 0, lastShownAt: null, isNew: isNewAtEntry(e, entries) };
  });
}

/** The screen's memory after `priorDraws`: the last frame, and how many sunsets ran up to it. */
export function initialState(priorDraws: DrawLike[], entries: ReplayEntry[]): ScreenState {
  const binOf = (d: DrawLike): BinKind | null =>
    d.bin ?? entries.find((e) => e.snapshotId === d.snapshotId)?.bin ?? null;
  let streak = 0;
  for (let i = priorDraws.length - 1; i >= 0 && binOf(priorDraws[i]) === 'sunset'; i--) streak++;
  return { lastSnapshotId: priorDraws.at(-1)?.snapshotId ?? null, sunsetStreak: streak };
}

const blank = (slot: number, shownAt: number): StripFrame => ({
  slot, shownAt, snapshotId: null, webcamId: null, bin: null, quality: null, detection: null,
  title: '', imageUrl: '', capturedAt: null, shownSnapshotIds: [], repeat: false,
});

function frameOf(e: FrameFacts, slot: number, shownAt: number, shownIds: number[], repeat: boolean): StripFrame {
  return {
    slot, shownAt, snapshotId: e.snapshotId, webcamId: e.webcamId, bin: e.bin,
    quality: e.quality, detection: e.detection, title: e.title ?? '', imageUrl: e.imageUrl ?? '',
    capturedAt: e.capturedAt ?? null, shownSnapshotIds: shownIds, repeat,
  };
}

export interface ReplayOptions<D extends SoloDials> {
  feed: Feed;
  version: SoloVersionSpec<D>;
  dials: D;
  /** Every bin row that overlapped the window (store.listEntriesOverlapping). */
  entries: ReplayEntry[];
  /** Draws before `fromMs`, oldest first, so rest and recency start true. */
  priorDraws: DrawLike[];
  fromMs: number;
  toMs: number;
}

/**
 * Re-run the engine from `fromMs` to `toMs` on the replay dials' grid. Each
 * slot sees the pool as it was at that slot's boundary and the shown state
 * the replay itself has built, so this is what the glass would have shown
 * had these dials been live, given the same arrivals and departures.
 */
export function replay<D extends SoloDials>(o: ReplayOptions<D>): Strip {
  const { feed, version, dials } = o;
  const grid = { dwellS: dials.dwellS, offsetS: dials.offsetS };
  const working = seedFromDraws(o.entries, o.priorDraws, o.fromMs);
  let state = initialState(o.priorDraws, o.entries);
  const seen = new Set<number>();
  const frames: StripFrame[] = [];
  const first = slotFor(o.fromMs, feed, grid.dwellS, grid.offsetS);
  const last = slotFor(o.toMs, feed, grid.dwellS, grid.offsetS);
  for (let slot = first; slot <= last; slot++) {
    const at = boundaryMs(slot, feed, grid.dwellS, grid.offsetS);
    const pool = poolAt(working, at);
    const pick = version.next(pool, dials, state, slot, feed);
    if (!pick) {
      frames.push(blank(slot, at));
      continue;
    }
    const shown = version.shown(pool, pick, dials);
    for (const f of shown) {
      f.tally += 1;
      f.isNew = false;
      f.lastShownAt = at;
    }
    const chosen = working.find((e) => e.snapshotId === pick.snapshotId)!;
    frames.push(frameOf(chosen, slot, at, shown.map((f) => f.snapshotId), seen.has(pick.snapshotId)));
    seen.add(pick.snapshotId);
    state = afterShowing(pick, state);
  }
  return { feed, version: version.name, grid, fromMs: o.fromMs, toMs: o.toMs, frames };
}

/** The fact strip, from the draw log, on the grid the glass was running. */
export function actualStrip(
  feed: Feed, draws: (DrawLike & FrameFacts)[], grid: Grid, fromMs: number, toMs: number,
): Strip {
  const seen = new Set<number>();
  const frames = draws.map((d) => {
    const f = frameOf(d, d.slot, d.shownAt, d.shownSnapshotIds?.length ? d.shownSnapshotIds : [d.snapshotId], seen.has(d.snapshotId));
    seen.add(d.snapshotId);
    return f;
  });
  return { feed, version: 'actual', grid, fromMs, toMs, frames };
}

export interface StripSummary {
  draws: number;
  blanks: number;
  distinctFrames: number;
  distinctCameras: number;
  repeats: number;
  /** Non-sunset draws over all draws, 0–1. */
  nonSunsetShare: number;
  /** Over sunset-bin draws; null when there were none. */
  meanQuality: number | null;
  minQuality: number | null;
  /** Sunset-bin draws by quality decile, [0,0.1) … [0.9,1]. */
  qualityHistogram: number[];
  /** Draws per camera, most first, top 8. */
  perCamera: { webcamId: number; title: string; draws: number }[];
}

export function summarize(strip: Strip): StripSummary {
  const drawn = strip.frames.filter((f) => f.snapshotId != null);
  const sunsets = drawn.filter((f) => f.bin === 'sunset' && f.quality != null);
  const hist = new Array<number>(10).fill(0);
  for (const f of sunsets) hist[Math.min(9, Math.max(0, Math.floor((f.quality as number) * 10)))] += 1;
  const perCam = new Map<number, { webcamId: number; title: string; draws: number }>();
  for (const f of drawn) {
    const id = f.webcamId as number;
    const row = perCam.get(id) ?? { webcamId: id, title: f.title, draws: 0 };
    row.draws += 1;
    perCam.set(id, row);
  }
  const qs = sunsets.map((f) => f.quality as number);
  return {
    draws: drawn.length,
    blanks: strip.frames.length - drawn.length,
    distinctFrames: new Set(drawn.map((f) => f.snapshotId)).size,
    distinctCameras: perCam.size,
    repeats: drawn.filter((f) => f.repeat).length,
    nonSunsetShare: drawn.length ? drawn.filter((f) => f.bin === 'non_sunset').length / drawn.length : 0,
    meanQuality: qs.length ? qs.reduce((a, b) => a + b, 0) / qs.length : null,
    minQuality: qs.length ? Math.min(...qs) : null,
    qualityHistogram: hist,
    perCamera: [...perCam.values()].sort((a, b) => b.draws - a.draws || a.webcamId - b.webcamId).slice(0, 8),
  };
}

/** Length of the longest common subsequence of two id sequences: how much of the order survives. */
function lcs(a: (number | null)[], b: (number | null)[]): number {
  let prev = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    const cur = new Array<number>(b.length + 1).fill(0);
    for (let j = 1; j <= b.length; j++) {
      cur[j] = a[i - 1] === b[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], cur[j - 1]);
    }
    prev = cur;
  }
  return prev[b.length];
}

/**
 * Agreement between two strips on the same grid: `same` is slot-for-slot
 * (a missed slot on the glass shifts everything after it, so this reads
 * low even when the order is right); `inOrder` is the longest run of draws
 * both strips make in the same order, which survives that shift. Null when
 * the grids differ, since their slots do not line up.
 */
export function compare(a: Strip, b: Strip): { slots: number; same: number; inOrder: number } | null {
  if (a.grid.dwellS !== b.grid.dwellS || a.grid.offsetS !== b.grid.offsetS) return null;
  const byB = new Map(b.frames.map((f) => [f.slot, f.snapshotId]));
  let slots = 0;
  let same = 0;
  for (const f of a.frames) {
    if (!byB.has(f.slot)) continue;
    slots++;
    if (byB.get(f.slot) === f.snapshotId) same++;
  }
  return { slots, same, inOrder: lcs(a.frames.map((f) => f.snapshotId), b.frames.map((f) => f.snapshotId)) };
}
