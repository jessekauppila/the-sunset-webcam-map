import type { Solo2Dials } from './types';

/** One dwell's timeline, in seconds (camera-run spec §4.1). */
export interface DwellPlan {
  dwellS: number;
  /** Frames the dwell plays, at least 1. */
  frames: number;
  /** Each frame's even share of the dwell. */
  stepS: number;
  leadS: number;
}

export type PlanDials = Pick<Solo2Dials, 'dwellS' | 'leadS' | 'minStepS'>;

/**
 * The budget rule (dwell-budget spec §3). `dwellS` is a budget the run's
 * frames share, floored at `minStepS`:
 *
 *     perFrame = max(minStepS, dwellS / n)
 *     total    = perFrame * n
 *
 * At or below `n* = floor(dwellS / minStepS)` frames the budget is merely
 * divided more finely and the total stays `dwellS` — one image holds the
 * whole 20 s, five hold 4 s each. Above it the DWELL STRETCHES rather than
 * the frames shrinking, which is the whole point: a run is a timelapse and a
 * timelapse has one step, so eight frames run 4 s each for 32 s.
 *
 * `plan.dwellS` is therefore the total this dwell occupies, not the dial.
 * The lead is capped at that total.
 */
export function fitPlan(d: PlanDials, frames: number): DwellPlan {
  const n = Math.max(1, Math.floor(frames));
  const stepS = Math.max(d.minStepS, d.dwellS / n);
  const totalS = stepS * n;
  return { dwellS: totalS, frames: n, stepS, leadS: Math.min(totalS, Math.max(0, d.leadS)) };
}

/**
 * The frame count at which the dwell starts stretching (spec §3.1). Printed
 * beside the dials so an operator can see whether a cap will ever move the
 * clock: at or below this, a cap buys pictures rather than time.
 */
export function stretchThreshold(d: Pick<PlanDials, 'dwellS' | 'minStepS'>): number {
  return Math.max(1, Math.floor(d.dwellS / Math.max(0.001, d.minStepS)));
}

export interface Stage {
  /** Which frame of the run is up, 0-based. */
  index: number;
  /** 0 until the lead begins, 1 at the boundary. */
  leadProgress: number;
}

/**
 * Where a dwell is at `elapsedMs` after its boundary. Pure, so a tab that
 * loads mid-dwell joins at the right frame and the studio can draw the same
 * timeline.
 */
export function stageAt(elapsedMs: number, p: DwellPlan): Stage {
  const t = Math.max(0, elapsedMs) / 1000;
  const index = Math.min(p.frames - 1, Math.floor(t / p.stepS));
  const leadStart = p.dwellS - p.leadS;
  const leadProgress = p.leadS > 0 ? Math.min(1, Math.max(0, (t - leadStart) / p.leadS)) : 0;
  return { index, leadProgress };
}

/** The line the studio prints: `4 frames × 5 s`, `1 frame · 20 s`, `· lead 4 s` when the lead is on. */
export function describePlan(p: DwellPlan): string {
  const s = (n: number) => `${Number(n.toFixed(1))} s`;
  const frames = p.frames === 1 ? `1 frame · ${s(p.dwellS)}` : `${p.frames} frames × ${s(p.stepS)}`;
  return p.leadS > 0 ? `${frames} · lead ${s(p.leadS)}` : frames;
}
