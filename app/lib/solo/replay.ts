import { afterShowing } from './engine';

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
  /** When this dwell's peak landed (rendezvous spec §3.3); null off the dial and for rows written before the migration. */
  peakAtMs?: number | null;
  /** True only when this dwell's landing was fitted to the other screen's peak. */
  rendezvous?: boolean;
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
  /**
   * How long this block holds the glass. Replayed blocks carry what
   * `version.dwellMs` said; actual blocks carry the measured gap to the next
   * draw, or null for the last one, which has nothing to measure against.
   */
  dwellMs: number | null;
  /**
   * When this block's peak lands, ms (rendezvous spec §3.3): the tick this
   * screen pinned for the other one, or the one it fitted itself to. Null
   * for a block that neither pinned nor fitted.
   */
  peakAtMs: number | null;
  /** This block's landing was fitted to the other screen's pinned peak. */
  rendezvous: boolean;
  /** Frames the fit dropped from this block's climb to make it land on the tick. */
  dropped: number;
  /** Frames a later grow added to this block so the OTHER screen's landing could be met. */
  grown: number;
}

/**
 * What a strip was drawn with. `dwellS` is the nominal dial, not a grid: a
 * dwell is a budget its frames share, so each block carries its own length
 * and only a blank falls back to the nominal one.
 */
export interface Schedule {
  dwellS: number;
}

export interface Strip {
  feed: Feed;
  /** The engine that drew, or 'actual' for the fact strip. */
  version: string;
  schedule: Schedule;
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
  // The draw log is the history of draw NUMBERS once slot is a counter, and
  // is already authoritative today (spec §6.1.1).
  const loggedSlot = new Map<number, number>();
  const tally = new Map<number, number>();
  for (const d of priorDraws) {
    for (const id of d.shownSnapshotIds?.length ? d.shownSnapshotIds : [d.snapshotId]) {
      shownAt.set(id, Math.max(shownAt.get(id) ?? -Infinity, d.shownAt));
      loggedSlot.set(id, Math.max(loggedSlot.get(id) ?? -Infinity, d.slot));
      tally.set(id, (tally.get(id) ?? 0) + 1);
    }
  }
  return entries.map((e) => {
    const logged = shownAt.get(e.snapshotId);
    if (logged != null) {
      return { ...e, tally: tally.get(e.snapshotId) ?? 0, lastShownAt: logged, lastShownSlot: loggedSlot.get(e.snapshotId) ?? null, isNew: false };
    }
    const first = e.firstShownAt ?? null;
    if (first != null && first < windowStart) {
      const last = e.lastShownAt != null && e.lastShownAt < windowStart ? e.lastShownAt : first;
      // No draw row, so no draw number to seed rest with. The timestamp
      // cannot supply one (spec §6.1), so rest starts clean for this frame.
      return { ...e, tally: Math.max(1, e.tally), lastShownAt: last, lastShownSlot: null, isNew: false };
    }
    return { ...e, tally: 0, lastShownAt: null, lastShownSlot: null, isNew: isNewAtEntry(e, entries) };
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

const blank = (slot: number, shownAt: number, dwellMs: number | null): StripFrame => ({
  slot, shownAt, snapshotId: null, webcamId: null, bin: null, quality: null, detection: null,
  title: '', imageUrl: '', capturedAt: null, shownSnapshotIds: [], repeat: false, dwellMs,
  peakAtMs: null, rendezvous: false, dropped: 0, grown: 0,
});

/** The rendezvous stamp on a block; absent for every strip that has no rendezvous. */
interface Landed { peakAtMs?: number | null; rendezvous?: boolean; dropped?: number; grown?: number }

function frameOf(
  e: FrameFacts, slot: number, shownAt: number, shownIds: number[], repeat: boolean, dwellMs: number | null,
  landed: Landed = {},
): StripFrame {
  return {
    slot, shownAt, snapshotId: e.snapshotId, webcamId: e.webcamId, bin: e.bin,
    quality: e.quality, detection: e.detection, title: e.title ?? '', imageUrl: e.imageUrl ?? '',
    capturedAt: e.capturedAt ?? null, shownSnapshotIds: shownIds, repeat, dwellMs,
    peakAtMs: landed.peakAtMs ?? null, rendezvous: landed.rendezvous ?? false,
    dropped: landed.dropped ?? 0, grown: landed.grown ?? 0,
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
 * Re-run the engine from `fromMs` to `toMs`, walking a clock rather than a
 * grid. Each draw sees the pool as it was at that instant and the shown
 * state the replay itself has built, so this is what the glass would have
 * shown had these dials been live, given the same arrivals and departures.
 *
 * The clock is the whole change from the grid version: a slot is a counter
 * now and cannot be turned back into a time, so the loop asks
 * `version.dwellMs` what each draw costs and advances by that. solo answers
 * with the dial and so lands where the grid did; solo2 answers with the
 * budget its frames share, so a run of eight stretches the block.
 */
export function replay<D extends SoloDials>(o: ReplayOptions<D>): Strip {
  const screen = openScreen(o);
  while (screen.atMs <= o.toMs) stepOnce(screen);
  return stripOf(screen);
}

/** One screen mid-replay: its clock, its counter, its pool and what it has shown. */
interface Screen<D extends SoloDials> {
  o: ReplayOptions<D>;
  /** The entries carrying the shown state the replay itself has built. */
  working: ReplayEntry[];
  state: ScreenState;
  seen: Set<number>;
  frames: StripFrame[];
  slot: number;
  atMs: number;
}

function openScreen<D extends SoloDials>(o: ReplayOptions<D>): Screen<D> {
  return {
    o,
    working: seedFromDraws(o.entries, o.priorDraws, o.fromMs),
    state: initialState(o.priorDraws, o.entries),
    seen: new Set<number>(),
    frames: [],
    // The counter continues the recorded sequence rather than being derived
    // from fromMs, so `rest` compares against the same numbers the log holds.
    slot: (o.priorDraws.at(-1)?.slot ?? -1) + 1,
    atMs: o.fromMs,
  };
}

const stripOf = <D extends SoloDials>(s: Screen<D>): Strip => ({
  feed: s.o.feed, version: s.o.version.name, schedule: { dwellS: s.o.dials.dwellS },
  fromMs: s.o.fromMs, toMs: s.o.toMs, frames: s.frames,
});

/** Every frame a dwell played is on glass: it rests, it is no longer new, and it has a time and a draw number. */
function stampShown(frames: BinEntry[], atMs: number, slot: number): void {
  for (const f of frames) {
    f.tally += 1;
    f.isNew = false;
    f.lastShownAt = atMs;
    f.lastShownSlot = slot;
  }
}

/** What a draw does, once anything above the plain path has had its say. */
type StepDecision =
  | { kind: 'draw'; shown: BinEntry[]; lengthMs: number; peakAtMs: number | null; rendezvous: boolean; dropped: number }
  /** Do not draw: the dwell that is ending plays `add` more frames of its own camera, one beat each. */
  | { kind: 'grow'; add: BinEntry[]; addedMs: number };

/** The rendezvous seam, as one screen's step sees it. Only `replayPair` has one. */
type Decide<D extends SoloDials> = (s: Screen<D>, pool: ReplayEntry[], pick: BinEntry) => StepDecision;

/**
 * One step of one screen's clock — the body a single-feed replay and a
 * paired one share, so that the two cannot drift. Without `decide` this is
 * the plain path, byte for byte what the replay has always done; `decide`
 * lets the caller substitute the rendezvous's frames, length and stamp, or
 * say that the dwell already running should play on instead.
 */
function stepOnce<D extends SoloDials>(s: Screen<D>, decide?: Decide<D>): void {
  const { feed, version, dials } = s.o;
  const pool = poolAt(s.working, s.atMs);
  const pick = version.next(pool, dials, s.state, s.slot, feed);
  if (!pick) {
    // Nothing eligible, so nothing to ask a length of. A blank costs one
    // nominal dwell, which is what the glass waits while the bin is empty.
    const blankMs = dials.dwellS * 1000;
    s.frames.push(blank(s.slot, s.atMs, blankMs));
    s.atMs += blankMs;
    s.slot += 1;
    return;
  }
  const decision: StepDecision = decide?.(s, pool, pick) ?? {
    kind: 'draw',
    shown: version.shown(pool, pick, dials),
    lengthMs: version.dwellMs(pool, pick, dials),
    peakAtMs: null, rendezvous: false, dropped: 0,
  };
  if (decision.kind === 'grow') {
    // Keep going rather than draw (rendezvous spec §3.8): the block that is
    // ending gets longer and holds more frames, the counter does not move,
    // and this screen asks again at the new end.
    const prev = s.frames.at(-1)!;
    stampShown(decision.add, s.atMs, prev.slot);
    prev.shownSnapshotIds = [...prev.shownSnapshotIds, ...decision.add.map((f) => f.snapshotId)];
    prev.dwellMs = (prev.dwellMs ?? 0) + decision.addedMs;
    prev.grown += decision.add.length;
    s.atMs += decision.addedMs;
    return;
  }
  stampShown(decision.shown, s.atMs, s.slot);
  const chosen = s.working.find((e) => e.snapshotId === pick.snapshotId)!;
  s.frames.push(frameOf(
    chosen, s.slot, s.atMs, decision.shown.map((f) => f.snapshotId), s.seen.has(pick.snapshotId), decision.lengthMs,
    { peakAtMs: decision.peakAtMs, rendezvous: decision.rendezvous, dropped: decision.dropped },
  ));
  s.seen.add(pick.snapshotId);
  s.state = afterShowing(pick, s.state);
  s.atMs += decision.lengthMs;
  s.slot += 1;
}

export interface PairOptions<D extends SoloDials> {
  sunrise: ReplayOptions<D>;
  sunset: ReplayOptions<D>;
}

/** Where the two screens landed together: the tick, and the draw that was up on each. */
export interface Landing {
  atMs: number;
  sunriseSlot: number;
  sunsetSlot: number;
}

export interface RendezvousCounts {
  /** Fits: draws that thinned their climb to land on the other screen's pinned peak. */
  made: number;
  /** Pins that passed unmet: the pinning screen drew again with nothing having fitted to it. */
  missed: number;
  /** Frames the fits dropped from their climbs. */
  dropped: number;
  /** Frames the grows added to dwells that were ending. */
  grown: number;
  landings: Landing[];
}

export interface PairResult {
  sunrise: Strip;
  sunset: Strip;
  rendezvous: RendezvousCounts;
}

/**
 * One beat, ms. A version with a rendezvous prices a grown frame in beats
 * (rendezvous spec §3.5) and so carries the dial; a version without one
 * never grows, and the fallback is only there so this cannot throw.
 */
const beatMsOf = (d: SoloDials): number => {
  const beatS = (d as SoloDials & { beatS?: number }).beatS;
  return (typeof beatS === 'number' && beatS > 0 ? beatS : d.dwellS) * 1000;
};

const otherFeed = (f: Feed): Feed => (f === 'sunrise' ? 'sunset' : 'sunrise');

/**
 * Both screens over one window (rendezvous spec §5). Two clocks, one per
 * feed, each with its own pool, counter and shown state; whichever is
 * earlier draws next, so a dwell on one screen is decided against the peak
 * the other has already pinned — the same single number the two screens pass
 * each other on glass, and nothing else.
 *
 * The pin is held here rather than on the strip because it is state BETWEEN
 * the screens: a pin outlives the draw that made it, is cleared by the
 * pinning screen's next draw, and is met at most once. Counting a miss needs
 * exactly that: was this pin still outstanding when its own screen moved on.
 */
export function replayPair<D extends SoloDials>(o: PairOptions<D>): PairResult {
  const screens: Record<Feed, Screen<D>> = { sunrise: openScreen(o.sunrise), sunset: openScreen(o.sunset) };
  /** The landing each screen has published, and whether the other one met it. */
  const pins: Record<Feed, { atMs: number; matched: boolean } | null> = { sunrise: null, sunset: null };
  const counts: RendezvousCounts = { made: 0, missed: 0, dropped: 0, grown: 0, landings: [] };

  const decideFor = (side: Feed): Decide<D> => (s, pool, pick) => {
    const { version, dials } = s.o;
    const plain: StepDecision = {
      kind: 'draw',
      shown: version.shown(pool, pick, dials),
      lengthMs: version.dwellMs(pool, pick, dials),
      peakAtMs: null, rendezvous: false, dropped: 0,
    };
    if (!version.fitNext || !version.dwellMsFor) return plain;
    // The block that is ending on THIS screen, so a fit needing more room
    // than its climb has can ask that block to play on. Found by the last
    // frame PLAYED, not the frame drawn: a grown block ends on a frame its
    // own draw never named.
    const last = s.frames.at(-1);
    const ending = last && last.snapshotId != null && last.webcamId != null
      ? { webcamId: last.webcamId, lastShownId: last.shownSnapshotIds.at(-1) ?? last.snapshotId }
      : null;
    // The other screen's landing, and only while it is still ahead of the
    // tick this draw starts on: one already past is nothing to meet.
    const theirs = pins[otherFeed(side)];
    const dec = version.fitNext<ReplayEntry>(
      { t0Ms: s.atMs, pick: pick as ReplayEntry, entries: pool, role: version.roleAt(s.slot, s.o.feed, dials), ending },
      { peakAtMs: theirs && theirs.atMs > s.atMs ? theirs.atMs : null },
      dials,
    );
    if (dec.kind === 'grow') {
      // A grow that adds nothing would leave the clock where it is and the
      // loop would never end. fitNext never returns one; this says so aloud.
      if (dec.add.length === 0 || s.frames.length === 0) return plain;
      counts.grown += dec.add.length;
      return { kind: 'grow', add: dec.add, addedMs: dec.add.length * beatMsOf(dials) };
    }
    // This screen is drawing, so a pin of its own that nothing met has passed.
    const mine = pins[side];
    if (mine && !mine.matched) counts.missed += 1;
    if (dec.kind === 'fit') {
      counts.made += 1;
      counts.dropped += dec.dropped.length;
      if (theirs) theirs.matched = true;
      const other = screens[otherFeed(side)];
      // The fitting screen lands on the draw it is about to make; the other
      // one lands inside the block already on its glass.
      const theirSlot = other.frames.at(-1)?.slot ?? other.slot;
      counts.landings.push({
        atMs: dec.peakAtMs,
        sunriseSlot: side === 'sunrise' ? s.slot : theirSlot,
        sunsetSlot: side === 'sunset' ? s.slot : theirSlot,
      });
    }
    pins[side] = dec.kind === 'pin' ? { atMs: dec.peakAtMs, matched: false } : null;
    return {
      kind: 'draw',
      shown: dec.frames,
      lengthMs: version.dwellMsFor(pool, pick, dials, dec.frames.length),
      peakAtMs: dec.peakAtMs,
      rendezvous: dec.kind === 'fit',
      dropped: dec.dropped.length,
    };
  };

  for (;;) {
    const due = (['sunrise', 'sunset'] as Feed[]).filter((f) => screens[f].atMs <= screens[f].o.toMs);
    if (due.length === 0) break;
    // Whichever clock is earlier draws next; a tie goes to sunrise.
    const side = due.reduce((a, b) => (screens[b].atMs < screens[a].atMs ? b : a));
    const s = screens[side];
    // Both clocks live on the one beat grid, which is what makes a landing a
    // whole number of beats away (spec §3.5). Idempotent after the first
    // step: every dwell and every blank is whole beats.
    s.atMs = s.o.version.startMs(s.atMs, s.o.dials);
    stepOnce(s, decideFor(side));
  }
  return { sunrise: stripOf(screens.sunrise), sunset: stripOf(screens.sunset), rendezvous: counts };
}

/**
 * The fact strip, from the draw log. Each block's length is MEASURED from
 * the next draw's time, never computed from a dwell rule: under a budget the
 * rule and the record disagree for any run past the floor's threshold, by up
 * to 2.4x on the runs already recorded. The last block has nothing after it
 * to measure against, so its length is null rather than guessed.
 */
export function actualStrip(
  feed: Feed, draws: (DrawLike & FrameFacts)[], schedule: Schedule, fromMs: number, toMs: number,
): Strip {
  const seen = new Set<number>();
  const frames = draws.map((d, i) => {
    const next = draws[i + 1];
    const f = frameOf(
      d, d.slot, d.shownAt, d.shownSnapshotIds?.length ? d.shownSnapshotIds : [d.snapshotId],
      seen.has(d.snapshotId), next ? next.shownAt - d.shownAt : null,
      // The fact strip reads the landing off the record; the counts are a
      // replay's own arithmetic and are not recoverable from a draw row.
      { peakAtMs: d.peakAtMs ?? null, rendezvous: d.rendezvous ?? false },
    );
    seen.add(d.snapshotId);
    return f;
  });
  return { feed, version: 'actual', schedule, fromMs, toMs, frames };
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
 * Agreement between two strips of one screen: `same` is draw-for-draw (a
 * draw the glass missed shifts everything after it, so this reads low even
 * when the order is right); `inOrder` is the longest run of draws both
 * strips make in the same order, which survives that shift. Null for two
 * different screens, whose counters are independent of each other.
 */
export function compare(a: Strip, b: Strip): { slots: number; same: number; inOrder: number } | null {
  // Slots are counters, so slot n means "the nth draw" in both strips and is
  // comparable whatever the dwells were. The old guard refused on a differing
  // grid because a slot then meant a time; there is no such thing to protect
  // now. Two feeds are still not comparable: their counters are independent.
  if (a.feed !== b.feed) return null;
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
