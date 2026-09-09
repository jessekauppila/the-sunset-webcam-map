'use client';

import { useEffect, useState } from 'react';
import { stageAt, type DwellPlan, type Stage } from '@/app/lib/solo2/plan';

const same = (a: Stage, b: Stage) =>
  a.index === b.index && a.leadProgress === b.leadProgress && a.exitProgress === b.exitProgress;

/**
 * Where the current dwell is, re-read from the wall clock every `tickMs`
 * (camera-run spec §4.2). `startMs` is when the dwell began; it changes once
 * per dwell, so a tab that loads mid-dwell joins at the right frame.
 */
export function useStage(plan: DwellPlan, startMs: number, tickMs = 250): Stage {
  const [stage, setStage] = useState<Stage>(() => stageAt(Date.now() - startMs, plan));
  const { dwellS, frames, stepS, lastStepS, leadS, arrivalS, exitS } = plan;
  useEffect(() => {
    const p = { dwellS, frames, stepS, lastStepS, leadS, arrivalS, exitS };
    const read = () => setStage((prev) => {
      const nextStage = stageAt(Date.now() - startMs, p);
      return same(prev, nextStage) ? prev : nextStage;
    });
    read();
    const t = setInterval(read, tickMs);
    return () => clearInterval(t);
  }, [startMs, tickMs, dwellS, frames, stepS, lastStepS, leadS, arrivalS, exitS]);
  return stage;
}
