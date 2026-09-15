/**
 * The beat (beat spec §2). Every frame change on both screens lands on one
 * tick of the wall clock; a frame is one beat; a dwell is whole beats.
 */

/** The beats a dial may choose: divisors of 60, so ticks fall on seconds 0, b, 2b … of every minute. */
export const BEAT_OPTIONS = [2, 3, 4, 5, 6, 10, 12, 15, 20, 30] as const;

/** The tick closest to `ms`. The advance uses this: the kiosk fires at a tick and the request lands a little after it. */
export function nearestTick(ms: number, beatS: number): number {
  const b = Math.max(1, beatS) * 1000;
  return Math.round(ms / b) * b;
}

/** The first tick at or after `ms`. */
export function nextTick(ms: number, beatS: number): number {
  const b = Math.max(1, beatS) * 1000;
  return Math.ceil(ms / b) * b;
}

/**
 * One dwell's timeline. The seconds fields are what the glass, the preview
 * and the tape render from and keep their meaning; the beat fields say how
 * they were made. `exitS` is always 0 on the beat: the whole camera change
 * is the arriving dwell's change beat (spec §2.2).
 */
export interface DwellPlan {
  /** The whole dwell, seconds: `totalBeats × beatS`. */
  dwellS: number;
  /** Frames the dwell plays, at least 1. */
  frames: number;
  /** One beat. */
  stepS: number;
  /** The last frame's step: one beat plus the rest. */
  lastStepS: number;
  leadS: number;
  /** The change beat at the front, seconds; frame 1's own beat begins when it ends. */
  arrivalS: number;
  /** Always 0 (kept so older renderers read the same shape). */
  exitS: number;
  beatS: number;
  /** Beats of veil at the front; 0 for a cut. */
  changeBeats: number;
  /** Extra beats on the last frame, so a short run still holds the dwell floor (spec §2.3). */
  restBeats: number;
  /** `changeBeats + frames + restBeats`. */
  totalBeats: number;
}

/** What `fitPlan` reads. `transition` decides whether the change beat exists; `sameCameraFadeS` is for `stepFadeS`. */
export interface PlanDials {
  beatS: number;
  dwellBeats: number;
  changeBeats: number;
  leadS: number;
  transition?: 'cut' | 'crossfade' | 'dip';
  sameCameraFadeS?: number;
}

/** Beats of change at the front of a dwell: none for a cut, else the dial. */
function changeBeatsOf(d: Pick<PlanDials, 'changeBeats' | 'transition'>): number {
  if (d.transition === 'cut') return 0;
  return Math.max(0, Math.floor(d.changeBeats));
}

/**
 * The beat rule (spec §2.2, §2.3):
 *
 *     rest  = max(0, dwellBeats − n)
 *     total = change + n + rest
 *
 * The rate never changes. A run shorter than the dwell floor rests on its
 * last frame, the picture it arrived at; a longer run simply takes more beats.
 */
export function fitPlan(d: PlanDials, frames: number): DwellPlan {
  const n = Math.max(1, Math.floor(frames));
  const beatS = Math.max(0.001, d.beatS);
  const changeBeats = changeBeatsOf(d);
  const restBeats = Math.max(0, Math.floor(d.dwellBeats) - n);
  const totalBeats = changeBeats + n + restBeats;
  const dwellS = totalBeats * beatS;
  return {
    dwellS,
    frames: n,
    stepS: beatS,
    lastStepS: beatS * (1 + restBeats),
    leadS: Math.min(dwellS, Math.max(0, d.leadS)),
    arrivalS: changeBeats * beatS,
    exitS: 0,
    beatS,
    changeBeats,
    restBeats,
    totalBeats,
  };
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
 * The line the studio prints: `8 frames × 4 s · 1 beat change`, `1 frame ×
 * 4 s · 1 beat change · rests 2 beats`, `· lead 4 s` when the lead is on.
 */
export function describePlan(p: DwellPlan): string {
  const s = (n: number) => `${Number(n.toFixed(1))} s`;
  const beats = (n: number) => `${n} beat${n === 1 ? '' : 's'}`;
  const frames = `${p.frames} frame${p.frames === 1 ? '' : 's'} × ${s(p.stepS)}`;
  const change = p.changeBeats > 0 ? ` · ${beats(p.changeBeats)} change` : '';
  const rest = p.restBeats > 0 ? ` · rests ${beats(p.restBeats)}` : '';
  const lead = p.leadS > 0 ? ` · lead ${s(p.leadS)}` : '';
  return `${frames}${change}${rest}${lead}`;
}
