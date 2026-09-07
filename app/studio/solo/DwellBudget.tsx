'use client';

import { describePlan, fitPlan, stretchThreshold, type PlanDials } from '@/app/lib/solo2/plan';

const mono = 'ui-monospace, SFMono-Regular, Menlo, monospace';

/**
 * The dwell line under solo2's glass dials: how the dwell splits between the
 * frames of the camera on glass, and whether this run is STRETCHING the
 * dwell or merely dividing it (dwell-budget spec §3.1).
 *
 * The threshold is the number an operator actually needs. At or below it a
 * frame cap buys pictures and costs nothing; above it every extra frame adds
 * the floor to the dwell. Without it printed, the relationship between three
 * dials is invisible in any one of them.
 */
export function DwellBudget({ dials, frames = 1 }: { dials: PlanDials; frames?: number }) {
  const plan = fitPlan(dials, frames);
  const n = stretchThreshold(dials);
  // The frames' budget alone: the arrival is on top of the dial by design, not a stretch.
  const stretched = plan.dwellS - plan.arrivalS > dials.dwellS + 0.001;
  const s = (v: number) => `${Number(v.toFixed(1))} s`;
  return (
    <div data-testid="dwell-budget" title="How the dwell splits for the camera on glass. Below the threshold the frames divide the dwell and it does not move; above it the frames hold at the floor and the dwell stretches." style={{
      fontFamily: mono, fontSize: 11, padding: '4px 4px 0', color: '#8b95a7',
    }}>
      {describePlan(plan)}
      {stretched && <span style={{ color: '#f5a344' }}>{` · dwell ${s(plan.dwellS)}`}</span>}
      <div style={{ opacity: 0.7 }}>
        {stretched ? `stretched: past ${n} frames each one adds ${s(plan.stepS)}` : `divides the dwell up to ${n} frames`}
      </div>
    </div>
  );
}
