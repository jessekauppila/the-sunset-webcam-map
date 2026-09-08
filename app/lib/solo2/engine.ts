import { afterShowing, choosePool, compareRecency, compareWithin, rankScore } from '@/app/lib/solo/engine';
import type { BinEntry, Feed, ScreenState } from '@/app/lib/solo/types';
import { capFor, planDialsFor, poolEntries, runOf, type RunEntry } from './run';
import { fitPlan } from './plan';
import type { Role, Solo2Dials } from './types';

/**
 * solo's rules with rule 3 on a beat (rhythm spec §3) and the camera as the
 * unit (camera-run spec §3). Pure: no clock, no I/O. Draws from solo's
 * choosePool rather than copying it; solo's engine is not touched.
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

/** solo's rule 3 order, unchanged: never shown, longest since shown, best, earliest, id. */
const comparePeak = compareWithin;

/** A valley: the same recency key, then the LOWEST score, earliest, id. */
function compareValley(d: Solo2Dials) {
  return (a: BinEntry, b: BinEntry): number =>
    compareRecency(a, b) ||
    rankScore(a, d) - rankScore(b, d) ||
    a.enteredAt - b.enteredAt ||
    a.snapshotId - b.snapshotId;
}

/**
 * The next frame for one screen drawing at `slot`, or null when nothing is
 * eligible. With the camera run on, the rules see one entry per camera
 * (run.ts `representative`) and the pick is that camera's newest frame.
 */
export function next2<T extends RunEntry>(
  entries: T[], d: Solo2Dials, state: ScreenState, slot: number, feed: Feed,
): T | null {
  // Rules 5, 4, 2 and 1 are solo's, over cameras when the dial says so.
  const pool = choosePool(poolEntries(entries, d.cameraRun), d, state, slot);
  if (pool.length === 0) return null;
  // Rule 3, on the beat.
  const cmp = roleAt(slot, feed, d) === 'peak' ? comparePeak(d) : compareValley(d);
  const pick = [...pool].sort(cmp)[0];
  return entries.find((e) => e.snapshotId === pick.snapshotId) ?? null;
}

/** The frames a draw of `pick` puts on glass (camera-run spec §3.3). */
export function shown2<T extends RunEntry>(entries: T[], pick: T, d: Solo2Dials): T[] {
  // Capped per bin (spec §4). A frame the cap dropped never plays, so it is
  // never stamped shown either — the two must not disagree.
  return runOf(pick, entries, d.cameraRun, capFor(pick, d, entries, d.cameraRun));
}

/**
 * How long a draw of `pick` occupies the glass, ms (dwell-budget spec §5.2).
 * The budget rule of §3 over the frames the draw actually plays, which is
 * `shown2` — so the caps of §4 are already applied and this cannot disagree
 * with what reaches the glass.
 *
 * It lives here rather than at the call sites so that every surface renders
 * toward a supplied instant without knowing anything about versions, caps or
 * frame counts.
 */
export function dwellMs2(entries: BinEntry[], pick: BinEntry, d: Solo2Dials): number {
  const run = shown2(entries as RunEntry[], pick as RunEntry, d);
  return fitPlan(planDialsFor(pick as RunEntry, d, entries as RunEntry[], d.cameraRun), run.length).dwellS * 1000;
}

/**
 * `n` draws forward from `state`, the first at `firstSlot`, each applied to
 * a private copy of the entries: every frame the draw plays is marked
 * shown. Inputs are never mutated.
 */
export function project2<T extends RunEntry>(
  entries: T[], d: Solo2Dials, state: ScreenState, n: number, firstSlot: number, feed: Feed,
  /** When the first projected draw goes on glass; the clock walks by dwellMs2 from there (spec §5). */
  startMs = 0,
): T[] {
  const working = entries.map((e) => ({ ...e }));
  let s = state;
  let atMs = startMs;
  const out: T[] = [];
  for (let i = 0; i < n; i++) {
    const pick = next2(working, d, s, firstSlot + i, feed);
    if (!pick) break;
    out.push({ ...pick });
    const playedFor = dwellMs2(working, pick, d);
    for (const f of shown2(working, pick, d)) {
      f.tally += 1;
      f.isNew = false;
      // Both currencies (spec §6.1.1); every frame the dwell played rests.
      f.lastShownAt = atMs;
      f.lastShownSlot = firstSlot + i;
    }
    atMs += playedFor;
    s = afterShowing(pick, s);
  }
  return out;
}
