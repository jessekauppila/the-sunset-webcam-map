'use client';

import { describePlan, fitPlan, type PlanDials } from '@/app/lib/solo2/plan';

const mono = 'ui-monospace, SFMono-Regular, Menlo, monospace';

/**
 * The dwell line under solo2's glass dials (camera-run spec §4.1): how the
 * dwell splits between the frames of the camera on glass, `4 frames × 5 s`,
 * with the lead when it is on.
 */
export function DwellBudget({ dials, frames = 1 }: { dials: PlanDials; frames?: number }) {
  return (
    <div title="How the dwell splits for the camera on glass: every frame of its run gets an even share, and the lead runs over the last seconds." style={{
      fontFamily: mono, fontSize: 11, padding: '4px 4px 0', color: '#8b95a7',
    }}>
      {describePlan(fitPlan(dials, frames))}
    </div>
  );
}
