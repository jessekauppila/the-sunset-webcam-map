import { afterShowing } from '@/app/lib/solo/engine';
import { qualityOf } from '@/app/lib/solo/scores';
import type { BinEntry, Feed, ScreenState } from '@/app/lib/solo/types';
import { project2 } from '@/app/lib/solo2/engine';
import { traceDraw, type Trace } from '@/app/lib/solo2/trace';
import type { Solo2Dials } from '@/app/lib/solo2/types';

/**
 * The rules lab's pool and clock (rules-lab spec §3). A textbook pool, one
 * frame per camera, and a slot the scrubber moves: draws 1..slot−1 have been
 * applied, the sieve shows draw `slot`. Everything is rebuilt from the seed,
 * so stepping back is stepping forward less far.
 */

export const S0: ScreenState = { lastSnapshotId: null, sunsetStreak: 0 };

/** Eight sunsets by rating 4.8 → 2.0, four non-sunsets by detection 0.9 → 0.2. */
export function seedPool(): BinEntry[] {
  const ratings = [4.8, 4.4, 4.0, 3.6, 3.2, 2.8, 2.4, 2.0];
  const detections = [0.9, 0.7, 0.45, 0.2];
  return [
    ...ratings.map((r, i): BinEntry => ({
      snapshotId: i + 1, webcamId: 1000 + i + 1, bin: 'sunset', quality: qualityOf(r), detection: 0.95,
      isNew: false, tally: 0, enteredAt: i + 1, lastShownAt: null, lastShownSlot: null,
    })),
    ...detections.map((det, i): BinEntry => ({
      snapshotId: 101 + i, webcamId: 2000 + i + 1, bin: 'non_sunset', quality: null, detection: det,
      isNew: false, tally: 0, enteredAt: 100 + i + 1, lastShownAt: null, lastShownSlot: null,
    })),
  ];
}

export const labelOf = (e: BinEntry): string => (e.bin === 'sunset' ? `S${e.snapshotId}` : `N${e.snapshotId - 100}`);

export interface LabFrame {
  /** The pool as it stands before draw `slot`. */
  entries: BinEntry[];
  state: ScreenState;
  /** Draws 1..slot−1, as labels. */
  history: string[];
  /** The sieve for draw `slot`. */
  trace: Trace;
  /** snapshotId → its position in the next eight draws (1-based), for the numbers on the bins. */
  upcoming: Map<number, number>;
}

/** Apply a draw as `project2` does, in place. `lastShownAt` only needs to be monotone in the slot here. */
function apply(entries: BinEntry[], pick: BinEntry, slot: number): void {
  const e = entries.find((x) => x.snapshotId === pick.snapshotId)!;
  e.tally += 1;
  e.isNew = false;
  e.lastShownAt = slot * 1000;
  e.lastShownSlot = slot;
}

export function labAt(seed: BinEntry[], d: Solo2Dials, feed: Feed, slot: number, lookahead = 8): LabFrame {
  const entries = seed.map((e) => ({ ...e }));
  let state = S0;
  const history: string[] = [];
  for (let s = 1; s < slot; s++) {
    const pick = traceDraw(entries, d, state, s, feed).pick;
    if (!pick) break;
    history.push(labelOf(pick));
    apply(entries, pick, s);
    state = afterShowing(pick, state);
  }
  const trace = traceDraw(entries, d, state, slot, feed);
  const upcoming = new Map<number, number>();
  project2(entries, d, state, lookahead, slot, feed).forEach((e, i) => {
    if (!upcoming.has(e.snapshotId)) upcoming.set(e.snapshotId, i + 1);
  });
  return { entries, state, history, trace, upcoming };
}
