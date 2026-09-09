'use client';

import { useEffect, useState } from 'react';
import { stageAt, type DwellPlan, type Stage } from '@/app/lib/solo2/plan';

const same = (a: Stage, b: Stage) =>
  a.index === b.index && a.leadProgress === b.leadProgress && a.exitProgress === b.exitProgress;

/**
 * Where the current dwell is, re-read from the wall clock every `tickMs`
 * (camera-run spec §4.2). `startMs` is when the dwell began; it changes once
 * per dwell, so a tab that loads mid-dwell joins at the right frame.
 *
 * A NEW dwell is read during the render that brings it, never in the effect
 * afterwards. An effect runs after the browser has painted, so a stage kept
 * only in state stays on the PREVIOUS dwell's index for the first painted
 * frame of the new one — and that index, clamped to the new run, picks its
 * NEWEST picture. On glass that was a flash of a later, lighter frame at the
 * head of a sunrise run before it snapped back to the oldest (reported
 * 2026-09-09), carrying the lead's push at full scale and the exit's veil
 * with it. The dwell's start is its identity here, the same key the frame
 * stack rebuilds on.
 */
export function useStage(plan: DwellPlan, startMs: number, tickMs = 250): Stage {
  const [state, setState] = useState<{ startMs: number; stage: Stage }>(
    () => ({ startMs, stage: stageAt(Date.now() - startMs, plan) }),
  );
  let stage = state.stage;
  if (state.startMs !== startMs) {
    stage = stageAt(Date.now() - startMs, plan);
    setState({ startMs, stage });
  }
  const { dwellS, frames, stepS, lastStepS, leadS, arrivalS, exitS } = plan;
  useEffect(() => {
    const p = { dwellS, frames, stepS, lastStepS, leadS, arrivalS, exitS };
    const read = () => setState((prev) => {
      const nextStage = stageAt(Date.now() - startMs, p);
      return prev.startMs === startMs && same(prev.stage, nextStage) ? prev : { startMs, stage: nextStage };
    });
    read();
    const t = setInterval(read, tickMs);
    return () => clearInterval(t);
  }, [startMs, tickMs, dwellS, frames, stepS, lastStepS, leadS, arrivalS, exitS]);
  return stage;
}
