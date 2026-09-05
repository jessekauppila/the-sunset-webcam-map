import type { Solo2Dials } from './types';

/** The chosen frame sits still with its caption for at least this long (spec §4.1). */
export const MIN_HOLD_S = 3;

/** One dwell's timeline, in seconds, after the budget rule has been applied. */
export interface DwellPlan {
  dwellS: number;
  /** Prelude frames actually shown. 0 when the dial is off or nothing fits. */
  preludeFrames: number;
  preludeStepS: number;
  leadS: number;
  holdS: number;
  /** True when a prelude frame or some lead was dropped to keep the hold. */
  clamped: boolean;
}

export type PlanDials = Pick<Solo2Dials, 'dwellS' | 'prelude' | 'preludeFrames' | 'preludeStepS' | 'leadS'>;

/**
 * Fit prelude and lead into the dwell. `available` is how many earlier frames
 * this camera actually has. Prelude frames go first (oldest first, i.e. the
 * count shrinks), then the lead, until `hold ≥ MIN_HOLD_S`.
 */
export function fitPlan(d: PlanDials, available: number): DwellPlan {
  const step = d.preludeStepS;
  let frames = d.prelude ? Math.max(0, Math.min(Math.floor(d.preludeFrames), Math.floor(available))) : 0;
  let lead = Math.max(0, d.leadS);
  let clamped = false;
  const hold = () => d.dwellS - frames * step - lead;
  while (frames > 0 && hold() < MIN_HOLD_S) { frames -= 1; clamped = true; }
  if (hold() < MIN_HOLD_S && lead > 0) {
    lead = Math.max(0, d.dwellS - frames * step - MIN_HOLD_S);
    clamped = true;
  }
  return { dwellS: d.dwellS, preludeFrames: frames, preludeStepS: step, leadS: lead, holdS: hold(), clamped };
}

export type Stage =
  | { layer: 'prelude'; index: number }
  | { layer: 'main'; leadProgress: number };

/**
 * Where a dwell is at `elapsedMs` after its boundary. Pure, so a tab that
 * loads mid-dwell joins at the right step and the studio can draw the same
 * timeline.
 */
export function stageAt(elapsedMs: number, p: DwellPlan): Stage {
  const t = Math.max(0, elapsedMs) / 1000;
  const preludeEnd = p.preludeFrames * p.preludeStepS;
  if (p.preludeFrames > 0 && t < preludeEnd) {
    return { layer: 'prelude', index: Math.min(p.preludeFrames - 1, Math.floor(t / p.preludeStepS)) };
  }
  const leadStart = p.dwellS - p.leadS;
  const leadProgress = p.leadS > 0 ? Math.min(1, Math.max(0, (t - leadStart) / p.leadS)) : 0;
  return { layer: 'main', leadProgress };
}

/** The budget line the studio prints: `prelude 4.5 s + lead 4 s + hold 11.5 s`. */
export function describePlan(p: DwellPlan): string {
  const s = (n: number) => `${Number(n.toFixed(1))} s`;
  return `prelude ${s(p.preludeFrames * p.preludeStepS)} + lead ${s(p.leadS)} + hold ${s(p.holdS)}${p.clamped ? ' (clamped)' : ''}`;
}
