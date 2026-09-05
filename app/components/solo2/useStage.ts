'use client';

import { useEffect, useState } from 'react';
import { stageAt, type DwellPlan, type Stage } from '@/app/lib/solo2/plan';

const same = (a: Stage, b: Stage) =>
  a.layer === b.layer &&
  (a.layer === 'prelude' ? a.index === (b as { index: number }).index
    : a.leadProgress === (b as { leadProgress: number }).leadProgress);

/**
 * Where the current dwell is, re-read from the wall clock every `tickMs`
 * (spec §4.1). `startMs` is the boundary the dwell began at; it changes once
 * per dwell, so a tab that loads mid-dwell joins at the right step.
 */
export function useStage(plan: DwellPlan, startMs: number, tickMs = 250): Stage {
  const [stage, setStage] = useState<Stage>(() => stageAt(Date.now() - startMs, plan));
  const { dwellS, preludeFrames, preludeStepS, leadS, holdS, clamped } = plan;
  useEffect(() => {
    const p = { dwellS, preludeFrames, preludeStepS, leadS, holdS, clamped };
    const read = () => setStage((prev) => {
      const nextStage = stageAt(Date.now() - startMs, p);
      return same(prev, nextStage) ? prev : nextStage;
    });
    read();
    const t = setInterval(read, tickMs);
    return () => clearInterval(t);
  }, [startMs, tickMs, dwellS, preludeFrames, preludeStepS, leadS, holdS, clamped]);
  return stage;
}
