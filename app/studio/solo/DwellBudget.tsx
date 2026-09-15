'use client';

import { describePlan, fitPlan, type PlanDials } from '@/app/lib/solo2/plan';

const mono = 'ui-monospace, SFMono-Regular, Menlo, monospace';

/**
 * The dwell line under solo2's glass dials (beat spec §4.2): how many beats
 * the camera on glass takes, and that it ends on a tick. In beats there is
 * no threshold to print — a frame is a beat, a change is a beat, and a short
 * run rests on its last frame.
 */
export function DwellBudget({ dials, frames = 1 }: { dials: PlanDials; frames?: number }) {
  const plan = fitPlan(dials, frames);
  return (
    <div data-testid="dwell-budget" title="The dwell of the camera on glass, in beats. Every frame change on both screens lands on a tick of the beat, so a dwell always ends on one." style={{
      fontFamily: mono, fontSize: 11, padding: '4px 4px 0', color: '#8b95a7',
    }}>
      {describePlan(plan)}
      <div style={{ opacity: 0.7 }}>{`${Number(plan.dwellS.toFixed(1))} s · ends on a tick`}</div>
    </div>
  );
}
