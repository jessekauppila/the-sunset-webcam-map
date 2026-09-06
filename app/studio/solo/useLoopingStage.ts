'use client';

import { useEffect, useState } from 'react';
import { stageAt, type DwellPlan, type Stage } from '@/app/lib/solo2/plan';

const same = (a: Stage, b: Stage) => a.index === b.index && a.leadProgress === b.leadProgress;

/**
 * The studio's dwell clock (camera-run spec §5.1): a local clock that starts
 * at 0 whenever `key` changes and wraps at the plan's dwell, so the preview
 * plays a run over and over at the studio's dwell while the glass holds on
 * the live one. No server call. Kept in its own file so the one-studio
 * preview can lift it as a move.
 */
export function useLoopingStage(plan: DwellPlan, key: string | number | null, tickMs = 250): Stage {
  const [start, setStart] = useState(() => Date.now());
  const [stage, setStage] = useState<Stage>(() => stageAt(0, plan));
  const { dwellS, frames, stepS, leadS } = plan;
  useEffect(() => { setStart(Date.now()); }, [key]);
  useEffect(() => {
    const p = { dwellS, frames, stepS, leadS };
    const period = Math.max(1, dwellS * 1000);
    const read = () => setStage((prev) => {
      const nextStage = stageAt((Date.now() - start) % period, p);
      return same(prev, nextStage) ? prev : nextStage;
    });
    read();
    const t = setInterval(read, tickMs);
    return () => clearInterval(t);
  }, [start, tickMs, dwellS, frames, stepS, leadS]);
  return stage;
}
