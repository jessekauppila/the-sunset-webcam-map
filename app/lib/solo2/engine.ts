import { afterShowing, isEligible, rankScore, tierOf } from '@/app/lib/solo/engine';
import type { BinEntry, Feed, ScreenState } from '@/app/lib/solo/types';
import type { Role, Solo2Dials } from './types';

/**
 * solo's rules with rule 3 on a beat (spec §3). Pure: no clock, no I/O.
 * Composes solo's helpers rather than copying them; solo's engine is not
 * touched.
 */

/** period = valleys + 1; the sunset screen's phase is half a bar when the screens alternate. */
export function beatOf(slot: number, feed: Feed, d: Pick<Solo2Dials, 'valleys' | 'screens'>): number {
  const period = Math.max(1, Math.floor(d.valleys) + 1);
  const phase = feed === 'sunset' && d.screens === 'alternate' ? Math.floor(period / 2) : 0;
  return (((slot - phase) % period) + period) % period;
}

export function roleAt(slot: number, feed: Feed, d: Pick<Solo2Dials, 'valleys' | 'screens'>): Role {
  return beatOf(slot, feed, d) === 0 ? 'peak' : 'valley';
}

/** solo's rule 3 order: tally, best score, earliest, id. */
function comparePeak(d: Solo2Dials) {
  return (a: BinEntry, b: BinEntry): number =>
    a.tally - b.tally ||
    rankScore(b, d) - rankScore(a, d) ||
    a.enteredAt - b.enteredAt ||
    a.snapshotId - b.snapshotId;
}

/** A valley: still unshown first, then the LOWEST score, earliest, id. */
function compareValley(d: Solo2Dials) {
  return (a: BinEntry, b: BinEntry): number =>
    a.tally - b.tally ||
    rankScore(a, d) - rankScore(b, d) ||
    a.enteredAt - b.enteredAt ||
    a.snapshotId - b.snapshotId;
}

/** The next frame for one screen drawing at `slot`, or null when nothing is eligible. */
export function next2(
  entries: BinEntry[], d: Solo2Dials, state: ScreenState, slot: number, feed: Feed,
): BinEntry | null {
  const eligible = entries.filter((e) => isEligible(e, d));
  // Rule 4.
  let candidates = eligible.filter((e) => e.snapshotId !== state.lastSnapshotId);
  if (candidates.length === 0) candidates = eligible;
  if (candidates.length === 0) return null;

  // Rule 1.
  const minTier = Math.min(...candidates.map((e) => tierOf(e, d)));
  const tier = candidates.filter((e) => tierOf(e, d) === minTier);
  const sunsets = tier.filter((e) => e.bin === 'sunset');
  const nonSunsets = tier.filter((e) => e.bin === 'non_sunset');

  // Rule 2.
  let pool: BinEntry[];
  if (nonSunsets.length === 0) pool = sunsets;
  else if (sunsets.length === 0) pool = nonSunsets;
  else if (sunsets.length >= d.sunsetFloor) pool = sunsets;
  else pool = state.sunsetStreak >= d.mix ? nonSunsets : sunsets;

  // Rule 3, on the beat.
  const cmp = roleAt(slot, feed, d) === 'peak' ? comparePeak(d) : compareValley(d);
  return [...pool].sort(cmp)[0];
}

/**
 * `n` draws forward from `state`, the first at `firstSlot`, each applied to
 * a private copy of the entries. Inputs are never mutated.
 */
export function project2(
  entries: BinEntry[], d: Solo2Dials, state: ScreenState, n: number, firstSlot: number, feed: Feed,
): BinEntry[] {
  const working = entries.map((e) => ({ ...e }));
  let s = state;
  const out: BinEntry[] = [];
  for (let i = 0; i < n; i++) {
    const pick = next2(working, d, s, firstSlot + i, feed);
    if (!pick) break;
    out.push({ ...pick });
    pick.tally += 1;
    pick.isNew = false;
    s = afterShowing(pick, s);
  }
  return out;
}
