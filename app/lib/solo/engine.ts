import type { BinEntry, ScreenState, SoloDials } from './types';

/**
 * The solo kiosk's ordering rules, spec §4, as a pure function. No clock, no
 * I/O, no module state: memory across draws is the ScreenState argument, and
 * the tally lives on the entries the caller passes in. The studio runs
 * `project()` with the studio profile's dials to show what the glass will do;
 * the advance endpoint runs `next()` with the live profile's.
 */

/** Rule 3: a frame that arrived while its camera was already in the bin. */
export const NEW_FRAME_BONUS = 0.1;

/** Rule 5. */
export function isEligible(e: BinEntry, d: SoloDials): boolean {
  return e.bin === 'sunset'
    ? (e.quality ?? -1) >= d.qualityFloor
    : e.detection >= d.detectionFloor;
}

/** Rule 1: the first sort key across both bins. */
export function tierOf(e: BinEntry, d: SoloDials): number {
  return e.bin === 'sunset' ? Math.max(0, e.tally - d.repeatAllowance) : e.tally;
}

/** Rule 3: quality for sunsets, detection for non-sunsets, plus the new-frame bonus. */
export function rankScore(e: BinEntry, d: SoloDials): number {
  const base = e.bin === 'sunset' ? (e.quality ?? 0) : e.detection;
  return base + (d.promoteNew && e.isNew ? NEW_FRAME_BONUS : 0);
}

function compareWithin(d: SoloDials) {
  return (a: BinEntry, b: BinEntry): number =>
    a.tally - b.tally ||
    rankScore(b, d) - rankScore(a, d) ||
    a.enteredAt - b.enteredAt ||
    a.snapshotId - b.snapshotId;
}

/** The next frame for one screen, or null when nothing is eligible. */
export function next(entries: BinEntry[], d: SoloDials, state: ScreenState): BinEntry | null {
  const eligible = entries.filter((e) => isEligible(e, d));
  // Rule 4. If the frame on glass is the only eligible one, it repeats.
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

  // Rule 3.
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
 * `n` draws forward from `state`, each applied to a private copy of the
 * entries (tally +1, isNew cleared). The inputs are never mutated. Fewer than
 * `n` entries come back only when nothing is eligible.
 */
export function project(entries: BinEntry[], d: SoloDials, state: ScreenState, n: number): BinEntry[] {
  const working = entries.map((e) => ({ ...e }));
  let s = state;
  const out: BinEntry[] = [];
  for (let i = 0; i < n; i++) {
    const pick = next(working, d, s);
    if (!pick) break;
    out.push({ ...pick });
    pick.tally += 1;
    pick.isNew = false;
    s = afterShowing(pick, s);
  }
  return out;
}
