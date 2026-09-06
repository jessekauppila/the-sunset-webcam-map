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

export type PlanDials = Pick<Solo2Dials, 'dwellS' | 'leadS'>;

/** `frames` frames share the dwell evenly. The lead is capped at the dwell. */
export function fitPlan(d: PlanDials, frames: number): DwellPlan {
  const n = Math.max(1, Math.floor(frames));
  return { dwellS: d.dwellS, frames: n, stepS: d.dwellS / n, leadS: Math.min(d.dwellS, Math.max(0, d.leadS)) };
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
