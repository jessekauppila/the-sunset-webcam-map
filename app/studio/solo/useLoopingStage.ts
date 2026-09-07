'use client';

import { useEffect, useState } from 'react';
import { stageAt, type DwellPlan, type Stage } from '@/app/lib/solo2/plan';

const same = (a: Stage, b: Stage) => a.index === b.index && a.leadProgress === b.leadProgress;

/** Where a dwell that began at `startMs` is now, wrapping at the plan's dwell. */
function stageOf(startMs: number | null, plan: DwellPlan): Stage {
  if (startMs == null) return stageAt(0, plan);
  const period = Math.max(1, plan.dwellS * 1000);
  return stageAt(Math.max(0, Date.now() - startMs) % period, plan);
}

/**
 * The studio's dwell clock (camera-run spec §5.1): where the dwell that began
 * at `startMs` has got to, wrapping at the plan's dwell so the preview plays a
 * run over and over at the studio's dwell while the glass keeps the live one.
 * No server call. Kept in its own file so the one-studio preview can lift it
 * as a move.
 *
 * `startMs` is the dwell's own start, not the moment this clock mounted, and
 * that distinction is the whole point. The preview's walker (`useSoloPreview`)
 * ticks at 250 ms, so it notices a boundary up to a tick late and back-dates
 * the new dwell to the exact boundary. A clock that started when it mounted
 * therefore ran that lag *behind* the dwell and wrapped to frame 0 while the
 * dwell was still on its last frame: the run flashed an earlier picture just
 * before the camera changed, and the last frame was short by the same amount.
 * Reading the dwell's own start phase-locks the two, so the wrap and the
 * camera change land together.
 */
export function useLoopingStage(plan: DwellPlan, startMs: number | null, tickMs = 250): Stage {
  const [stage, setStage] = useState<Stage>(() => stageOf(startMs, plan));
  const { dwellS, frames, stepS, leadS } = plan;
  useEffect(() => {
    const p = { dwellS, frames, stepS, leadS };
    const read = () => setStage((prev) => {
      const nextStage = stageOf(startMs, p);
      return same(prev, nextStage) ? prev : nextStage;
    });
    read();
    const t = setInterval(read, tickMs);
    return () => clearInterval(t);
  }, [startMs, tickMs, dwellS, frames, stepS, leadS]);
  return stage;
}
