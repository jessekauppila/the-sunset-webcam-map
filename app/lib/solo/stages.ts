import { compareWithin, isEligible, isResting } from './engine';
import { qualityOf } from './scores';
import type { BinEntry, ScreenState, SoloDials } from './types';

/**
 * Where a frame stands for one screen's next draw (stages spec §3.1). The
 * studio shows each bin as these stages so a row can say why it is not on
 * glass. Pure: the projection is passed in, already run with the dials the
 * caller cares about.
 */
export type Stage =
  | { kind: 'onGlass' }
  /** In the queue column: 1-based draw index, 1..queueDepth. */
  | { kind: 'queued'; position: number }
  /** Eligible and rested; `position` is its draw index past the queue, null when the projection never reached it. */
  | { kind: 'inLine'; position: number | null }
  /** Shown within the last `rest` draws; back in line after `drawsLeft` draws. */
  | { kind: 'resting'; drawsLeft: number }
  /** Below its bin's floor, which is `floor` on the entry's own scale. */
  | { kind: 'underFloor'; floor: number };

export const STAGE_ORDER: Record<Stage['kind'], number> = {
  onGlass: 0, queued: 1, inLine: 2, resting: 3, underFloor: 4,
};

/** The floor an entry is measured against, on its own scale: quality 0–1 for sunsets, detection for the rest. */
export function floorFor(e: BinEntry, d: SoloDials): number {
  return e.bin === 'sunset' ? qualityOf(d.ratingFloor) : d.detectionFloor;
}

export function assignStages(input: {
  entries: BinEntry[];
  dials: SoloDials;
  state: ScreenState;
  /** The slot of the first projected draw. */
  firstSlot: number;
  /** The projection, first draw at `firstSlot`; longer than `queueDepth` so in-line frames get positions. */
  draws: BinEntry[];
  queueDepth: number;
}): Map<number, Stage> {
  const { entries, dials: d, state, firstSlot, draws, queueDepth } = input;
  const firstDraw = new Map<number, number>();
  draws.forEach((e, i) => {
    if (!firstDraw.has(e.snapshotId)) firstDraw.set(e.snapshotId, i + 1);
  });
  const out = new Map<number, Stage>();
  for (const e of entries) {
    const position = firstDraw.get(e.snapshotId) ?? null;
    if (e.snapshotId === state.lastSnapshotId) out.set(e.snapshotId, { kind: 'onGlass' });
    else if (position != null && position <= queueDepth) out.set(e.snapshotId, { kind: 'queued', position });
    else if (!isEligible(e, d)) out.set(e.snapshotId, { kind: 'underFloor', floor: floorFor(e, d) });
    else if (isResting(e, d, firstSlot)) {
      // The stored draw number, not a timestamp divided by a dwell (spec §6.1).
      const shownSlot = e.lastShownSlot!;
      out.set(e.snapshotId, { kind: 'resting', drawsLeft: Math.max(1, d.rest - (firstSlot - shownSlot) + 1) });
    } else out.set(e.snapshotId, { kind: 'inLine', position });
  }
  return out;
}

/** Stage order, then position (null last), then draws left, then the engine's own order. */
export function compareStaged(stages: Map<number, Stage>, d: SoloDials) {
  const within = compareWithin(d);
  const pos = (s: Stage) => (s.kind === 'queued' || s.kind === 'inLine' ? s.position ?? Number.MAX_SAFE_INTEGER : 0);
  const left = (s: Stage) => (s.kind === 'resting' ? s.drawsLeft : 0);
  return (a: BinEntry, b: BinEntry): number => {
    const sa: Stage = stages.get(a.snapshotId) ?? { kind: 'inLine', position: null };
    const sb: Stage = stages.get(b.snapshotId) ?? { kind: 'inLine', position: null };
    return STAGE_ORDER[sa.kind] - STAGE_ORDER[sb.kind] || pos(sa) - pos(sb) || left(sa) - left(sb) || within(a, b);
  };
}
