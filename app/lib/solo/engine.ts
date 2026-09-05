import { boundaryMs, slotFor } from './schedule';
import type { BinEntry, Feed, ScreenState, SoloDials } from './types';

/**
 * The solo kiosk's ordering rules, spec §4, as a pure function. No clock, no
 * I/O, no module state: memory across draws is the ScreenState argument, the
 * tally and lastShownAt live on the entries the caller passes in, and time
 * enters only as the slot being drawn. The studio runs `project()` with the
 * studio profile's dials to show what the glass will do; the advance
 * endpoint runs `next()` with the live profile's.
 */

/** Rule 3: a frame that arrived while its camera was already in the bin. */
export const NEW_FRAME_BONUS = 0.1;

/** Rule 5. */
export function isEligible(e: BinEntry, d: SoloDials): boolean {
  return e.bin === 'sunset'
    ? (e.quality ?? -1) >= d.qualityFloor
    : e.detection >= d.detectionFloor;
}

/**
 * Rule 2: a frame sits out `rest` draws after it was on glass, counted in
 * slots of the current dwell. Never shown → never resting.
 */
export function isResting(e: BinEntry, d: SoloDials, slot: number, feed: Feed): boolean {
  if (e.lastShownAt == null) return false;
  const shownSlot = slotFor(e.lastShownAt, feed, d.dwellS, d.offsetS);
  return slot - shownSlot <= d.rest;
}

/** Rule 3: quality for sunsets, detection for non-sunsets, plus the new-frame bonus. */
export function rankScore(e: BinEntry, d: SoloDials): number {
  const base = e.bin === 'sunset' ? (e.quality ?? 0) : e.detection;
  return base + (d.promoteNew && e.isNew ? NEW_FRAME_BONUS : 0);
}

/** Rule 3: least shown, then best, then earliest, then id. */
function compareWithin(d: SoloDials) {
  return (a: BinEntry, b: BinEntry): number =>
    a.tally - b.tally ||
    rankScore(b, d) - rankScore(a, d) ||
    a.enteredAt - b.enteredAt ||
    a.snapshotId - b.snapshotId;
}

/**
 * Rules 5, 4, 2 and 1, in that order: the frames the next draw may come
 * from. Eligible, not on glass, not resting; then one bin, chosen by the
 * sunset floor and the mix. If everything is resting, rest is waived for
 * this draw; if the frame on glass is the only eligible one, it repeats.
 * Empty only when nothing is eligible.
 */
export function choosePool(
  entries: BinEntry[], d: SoloDials, state: ScreenState, slot: number, feed: Feed,
): BinEntry[] {
  const eligible = entries.filter((e) => isEligible(e, d));
  const notOnGlass = eligible.filter((e) => e.snapshotId !== state.lastSnapshotId);
  let candidates = notOnGlass.filter((e) => !isResting(e, d, slot, feed));
  if (candidates.length === 0) candidates = notOnGlass;
  if (candidates.length === 0) candidates = eligible;
  if (candidates.length === 0) return [];

  const sunsets = candidates.filter((e) => e.bin === 'sunset');
  const nonSunsets = candidates.filter((e) => e.bin === 'non_sunset');
  if (sunsets.length === 0) return nonSunsets;
  if (nonSunsets.length === 0) return sunsets;
  if (sunsets.length >= d.sunsetFloor) return sunsets;
  return state.sunsetStreak >= d.mix ? nonSunsets : sunsets;
}

/** The next frame for one screen drawing at `slot`, or null when nothing is eligible. */
export function next(
  entries: BinEntry[], d: SoloDials, state: ScreenState, slot: number, feed: Feed,
): BinEntry | null {
  const pool = choosePool(entries, d, state, slot, feed);
  if (pool.length === 0) return null;
  return [...pool].sort(compareWithin(d))[0];
}

/** The screen's memory after `e` goes on glass. */
export function afterShowing(e: BinEntry, state: ScreenState): ScreenState {
  return {
    lastSnapshotId: e.snapshotId,
    sunsetStreak: e.bin === 'sunset' ? state.sunsetStreak + 1 : 0,
  };
}

/**
 * `n` draws forward from `state`, the first at `firstSlot`, each applied to
 * a private copy of the entries (tally +1, isNew cleared, lastShownAt set to
 * that slot's boundary). The inputs are never mutated. Fewer than `n`
 * entries come back only when nothing is eligible.
 */
export function project(
  entries: BinEntry[], d: SoloDials, state: ScreenState, n: number, firstSlot: number, feed: Feed,
): BinEntry[] {
  const working = entries.map((e) => ({ ...e }));
  let s = state;
  const out: BinEntry[] = [];
  for (let i = 0; i < n; i++) {
    const slot = firstSlot + i;
    const pick = next(working, d, s, slot, feed);
    if (!pick) break;
    out.push({ ...pick });
    pick.tally += 1;
    pick.isNew = false;
    pick.lastShownAt = boundaryMs(slot, feed, d.dwellS, d.offsetS);
    s = afterShowing(pick, s);
  }
  return out;
}
