import { fitPlan, type DwellPlan, type PlanDials } from './plan';

export interface PreludeEntry { webcamId: number; snapshotId: number; capturedAt: number }

/**
 * The prelude of a frame: the same camera's earlier captures, oldest first,
 * the last `max` of them (spec §4.4). Pure over whatever the state endpoint
 * already returned: no query. Frames below a floor are fine here; they are
 * earlier pictures of the same scene. `afterMs` keeps only captures after
 * that moment, so a prelude can continue from the frame already on glass
 * instead of rewinding past it.
 */
export function preludeFor<T extends PreludeEntry>(entry: T, entries: T[], max: number, afterMs = -Infinity): T[] {
  if (max <= 0) return [];
  return entries
    .filter((e) => e.webcamId === entry.webcamId && e.snapshotId !== entry.snapshotId
      && e.capturedAt < entry.capturedAt && e.capturedAt > afterMs)
    .sort((a, b) => a.capturedAt - b.capturedAt || a.snapshotId - b.snapshotId)
    .slice(-Math.floor(max));
}

/**
 * What one dwell of `entry` shows before the chosen frame, and its plan: the
 * prelude the dials ask for, cut to what the budget keeps (newest kept, since
 * fitPlan drops oldest-first). When `previous` is the same camera the prelude
 * picks up after it. The glass and the studio call this with the same inputs
 * so the studio's group is the glass's sequence.
 */
export function preludePlan<T extends PreludeEntry>(
  entry: T, entries: T[], dials: PlanDials & { preludeFrames: number }, previous?: PreludeEntry | null,
): { frames: T[]; plan: DwellPlan } {
  const after = previous && previous.webcamId === entry.webcamId ? previous.capturedAt : -Infinity;
  const wanted = dials.prelude ? preludeFor(entry, entries, dials.preludeFrames, after) : [];
  const plan = fitPlan(dials, wanted.length);
  return { frames: plan.preludeFrames > 0 ? wanted.slice(-plan.preludeFrames) : [], plan };
}
