import type { Solo2Dials } from './types';

/** One dwell's timeline, in seconds (camera-run spec §4.1). */
export interface DwellPlan {
  /** The whole dwell: the arrival, then the frames. */
  dwellS: number;
  /** Frames the dwell plays, at least 1. */
  frames: number;
  /** Each frame's even share of the frames' budget. */
  stepS: number;
  leadS: number;
  /**
   * The camera change's own segment at the front of the dwell (dwell-budget
   * spec §3.3). Frame 1's step begins when it ends, so the first frame holds
   * as long as every other. 0 for dials without fades.
   */
  arrivalS: number;
}

/**
 * The fade dials are optional so that solo's dials, which have no camera
 * change, plan a dwell with no arrival — and so do fixtures that predate it.
 */
export type PlanDials = Pick<Solo2Dials, 'dwellS' | 'leadS' | 'minStepS'>
  & Partial<Pick<Solo2Dials, 'transition' | 'fadeS' | 'sameCameraFadeS'>>;

/**
 * How long the front of a dwell is spent arriving (dwell-budget spec §3.3).
 * Sized for the longest arrival the dwell might open with — the camera-change
 * fade, or the same-camera dissolve — because the server sizes a dwell
 * without knowing what was on glass before it. When the actual arrival is
 * shorter, frame 1 simply holds for the rest.
 */
export function arrivalS(d: Partial<Pick<Solo2Dials, 'transition' | 'fadeS' | 'sameCameraFadeS'>>): number {
  const change = d.transition && d.transition !== 'cut' ? Math.max(0, d.fadeS ?? 0) : 0;
  return Math.max(change, Math.max(0, d.sameCameraFadeS ?? 0));
}

/**
 * The budget rule (dwell-budget spec §3). `dwellS` is a budget the run's
 * frames share, floored at `minStepS`, and the arrival sits in front of it:
 *
 *     perFrame = max(minStepS, dwellS / n)
 *     total    = arrivalS + perFrame * n
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
  const arrival = arrivalS(d);
  const totalS = arrival + stepS * n;
  return { dwellS: totalS, frames: n, stepS, leadS: Math.min(totalS, Math.max(0, d.leadS)), arrivalS: arrival };
}

/**
 * The frame count at which the dwell starts stretching (spec §3.1). Printed
 * beside the dials so an operator can see whether a cap will ever move the
 * clock: at or below this, a cap buys pictures rather than time.
 */
export function stretchThreshold(d: Pick<PlanDials, 'dwellS' | 'minStepS'>): number {
  return Math.max(1, Math.floor(d.dwellS / Math.max(0.001, d.minStepS)));
}

/** The most of one step a dissolve may take, so a frame is still for the rest of it. */
export const DISSOLVE_SHARE = 0.5;

/**
 * How long one frame of a run takes to dissolve into the next: the dial,
 * capped at a share of the step.
 *
 * The cap is what makes the two screens fade alike. A step is the dwell over
 * the run, so a camera with twelve frames at a 20 s dwell gets a 1.67 s step:
 * uncapped, the 1.5 s dial fills it and that screen never rests, while a
 * three-frame run dissolves for 1.5 s and then holds for 5. One dial, two
 * rhythms — reported 2026-09-06 as the sunset side fading at a different rate
 * from the sunrise side.
 */
export function stepFadeS(sameCameraFadeS: number, p: Pick<DwellPlan, 'stepS'>): number {
  return Math.min(Math.max(0, sameCameraFadeS), p.stepS * DISSOLVE_SHARE);
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
  // The run's own clock starts when the arrival ends; frame 1 is up throughout the arrival.
  const index = Math.min(p.frames - 1, Math.floor(Math.max(0, t - p.arrivalS) / p.stepS));
  const leadStart = p.dwellS - p.leadS;
  const leadProgress = p.leadS > 0 ? Math.min(1, Math.max(0, (t - leadStart) / p.leadS)) : 0;
  return { index, leadProgress };
}

/** The line the studio prints: `4 frames × 5 s`, `1 frame · 20 s`, `· lead 4 s` when the lead is on, `· arrival 1.5 s` when there is one. */
export function describePlan(p: DwellPlan): string {
  const s = (n: number) => `${Number(n.toFixed(1))} s`;
  const frames = p.frames === 1 ? `1 frame · ${s(p.dwellS - p.arrivalS)}` : `${p.frames} frames × ${s(p.stepS)}`;
  const lead = p.leadS > 0 ? ` · lead ${s(p.leadS)}` : '';
  const arrival = p.arrivalS > 0 ? ` · arrival ${s(p.arrivalS)}` : '';
  return `${frames}${lead}${arrival}`;
}
