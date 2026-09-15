import { compareRecency, isEligible, isResting, rankScore, NEW_FRAME_BONUS } from '@/app/lib/solo/engine';
import { floorFor } from '@/app/lib/solo/stages';
import type { BinEntry, Feed, ScreenState, SoloDials } from '@/app/lib/solo/types';
import { reasonLine } from '@/app/studio/solo/reason';
import { roleAt } from './engine';
import type { Role, Solo2Dials } from './types';

/**
 * One draw of the solo2 engine, read as a sieve (rules-lab spec §2): the pool
 * enters, each rule removes some of it, what survives is sorted and the head
 * is the pick. A second reading of `choosePool` + `next2`, never a
 * replacement: `trace.test.ts` holds the two to the same answer over random
 * pools, so the copy the page shows cannot drift from what the glass does.
 *
 * Camera runs are not traced (the lab runs one frame per camera, where the
 * representative IS the frame), so this reads frames, as `choosePool` does.
 */

export interface Step {
  rule: 5 | 4 | 2 | 1;
  /** "5 · floors", "4 · not on glass", "2 · rest", "1 · one bin". */
  title: string;
  /** snapshotIds that survive this rule, in pool order. */
  kept: number[];
  dropped: { snapshotId: number; why: string }[];
  /** A waiver, or rule 1's decision. */
  note?: string;
}

export interface Ranked {
  entry: BinEntry;
  /** The head: the role. Every other row: the first comparator that put it below the row above. */
  key: string;
}

export interface Trace {
  role: Role;
  steps: Step[];
  sorted: Ranked[];
  pick: BinEntry | null;
}

const ids = (xs: BinEntry[]) => xs.map((e) => e.snapshotId);

/** Rule 2's "back in N draws", as the stages column counts it. */
function drawsLeft(e: BinEntry, d: SoloDials, slot: number): number {
  return Math.max(1, d.rest - (slot - (e.lastShownSlot ?? slot)) + 1);
}

function score(e: BinEntry, d: SoloDials): string {
  const bonus = d.promoteNew && e.isNew ? ` (+${NEW_FRAME_BONUS} new)` : '';
  return `score ${rankScore(e, d).toFixed(2)}${bonus}`;
}

/** Why `b` sits below `a`: the first of rule 3's comparators that is not a tie. */
function keyBelow(a: BinEntry, b: BinEntry, d: SoloDials): string {
  if (compareRecency(a, b) !== 0) return b.lastShownSlot == null ? 'shown before' : `since draw ${b.lastShownSlot}`;
  if (rankScore(a, d) !== rankScore(b, d)) return score(b, d);
  if (a.enteredAt !== b.enteredAt) return 'same score · entered later';
  return 'same score · higher id';
}

/** Rule 3's comparator for the role — solo's for a peak, reversed on score for a valley. */
function compareFor(role: Role, d: SoloDials) {
  return (a: BinEntry, b: BinEntry): number =>
    compareRecency(a, b) ||
    (role === 'peak' ? rankScore(b, d) - rankScore(a, d) : rankScore(a, d) - rankScore(b, d)) ||
    a.enteredAt - b.enteredAt ||
    a.snapshotId - b.snapshotId;
}

export function traceDraw(
  entries: BinEntry[], d: Solo2Dials, state: ScreenState, slot: number, feed: Feed,
): Trace {
  const steps: Step[] = [];
  const nowMs = 0; // the lab's reasons never print an age; `reasonLine` needs some instant

  // Rule 5: floors.
  const eligible = entries.filter((e) => isEligible(e, d));
  steps.push({
    rule: 5, title: '5 · floors', kept: ids(eligible),
    dropped: entries.filter((e) => !isEligible(e, d))
      .map((e) => ({ snapshotId: e.snapshotId, why: reasonLine({ kind: 'underFloor', floor: floorFor(e, d) }, e, nowMs) })),
  });

  // Rule 4: not the frame on glass — unless it is the only one.
  const notOnGlass = eligible.filter((e) => e.snapshotId !== state.lastSnapshotId);
  const repeats = notOnGlass.length === 0 && eligible.length > 0;
  const afterGlass = repeats ? eligible : notOnGlass;
  steps.push({
    rule: 4, title: '4 · not on glass', kept: ids(afterGlass),
    dropped: repeats ? [] : eligible.filter((e) => e.snapshotId === state.lastSnapshotId).map((e) => ({ snapshotId: e.snapshotId, why: 'on glass' })),
    ...(repeats ? { note: 'only frame on offer · it repeats' } : {}),
  });

  // Rule 2: rest — waived when everything is resting.
  const rested = afterGlass.filter((e) => !isResting(e, d, slot));
  const waived = rested.length === 0 && afterGlass.length > 0;
  const candidates = waived ? afterGlass : rested;
  steps.push({
    rule: 2, title: '2 · rest', kept: ids(candidates),
    dropped: waived ? [] : afterGlass.filter((e) => isResting(e, d, slot))
      .map((e) => ({ snapshotId: e.snapshotId, why: `resting · back in ${drawsLeft(e, d, slot)} draws` })),
    ...(waived ? { note: 'everything resting · rest waived' } : {}),
  });

  // Rule 1: one bin.
  const sunsets = candidates.filter((e) => e.bin === 'sunset');
  const nonSunsets = candidates.filter((e) => e.bin === 'non_sunset');
  let pool: BinEntry[];
  let note: string;
  if (candidates.length === 0) { pool = []; note = 'nothing eligible'; }
  else if (sunsets.length === 0) { pool = nonSunsets; note = 'no sunsets left → non-sunsets'; }
  else if (nonSunsets.length === 0) { pool = sunsets; note = 'no non-sunsets left → sunsets'; }
  else if (sunsets.length >= d.sunsetFloor) { pool = sunsets; note = `${sunsets.length} sunsets ≥ floor ${d.sunsetFloor} → sunsets`; }
  else if (state.sunsetStreak >= d.mix) { pool = nonSunsets; note = `${sunsets.length} sunsets < floor ${d.sunsetFloor} · streak ${state.sunsetStreak} ≥ mix ${d.mix} → non-sunsets`; }
  else { pool = sunsets; note = `${sunsets.length} sunsets < floor ${d.sunsetFloor} · streak ${state.sunsetStreak} < mix ${d.mix} → sunsets`; }
  const chosen = new Set(ids(pool));
  steps.push({
    rule: 1, title: '1 · one bin', kept: ids(pool),
    dropped: candidates.filter((e) => !chosen.has(e.snapshotId)).map((e) => ({ snapshotId: e.snapshotId, why: 'other bin' })),
    note,
  });

  // Rule 3, on the beat.
  const role = roleAt(slot, feed, d);
  const order = [...pool].sort(compareFor(role, d));
  const sorted: Ranked[] = order.map((entry, i) => ({
    entry,
    key: i === 0 ? (role === 'peak' ? 'peak · best first' : 'valley · worst first') : keyBelow(order[i - 1], entry, d),
  }));
  return { role, steps, sorted, pick: order[0] ?? null };
}
