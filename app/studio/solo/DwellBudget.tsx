'use client';

import { describePlan, fitPlan, type PlanDials } from '@/app/lib/solo2/plan';

const mono = 'ui-monospace, SFMono-Regular, Menlo, monospace';

/**
 * The dwell budget under solo2's glass dials (spec §4.1): how the dwell
 * splits into prelude, lead and hold with the dials as set, assuming the
 * camera has as many earlier frames as the prelude asks for. Red when the
 * glass would have to drop something to keep the hold.
 */
export function DwellBudget({ dials }: { dials: PlanDials }) {
  const plan = fitPlan(dials, dials.preludeFrames);
  return (
    <div title="How each dwell splits with these dials. The chosen frame always holds at least 3 s; prelude frames go first, then the lead." style={{
      fontFamily: mono, fontSize: 11, padding: '4px 4px 0', color: plan.clamped ? '#f47174' : '#8b95a7',
    }}>
      {describePlan(plan)}
    </div>
  );
}
