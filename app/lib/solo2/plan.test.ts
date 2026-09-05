import { describe, it, expect } from 'vitest';
import { MIN_HOLD_S, describePlan, fitPlan, stageAt, type DwellPlan } from './plan';

const base = { dwellS: 20, prelude: true, preludeFrames: 3, preludeStepS: 1.5, leadS: 4 };

describe('fitPlan', () => {
  it('fits as-is when there is room', () => {
    expect(fitPlan(base, 5)).toEqual({ dwellS: 20, preludeFrames: 3, preludeStepS: 1.5, leadS: 4, holdS: 11.5, clamped: false });
  });
  it('prelude off means no prelude frames, whatever is available', () => {
    expect(fitPlan({ ...base, prelude: false }, 5).preludeFrames).toBe(0);
  });
  it('never asks for more frames than the camera has', () => {
    expect(fitPlan(base, 1).preludeFrames).toBe(1);
    expect(fitPlan(base, 0).preludeFrames).toBe(0);
  });
  it('drops prelude frames first until the hold is at least the floor', () => {
    // 8 s dwell: 3×1.5 + 4 leaves −0.5 → 2 frames leaves 1 → 1 frame leaves 2.5 → 0 frames leaves 4 ≥ 3.
    const p = fitPlan({ ...base, dwellS: 8 }, 5);
    expect(p).toMatchObject({ preludeFrames: 0, leadS: 4, holdS: 4, clamped: true });
  });
  it('then shortens the lead', () => {
    const p = fitPlan({ ...base, dwellS: 6, prelude: false }, 0);
    expect(p).toMatchObject({ preludeFrames: 0, leadS: 3, holdS: MIN_HOLD_S, clamped: true });
  });
  it('a dwell shorter than the floor gives lead 0 and whatever hold remains', () => {
    expect(fitPlan({ ...base, dwellS: 2, prelude: false }, 0)).toMatchObject({ leadS: 0, holdS: 2, clamped: true });
  });
});

describe('stageAt', () => {
  const p: DwellPlan = { dwellS: 20, preludeFrames: 3, preludeStepS: 1.5, leadS: 4, holdS: 11.5, clamped: false };
  it('walks the prelude by elapsed time', () => {
    expect(stageAt(0, p)).toEqual({ layer: 'prelude', index: 0 });
    expect(stageAt(1_499, p)).toEqual({ layer: 'prelude', index: 0 });
    expect(stageAt(1_500, p)).toEqual({ layer: 'prelude', index: 1 });
    expect(stageAt(4_499, p)).toEqual({ layer: 'prelude', index: 2 });
  });
  it('then holds the main frame with no lead', () => {
    expect(stageAt(4_500, p)).toEqual({ layer: 'main', leadProgress: 0 });
    expect(stageAt(15_999, p)).toEqual({ layer: 'main', leadProgress: 0 });
  });
  it('leads linearly over the last seconds, clamped at 1', () => {
    expect(stageAt(16_000, p)).toEqual({ layer: 'main', leadProgress: 0 });
    expect(stageAt(18_000, p)).toEqual({ layer: 'main', leadProgress: 0.5 });
    expect(stageAt(20_000, p)).toEqual({ layer: 'main', leadProgress: 1 });
    expect(stageAt(25_000, p)).toEqual({ layer: 'main', leadProgress: 1 });
  });
  it('negative elapsed is the first stage; no prelude means main from the start', () => {
    expect(stageAt(-500, p)).toEqual({ layer: 'prelude', index: 0 });
    expect(stageAt(0, { ...p, preludeFrames: 0, holdS: 16 })).toEqual({ layer: 'main', leadProgress: 0 });
  });
  it('lead 0 never moves', () => {
    expect(stageAt(19_999, { ...p, leadS: 0, holdS: 15.5 })).toEqual({ layer: 'main', leadProgress: 0 });
  });
});

describe('describePlan', () => {
  it('prints the budget and marks a clamp', () => {
    expect(describePlan(fitPlan(base, 5))).toBe('prelude 4.5 s + lead 4 s + hold 11.5 s');
    expect(describePlan(fitPlan({ ...base, dwellS: 8 }, 5))).toBe('prelude 0 s + lead 4 s + hold 4 s (clamped)');
  });
});
