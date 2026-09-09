'use client';

import { useEffect, useState } from 'react';
import { stageAt, type DwellPlan, type Stage } from '@/app/lib/solo2/plan';

const same = (a: Stage, b: Stage) =>
  a.index === b.index && a.leadProgress === b.leadProgress && a.exitProgress === b.exitProgress;

/**
 * Where a dwell that began at `startMs` is now. Clamped at the dwell, never
 * wrapped: the walker owns when a dwell ends, and it ticks at 250 ms, so a
 * stage that wrapped on its own clock reached frame 0 while the walker still
 * had the old dwell. Holding the last frame instead means the run restarts in
 * the same commit that brings the new dwell.
 */
function stageOf(startMs: number | null, plan: DwellPlan): Stage {
  if (startMs == null) return stageAt(0, plan);
  const period = Math.max(1, plan.dwellS * 1000);
  return stageAt(Math.min(Math.max(0, Date.now() - startMs), period - 1), plan);
}

/**
 * The studio's dwell clock (camera-run spec §5.1): where the dwell that began
 * at `startMs` has got to, so the preview plays a run at the studio's dwell
 * while the glass keeps the live one. The looping belongs to the walker; this
 * only says where the current dwell stands. No server call. Kept in its own
 * file so the one-studio preview can lift it as a move.
 *
 * `startMs` is the dwell's own start, not the moment this clock mounted, and
 * that distinction is the whole point. The preview's walker (`useSoloPreview`)
 * ticks at 250 ms, so it notices a boundary up to a tick late and back-dates
 * the new dwell to the exact boundary. A clock that started when it mounted
 * therefore ran that lag *behind* the dwell it was timing. Reading the dwell's
 * own start phase-locks the two.
 *
 * Phase-locking alone was not enough, because two clocks ticking separately
 * can still disagree for a tick: this one would reach the end of the dwell
 * before the walker moved the dwell on, reset the run to frame 0, and leave
 * the stack dissolving back down to its oldest picture. So this clock no
 * longer wraps at all — see `stageOf`.
 */
export function useLoopingStage(plan: DwellPlan, startMs: number | null, tickMs = 250): Stage {
  const [state, setState] = useState<{ startMs: number | null; stage: Stage }>(
    () => ({ startMs, stage: stageOf(startMs, plan) }),
  );
  // The new dwell is read HERE, in the render that brings it, because an
  // effect runs after the browser has painted: a stage kept only in state
  // paints the previous dwell's index against the new run, which clamps to
  // the run's newest picture and flashes a later frame at the head of the
  // run (2026-09-09). Same fix, same reason, as the glass's `useStage`.
  let stage = state.stage;
  if (state.startMs !== startMs) {
    stage = stageOf(startMs, plan);
    setState({ startMs, stage });
  }
  const { dwellS, frames, stepS, lastStepS, leadS, arrivalS, exitS } = plan;
  useEffect(() => {
    const p = { dwellS, frames, stepS, lastStepS, leadS, arrivalS, exitS };
    const read = () => setState((prev) => {
      const nextStage = stageOf(startMs, p);
      return prev.startMs === startMs && same(prev.stage, nextStage) ? prev : { startMs, stage: nextStage };
    });
    read();
    const t = setInterval(read, tickMs);
    return () => clearInterval(t);
  }, [startMs, tickMs, dwellS, frames, stepS, lastStepS, leadS, arrivalS, exitS]);
  return stage;
}
