'use client';

import { describePlan, fitPlan, type PlanDials } from '@/app/lib/solo2/plan';
import type { Feed } from '@/app/lib/solo/types';

const mono = 'ui-monospace, SFMono-Regular, Menlo, monospace';

const landingClock = (ms: number) =>
  new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' });

/**
 * The dwell line under solo2's glass dials (beat spec §4.2): how many beats
 * the camera on glass takes, and that it ends on a tick. In beats there is
 * no threshold to print — a frame is a beat, a change is a beat, and a short
 * run rests on its last frame.
 *
 * `landings`, when given, names where each screen's current dwell peaks
 * (rendezvous spec §3): a fitted rendezvous names the other screen it lands
 * with, and a pinned dwell just names its own time. solo has no rendezvous,
 * so it never passes this prop and no landing lines print.
 */
export function DwellBudget({ dials, frames = 1, landings }: {
  dials: PlanDials; frames?: number;
  landings?: Record<Feed, { atMs: number; rendezvous: boolean } | null>;
}) {
  const plan = fitPlan(dials, frames);
  const screens: Feed[] = ['sunrise', 'sunset'];
  const other: Record<Feed, Feed> = { sunrise: 'sunset', sunset: 'sunrise' };
  return (
    <div data-testid="dwell-budget" title="The dwell of the camera on glass, in beats. Every frame change on both screens lands on a tick of the beat, so a dwell always ends on one." style={{
      fontFamily: mono, fontSize: 11, padding: '4px 4px 0', color: '#8b95a7',
    }}>
      {describePlan(plan)}
      <div style={{ opacity: 0.7 }}>{`${Number(plan.dwellS.toFixed(1))} s at the still dial · ends on a tick`}</div>
      {landings && screens.map((feed) => {
        const landing = landings[feed];
        if (!landing) return null;
        const time = landingClock(landing.atMs);
        return (
          <div key={feed} style={{ opacity: 0.7 }}>
            {landing.rendezvous
              ? `${feed} lands ${time} with the ${other[feed]} screen`
              : `${feed} pins ${time}`}
          </div>
        );
      })}
    </div>
  );
}
