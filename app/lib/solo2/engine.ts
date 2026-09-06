import { afterShowing, choosePool, rankScore } from '@/app/lib/solo/engine';
import { boundaryMs } from '@/app/lib/solo/schedule';
import type { BinEntry, Feed, ScreenState } from '@/app/lib/solo/types';
import { preludePlan } from './prelude';
import type { Role, Solo2Dials } from './types';

/**
 * solo's rules with rule 3 on a beat (spec §3). Pure: no clock, no I/O.
 * Draws from solo's choosePool rather than copying it; solo's engine is not
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

/**
 * The frames a dwell of `pick` also puts on glass: its prelude (spec §4.4),
 * continuing from `previous` when that is the same camera. They count as
 * shown, tally and rest alike, so a camera plays once as one group and the
 * queue moves on instead of bringing each of its frames back for a turn of
 * its own. The glass draws exactly these (Solo2Kiosk calls preludePlan with
 * the same inputs), so what is marked shown is what was seen.
 */
export function shownWith2(pick: BinEntry, entries: BinEntry[], d: Solo2Dials, previous: BinEntry | null): BinEntry[] {
  return preludePlan(pick, entries, d, previous).frames;
}

/** The next frame for one screen drawing at `slot`, or null when nothing is eligible. */
export function next2(
  entries: BinEntry[], d: Solo2Dials, state: ScreenState, slot: number, feed: Feed,
): BinEntry | null {
  // Rules 5, 4, 2 and 1 are solo's.
  const pool = choosePool(entries, d, state, slot, feed);
  if (pool.length === 0) return null;
  // Rule 3, on the beat.
  const cmp = roleAt(slot, feed, d) === 'peak' ? comparePeak(d) : compareValley(d);
  return [...pool].sort(cmp)[0];
}

/**
 * `n` draws forward from `state`, the first at `firstSlot`, each applied to
 * a private copy of the entries. Each draw marks the pick AND its prelude
 * shown, as the advance route does. Inputs are never mutated.
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
    const previous = working.find((e) => e.snapshotId === s.lastSnapshotId) ?? null;
    const shownAt = boundaryMs(firstSlot + i, feed, d.dwellS, d.offsetS);
    for (const f of [pick, ...shownWith2(pick, working, d, previous)]) {
      f.tally += 1;
      f.isNew = false;
      f.lastShownAt = shownAt;
    }
    s = afterShowing(pick, s);
  }
  return out;
}
