import type { Solo2Dials } from './types';

/** One dwell's timeline, in seconds (camera-run spec §4.1). */
export interface DwellPlan {
  /** The whole dwell: the arrival, then the frames, the last of which carries the exit. */
  dwellS: number;
  /** Frames the dwell plays, at least 1. */
  frames: number;
  /** Each frame's even share of the frames' budget. */
  stepS: number;
  /**
   * The last frame's step: a whole `stepS` of its own, plus the exit. The
   * burn is ADDED to it rather than taken out of it, so the last picture
   * holds as still, and for as long, as every other frame of the run.
   */
  lastStepS: number;
  leadS: number;
  /**
   * The camera change's own segment at the front of the dwell (dwell-budget
   * spec §3.3). Frame 1's step begins when it ends, so the first frame holds
   * as long as every other. 0 for dials without fades.
   *
   * For a dip this is the RISE only — the half of the change that shows this
   * dwell's first picture. The half that showed the previous dwell's last
   * picture is that dwell's `exitS`.
   */
  arrivalS: number;
  /**
   * The burn-out at the END of the dwell, AFTER the last frame's step: the
   * seconds the last picture spends going down into the veil before the next
   * dwell rises out of it. 0 unless the change is a dip.
   *
   * Charged to this dwell rather than to the next one's arrival because the
   * picture on glass during it is THIS dwell's. Until 2026-09-08 the whole
   * change was reserved at the front of the incoming dwell, so the outgoing
   * one's last frame held a full still step and only then began to burn: at a
   * 6 s change and a 4 s step, ten seconds between the last new picture of a
   * run and the first of the next, against four through the middle.
   */
  exitS: number;
}

/**
 * The fade dials are optional so that solo's dials, which have no camera
 * change, plan a dwell with no arrival — and so do fixtures that predate it.
 */
export type PlanDials = Pick<Solo2Dials, 'dwellS' | 'leadS' | 'minStepS'>
  & Partial<Pick<Solo2Dials, 'transition' | 'fadeS' | 'sameCameraFadeS'>>;

type FadeDials = Partial<Pick<Solo2Dials, 'transition' | 'fadeS' | 'sameCameraFadeS'>>;

/**
 * The seconds of the camera change that show THIS dwell's first picture. A
 * crossfade is one gesture, all of it spent with the new picture arriving
 * over the old; a dip is two halves through a veil, and only the second
 * shows the new picture. Cut: none.
 */
function riseS(d: FadeDials): number {
  const fade = Math.max(0, d.fadeS ?? 0);
  if (d.transition === 'dip') return fade / 2;
  if (d.transition === 'crossfade') return fade;
  return 0;
}

/**
 * How long the front of a dwell is spent arriving (dwell-budget spec §3.3).
 * Sized for the longest arrival the dwell might open with — the camera
 * change's rise, or the same-camera dissolve — because the server sizes a
 * dwell without knowing what was on glass before it. When the actual arrival
 * is shorter, frame 1 simply holds for the rest.
 */
export function arrivalS(d: FadeDials): number {
  return Math.max(riseS(d), Math.max(0, d.sameCameraFadeS ?? 0));
}

/** The seconds at the end of a dwell spent burning its last picture down into the veil. Only a dip has one. */
export function exitS(d: FadeDials): number {
  return d.transition === 'dip' ? Math.max(0, d.fadeS ?? 0) / 2 : 0;
}

/**
 * The last frame's step: a whole step, plus the exit on the end of it.
 *
 * The burn is added rather than absorbed. Absorbing it — `max(stepS,
 * dissolveIn + exit)` until 2026-09-08 — spent the last frame's still time on
 * the burn: at the live dials (4 s step, 2 s dissolve, 6 s change) the last
 * picture of every run finished arriving at the instant it began to leave and
 * was never once still, and shortening the change to 3 s handed back half a
 * second of it, which read on glass as a flash. The sunrise screen showed it
 * worst, where an `exposure` veil blows the picture out to white.
 */
function lastStepFor(stepS: number, exit: number): number {
  return stepS + exit;
}

/**
 * The budget rule (dwell-budget spec §3). `dwellS` is a budget the run's
 * frames share, floored at `minStepS`, and the arrival sits in front of it:
 *
 *     perFrame = max(minStepS, dwellS / n)
 *     total    = arrivalS + perFrame * n + exitS
 *
 * At or below `n* = floor(dwellS / minStepS)` frames the budget is merely
 * divided more finely and the total stays `dwellS` — one image holds the
 * whole 20 s, five hold 4 s each. Above it the DWELL STRETCHES rather than
 * the frames shrinking, which is the whole point: a run is a timelapse and a
 * timelapse has one step, so eight frames run 4 s each for 32 s.
 *
 * The change's two halves sit OUTSIDE the frames' budget, one at each end:
 * the rise in front, the burn behind. No frame ever spends its own step
 * arriving or leaving, so every picture in a run holds equally still.
 *
 * `plan.dwellS` is therefore the total this dwell occupies, not the dial.
 * The lead is capped at that total.
 */
export function fitPlan(d: PlanDials, frames: number): DwellPlan {
  const n = Math.max(1, Math.floor(frames));
  const stepS = Math.max(d.minStepS, d.dwellS / n);
  const arrival = arrivalS(d);
  const exit = exitS(d);
  const lastStepS = lastStepFor(stepS, exit);
  const totalS = arrival + stepS * (n - 1) + lastStepS;
  return { dwellS: totalS, frames: n, stepS, lastStepS, leadS: Math.min(totalS, Math.max(0, d.leadS)), arrivalS: arrival, exitS: exit };
}

/**
 * The plan for a dwell whose total is already DECIDED — the span the server
 * pinned at the draw and published as `endsAtMs`.
 *
 * `fitPlan` runs the budget rule forward, from a dial to a total. This runs it
 * backward, from a total to a step, and it is what any surface rendering a
 * live dwell should use. The difference matters because the forward rule reads
 * the pool, and the pool moves: recomputing mid-dwell re-sized the step and the
 * frame count under a clock that had already started, which stepped the run to
 * a different picture and made the caption's "minutes ago" jump upward instead
 * of counting down (reported 2026-09-08).
 *
 * The arrival still comes from the dials, since it is the fade's own length and
 * not a function of the pool. It is clamped to the total so a short pinned
 * dwell cannot leave a negative step.
 */
export function planOf(totalS: number, frames: number, d: PlanDials): DwellPlan {
  const n = Math.max(1, Math.floor(frames));
  const total = Math.max(0, totalS);
  const arrival = Math.min(arrivalS(d), total);
  const exit = Math.min(exitS(d), total - arrival);
  // Both halves of the change come off the top; what is left is the frames'
  // own, shared evenly, and the burn goes back on the end of the last one.
  const runS = total - arrival - exit;
  const stepS = runS / n;
  const lastStepS = lastStepFor(stepS, exit);
  return {
    dwellS: total,
    frames: n,
    stepS: Math.max(0.001, stepS),
    lastStepS: Math.max(0.001, lastStepS),
    leadS: Math.min(total, Math.max(0, d.leadS)),
    arrivalS: arrival,
    exitS: exit,
  };
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
  /**
   * 0 until the exit begins, 1 at the boundary. Positive only over the last
   * `exitS` of the dwell, which is when the glass burns its last picture down
   * into the veil. Always 0 for a plan with no exit.
   */
  exitProgress: number;
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
  const exit = p.exitS ?? 0;
  const exitStart = p.dwellS - exit;
  const exitProgress = exit > 0 ? Math.min(1, Math.max(0, (t - exitStart) / exit)) : 0;
  return { index, leadProgress, exitProgress };
}

/**
 * The line the studio prints: `4 frames × 5 s`, `1 frame · 20 s`, `· lead 4 s`
 * when the lead is on, `· arrival 1.5 s` when there is one, `· exit 3 s` when
 * the change is a dip and the last picture burns down after its step.
 *
 * The last frame's step is not named: it is always the step plus the exit now,
 * so naming it would only repeat the exit back.
 */
export function describePlan(p: DwellPlan): string {
  const s = (n: number) => `${Number(n.toFixed(1))} s`;
  const frames = p.frames === 1 ? `1 frame · ${s(p.stepS)}` : `${p.frames} frames × ${s(p.stepS)}`;
  const lead = p.leadS > 0 ? ` · lead ${s(p.leadS)}` : '';
  const arrival = p.arrivalS > 0 ? ` · arrival ${s(p.arrivalS)}` : '';
  const exit = p.exitS > 0 ? ` · exit ${s(p.exitS)}` : '';
  return `${frames}${lead}${arrival}${exit}`;
}
