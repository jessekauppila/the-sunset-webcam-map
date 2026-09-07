import { describe, it, expect } from 'vitest';
import { describePlan, fitPlan, stageAt, stepFadeS } from './plan';

describe('fitPlan', () => {
  it('shares the dwell evenly between the frames', () => {
    expect(fitPlan({ dwellS: 20, leadS: 4 }, 4)).toEqual({ dwellS: 20, frames: 4, stepS: 5, leadS: 4 });
    expect(fitPlan({ dwellS: 20, leadS: 0 }, 3).stepS).toBeCloseTo(6.667, 3);
  });
  it('at least one frame; the lead never exceeds the dwell', () => {
    expect(fitPlan({ dwellS: 20, leadS: 4 }, 0)).toEqual({ dwellS: 20, frames: 1, stepS: 20, leadS: 4 });
    expect(fitPlan({ dwellS: 5, leadS: 8 }, 1).leadS).toBe(5);
    expect(fitPlan({ dwellS: 5, leadS: -1 }, 1).leadS).toBe(0);
  });
});

describe('stageAt', () => {
  const p = fitPlan({ dwellS: 20, leadS: 4 }, 4);
  it('walks the run by elapsed time and stays on the last frame', () => {
    expect(stageAt(0, p).index).toBe(0);
    expect(stageAt(4_999, p).index).toBe(0);
    expect(stageAt(5_000, p).index).toBe(1);
    expect(stageAt(15_000, p).index).toBe(3);
    expect(stageAt(25_000, p).index).toBe(3);
    expect(stageAt(-500, p).index).toBe(0);
  });
  it('leads linearly over the last seconds, clamped at 1, whichever frame is up', () => {
    expect(stageAt(15_999, p).leadProgress).toBe(0);
    expect(stageAt(16_000, p).leadProgress).toBe(0);
    expect(stageAt(18_000, p).leadProgress).toBe(0.5);
    expect(stageAt(20_000, p).leadProgress).toBe(1);
    expect(stageAt(25_000, p).leadProgress).toBe(1);
    expect(stageAt(19_999, { ...p, leadS: 0 }).leadProgress).toBe(0);
  });
});

describe('describePlan', () => {
  it('says frames × share, one frame for the dwell, and the lead when on', () => {
    expect(describePlan(fitPlan({ dwellS: 20, leadS: 0 }, 4))).toBe('4 frames × 5 s');
    expect(describePlan(fitPlan({ dwellS: 20, leadS: 0 }, 3))).toBe('3 frames × 6.7 s');
    expect(describePlan(fitPlan({ dwellS: 20, leadS: 0 }, 1))).toBe('1 frame · 20 s');
    expect(describePlan(fitPlan({ dwellS: 20, leadS: 4 }, 4))).toBe('4 frames × 5 s · lead 4 s');
  });
});

describe('stepFadeS', () => {
  it('gives the dial when the step is long enough to hold it and still rest', () => {
    expect(stepFadeS(1.5, { stepS: 6.67 })).toBe(1.5);
  });
  it('caps at half the step, so a long run cannot spend the whole step dissolving', () => {
    // The reported sunrise/sunset difference: 12 frames over a 20 s dwell is a
    // 1.67 s step, which the 1.5 s dial would have filled end to end.
    expect(stepFadeS(1.5, fitPlan({ dwellS: 20, leadS: 0 }, 12))).toBeCloseTo(0.833, 3);
    expect(stepFadeS(1.5, fitPlan({ dwellS: 20, leadS: 0 }, 3))).toBe(1.5);
  });
  it('a dial at zero is still a cut, and a negative one cannot go below zero', () => {
    expect(stepFadeS(0, { stepS: 5 })).toBe(0);
    expect(stepFadeS(-2, { stepS: 5 })).toBe(0);
  });
});
