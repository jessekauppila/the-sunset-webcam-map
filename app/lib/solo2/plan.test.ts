import { describe, it, expect } from 'vitest';
import { describePlan, fitPlan, stageAt, stepFadeS, stretchThreshold } from './plan';

const D = { dwellS: 20, leadS: 4, minStepS: 4 };

describe('fitPlan: the budget rule', () => {
  it('below the threshold the frames divide the budget and the dwell does not move', () => {
    // Jesse's own numbers: one image holds the full 20 s, five hold 4 s each.
    expect(fitPlan(D, 1)).toEqual({ dwellS: 20, frames: 1, stepS: 20, leadS: 4 });
    expect(fitPlan(D, 2)).toEqual({ dwellS: 20, frames: 2, stepS: 10, leadS: 4 });
    expect(fitPlan(D, 5)).toEqual({ dwellS: 20, frames: 5, stepS: 4, leadS: 4 });
    expect(fitPlan(D, 3).stepS).toBeCloseTo(6.667, 3);
    expect(fitPlan(D, 3).dwellS).toBeCloseTo(20, 6);
  });
  it('above it the DWELL stretches rather than the frames shrinking', () => {
    // This is the whole change: a run is a timelapse, and a timelapse has one
    // step. Eight frames run 4 s each for 32 s, not 2.5 s each for 20 s.
    expect(fitPlan(D, 6)).toEqual({ dwellS: 24, frames: 6, stepS: 4, leadS: 4 });
    expect(fitPlan(D, 8)).toEqual({ dwellS: 32, frames: 8, stepS: 4, leadS: 4 });
    expect(fitPlan(D, 12).stepS).toBe(4);
    expect(fitPlan(D, 12).dwellS).toBe(48);
  });
  it('at least one frame; the lead never exceeds the dwell it is measured against', () => {
    expect(fitPlan(D, 0)).toEqual({ dwellS: 20, frames: 1, stepS: 20, leadS: 4 });
    expect(fitPlan({ dwellS: 5, leadS: 8, minStepS: 4 }, 1).leadS).toBe(5);
    expect(fitPlan({ dwellS: 5, leadS: -1, minStepS: 4 }, 1).leadS).toBe(0);
    // A stretched dwell gives the lead more room: 30 s of lead fits inside a
    // 32 s dwell, where the 20 s budget alone would have clipped it.
    expect(fitPlan({ dwellS: 20, leadS: 30, minStepS: 4 }, 8).leadS).toBe(30);
    expect(fitPlan({ dwellS: 20, leadS: 30, minStepS: 4 }, 1).leadS).toBe(20);
  });
});

describe('stretchThreshold', () => {
  it('is the budget over the floor: the point where a cap starts costing time', () => {
    expect(stretchThreshold({ dwellS: 20, minStepS: 4 })).toBe(5);
    expect(stretchThreshold({ dwellS: 20, minStepS: 6 })).toBe(3);
    expect(stretchThreshold({ dwellS: 60, minStepS: 4 })).toBe(15);
  });
  it('a cap at or below it buys pictures, never screen time (spec §4.1)', () => {
    const n = stretchThreshold(D);
    for (let frames = 1; frames <= n; frames++) expect(fitPlan(D, frames).dwellS).toBeCloseTo(D.dwellS, 6);
    expect(fitPlan(D, n + 1).dwellS).toBeGreaterThan(D.dwellS);
  });
});

describe('stageAt', () => {
  const p = fitPlan(D, 4);
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
    expect(describePlan(fitPlan({ dwellS: 20, leadS: 0, minStepS: 4 }, 4))).toBe('4 frames × 5 s');
    expect(describePlan(fitPlan({ dwellS: 20, leadS: 0, minStepS: 4 }, 3))).toBe('3 frames × 6.7 s');
    // A stretched run: the step holds at the floor and the total grows.
    expect(describePlan(fitPlan({ dwellS: 20, leadS: 0, minStepS: 4 }, 8))).toBe('8 frames × 4 s');
    expect(describePlan(fitPlan({ dwellS: 20, leadS: 0, minStepS: 4 }, 1))).toBe('1 frame · 20 s');
    expect(describePlan(fitPlan(D, 4))).toBe('4 frames × 5 s · lead 4 s');
  });
});

describe('stepFadeS', () => {
  it('gives the dial when the step is long enough to hold it and still rest', () => {
    expect(stepFadeS(1.5, { stepS: 6.67 })).toBe(1.5);
  });
  it('caps at half the step, so a long run cannot spend the whole step dissolving', () => {
    // The reported sunrise/sunset difference: 12 frames over a 20 s dwell is a
    // 1.67 s step, which the 1.5 s dial would have filled end to end. The
    // budget's floor normally prevents a step that short — at the default
    // minStepS of 4 s the dwell stretches instead — so this is the case an
    // operator creates by dropping the floor to the bottom of its range.
    expect(stepFadeS(1.5, fitPlan({ dwellS: 20, leadS: 0, minStepS: 1 }, 12))).toBeCloseTo(0.833, 3);
    expect(stepFadeS(1.5, fitPlan({ dwellS: 20, leadS: 0, minStepS: 1 }, 3))).toBe(1.5);
  });
  it('a dial at zero is still a cut, and a negative one cannot go below zero', () => {
    expect(stepFadeS(0, { stepS: 5 })).toBe(0);
    expect(stepFadeS(-2, { stepS: 5 })).toBe(0);
  });
});
