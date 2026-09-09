import { describe, it, expect } from 'vitest';
import { arrivalS, describePlan, exitS, fitPlan, planOf, stageAt, stepFadeS, stretchThreshold } from './plan';

const D = { dwellS: 20, leadS: 4, minStepS: 4 };

describe('fitPlan: the budget rule', () => {
  it('below the threshold the frames divide the budget and the dwell does not move', () => {
    // Jesse's own numbers: one image holds the full 20 s, five hold 4 s each.
    expect(fitPlan(D, 1)).toEqual({ dwellS: 20, frames: 1, stepS: 20, lastStepS: 20, leadS: 4, arrivalS: 0, exitS: 0 });
    expect(fitPlan(D, 2)).toEqual({ dwellS: 20, frames: 2, stepS: 10, lastStepS: 10, leadS: 4, arrivalS: 0, exitS: 0 });
    expect(fitPlan(D, 5)).toEqual({ dwellS: 20, frames: 5, stepS: 4, lastStepS: 4, leadS: 4, arrivalS: 0, exitS: 0 });
    expect(fitPlan(D, 3).stepS).toBeCloseTo(6.667, 3);
    expect(fitPlan(D, 3).dwellS).toBeCloseTo(20, 6);
  });
  it('above it the DWELL stretches rather than the frames shrinking', () => {
    // This is the whole change: a run is a timelapse, and a timelapse has one
    // step. Eight frames run 4 s each for 32 s, not 2.5 s each for 20 s.
    expect(fitPlan(D, 6)).toEqual({ dwellS: 24, frames: 6, stepS: 4, lastStepS: 4, leadS: 4, arrivalS: 0, exitS: 0 });
    expect(fitPlan(D, 8)).toEqual({ dwellS: 32, frames: 8, stepS: 4, lastStepS: 4, leadS: 4, arrivalS: 0, exitS: 0 });
    expect(fitPlan(D, 12).stepS).toBe(4);
    expect(fitPlan(D, 12).dwellS).toBe(48);
  });
  it('at least one frame; the lead never exceeds the dwell it is measured against', () => {
    expect(fitPlan(D, 0)).toEqual({ dwellS: 20, frames: 1, stepS: 20, lastStepS: 20, leadS: 4, arrivalS: 0, exitS: 0 });
    expect(fitPlan({ dwellS: 5, leadS: 8, minStepS: 4 }, 1).leadS).toBe(5);
    expect(fitPlan({ dwellS: 5, leadS: -1, minStepS: 4 }, 1).leadS).toBe(0);
    // A stretched dwell gives the lead more room: 30 s of lead fits inside a
    // 32 s dwell, where the 20 s budget alone would have clipped it.
    expect(fitPlan({ dwellS: 20, leadS: 30, minStepS: 4 }, 8).leadS).toBe(30);
    expect(fitPlan({ dwellS: 20, leadS: 30, minStepS: 4 }, 1).leadS).toBe(20);
  });
});

describe('the arrival segment: the camera change is added before frame 1, not charged against it', () => {
  // Reported 2026-09-07 on the studio preview: the first frame of a run
  // looked shorter than the others. It was. The dip's veil covered the old
  // picture and the new one faded up inside frame 1's own share of the dwell,
  // so frame 1 held for stepS - fadeS while every later frame held for stepS.
  const F = { transition: 'dip' as const, fadeS: 1.5, sameCameraFadeS: 1.5 };

  it('is the longest fade the dwell might open with: the camera change, or the same-camera dissolve', () => {
    expect(arrivalS(F)).toBe(1.5);
    // A dip is two halves and only the rise is an arrival; a crossfade is one gesture, all of it.
    expect(arrivalS({ ...F, fadeS: 3 })).toBe(1.5);
    expect(arrivalS({ ...F, transition: 'crossfade', fadeS: 3 })).toBe(3);
    expect(arrivalS({ ...F, sameCameraFadeS: 4 })).toBe(4);
    // A cut has no camera-change fade, but a later frame of the same camera still dissolves in.
    expect(arrivalS({ ...F, transition: 'cut' })).toBe(1.5);
    expect(arrivalS({ transition: 'cut', fadeS: 1.5, sameCameraFadeS: 0 })).toBe(0);
    // Dials without fades (solo, old fixtures) have no arrival at all.
    expect(arrivalS({})).toBe(0);
    expect(arrivalS({ transition: 'crossfade', fadeS: -1, sameCameraFadeS: -1 })).toBe(0);
  });

  it('sits on top of the budget: the frames still divide dwellS, and the dwell is arrivalS longer', () => {
    expect(fitPlan({ ...D, ...F }, 5)).toEqual({ dwellS: 21.5, frames: 5, stepS: 4, lastStepS: 4, leadS: 4, arrivalS: 1.5, exitS: 0.75 });
    expect(fitPlan({ ...D, ...F }, 1)).toEqual({ dwellS: 21.5, frames: 1, stepS: 20, lastStepS: 20, leadS: 4, arrivalS: 1.5, exitS: 0.75 });
    // A stretched run stretches from the same base.
    expect(fitPlan({ ...D, ...F }, 8)).toEqual({ dwellS: 33.5, frames: 8, stepS: 4, lastStepS: 4, leadS: 4, arrivalS: 1.5, exitS: 0.75 });
  });

  it('does not move the stretch threshold: the frames\' budget is still dwellS', () => {
    for (let frames = 1; frames <= 5; frames++) expect(fitPlan({ ...D, ...F }, frames).dwellS).toBeCloseTo(21.5, 6);
    expect(fitPlan({ ...D, ...F }, 6).dwellS).toBeCloseTo(25.5, 6);
  });

  it('the stage clock waits out the arrival, so frame 1 holds a whole step once it is up', () => {
    const p = fitPlan({ ...D, ...F }, 4); // 1.5 s arrival, then 4 × 5 s
    expect(stageAt(0, p).index).toBe(0);
    expect(stageAt(1_499, p).index).toBe(0);
    expect(stageAt(1_500, p).index).toBe(0);
    expect(stageAt(6_499, p).index).toBe(0); // frame 1 is still up 5 s after it finished arriving
    expect(stageAt(6_500, p).index).toBe(1);
    expect(stageAt(16_500, p).index).toBe(3);
    expect(stageAt(30_000, p).index).toBe(3);
  });

  it('the lead still measures back from the end of the whole dwell', () => {
    const p = fitPlan({ ...D, ...F }, 4); // dwell 21.5 s, lead over 17.5–21.5
    expect(stageAt(17_499, p).leadProgress).toBe(0);
    expect(stageAt(19_500, p).leadProgress).toBe(0.5);
    expect(stageAt(21_500, p).leadProgress).toBe(1);
  });

  it('the studio line names it', () => {
    expect(describePlan(fitPlan({ dwellS: 20, leadS: 0, minStepS: 4, ...F }, 4))).toBe('4 frames × 5 s · arrival 1.5 s · exit 0.8 s');
    expect(describePlan(fitPlan({ dwellS: 20, leadS: 0, minStepS: 4, ...F }, 1))).toBe('1 frame · 20 s · arrival 1.5 s · exit 0.8 s');
    expect(describePlan(fitPlan({ ...D, ...F }, 4))).toBe('4 frames × 5 s · lead 4 s · arrival 1.5 s · exit 0.8 s');
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

describe('planOf: the budget rule run backward from a pinned total', () => {
  it('spreads the pinned span across the frames, after the arrival', () => {
    const p = planOf(22, 4, { ...D, transition: 'dip', fadeS: 6 });
    expect(p.dwellS).toBe(22);
    expect(p.frames).toBe(4);
    expect(p.arrivalS).toBe(3); // the rise half of the dip
    expect(p.exitS).toBe(3); // the burn half, inside the last step
    expect(p.stepS).toBe(4.75); // (22 - 3) / 4
    expect(p.lastStepS).toBe(4.75); // the exit fits inside an even share
  });

  it('gives the last frame more than an even share when its dissolve-in and the exit will not fit one', () => {
    // 3 s exit, 2 s dissolve-in, 4 s share: the last frame needs 5, the others
    // give it up. 3 + 4×3 + 5 = 20 — what fitPlan sizes at the live dials.
    const dials = { ...D, minStepS: 4, transition: 'dip' as const, fadeS: 6, sameCameraFadeS: 2 };
    const forward = fitPlan({ ...dials, dwellS: 12 }, 4);
    expect(forward).toMatchObject({ dwellS: 20, stepS: 4, lastStepS: 5, arrivalS: 3, exitS: 3 });
    const back = planOf(20, 4, dials);
    expect(back.stepS).toBeCloseTo(4, 6);
    expect(back.lastStepS).toBeCloseTo(5, 6);
  });

  it('is the inverse of fitPlan: what fitPlan sized, planOf takes apart again', () => {
    const dials = { ...D, transition: 'dip' as const, fadeS: 6 };
    const forward = fitPlan(dials, 4);
    const back = planOf(forward.dwellS, 4, dials);
    expect(back).toEqual(forward);
  });

  it('ignores the dwell dial: the pinned span is the whole authority', () => {
    // The dial says 20 s and the floor says 4 s a frame, which would size 3
    // frames at 20 s. The draw pinned 62 s, so each frame gets 18.67 s.
    const p = planOf(62, 3, { ...D, transition: 'dip', fadeS: 6 });
    expect(p.dwellS).toBe(62);
    expect(p.stepS).toBeCloseTo(19.667, 3); // (62 - 3) / 3
  });

  it('never leaves a step of zero, whatever a degenerate span asks for', () => {
    // stageAt divides by the step; a zero would make the frame index NaN and
    // the glass render nothing.
    const p = planOf(0, 3, { ...D, transition: 'dip', fadeS: 6 });
    expect(p.stepS).toBeGreaterThan(0);
    expect(p.arrivalS).toBe(0); // clamped to the total, so the step stays positive
    expect(stageAt(1000, p).index).toBe(2);
  });

  it('caps the lead at the pinned span', () => {
    expect(planOf(3, 1, { ...D, leadS: 9 }).leadS).toBe(3);
  });
});

describe('the exit: a dip is charged half to the dwell it leaves', () => {
  // Reported 2026-09-08: the last picture of a run "stuck for an awful long
  // time". The whole 6 s change was reserved at the front of the ARRIVING
  // dwell, so the leaving dwell's last frame held a full still step and only
  // then began to burn — ten seconds between the last new picture of a run
  // and the first of the next, against four through the middle.
  const live = { dwellS: 13, leadS: 0, minStepS: 4, transition: 'dip' as const, fadeS: 6, sameCameraFadeS: 2 };

  it('exists only for a dip', () => {
    expect(exitS(live)).toBe(3);
    expect(exitS({ ...live, transition: 'crossfade' })).toBe(0);
    expect(exitS({ ...live, transition: 'cut' })).toBe(0);
    expect(exitS({})).toBe(0);
  });

  it('shortens the whole dwell by the half that now belongs to the leaving side', () => {
    // Before: 6 + 4×4 = 22. Now: 3 + 4×3 + max(4, 2 + 3) = 20.
    expect(fitPlan(live, 4).dwellS).toBe(20);
    // At a change no longer than the step it fits inside the last frame and costs nothing.
    expect(fitPlan({ ...live, fadeS: 4 }, 4)).toMatchObject({ dwellS: 18, stepS: 4, lastStepS: 4, arrivalS: 2, exitS: 2 });
  });

  it('a lone frame has no dissolve-in, so only the exit has to fit', () => {
    // Budget 13 shares nothing; 13 > 3, so the frame holds 13 and burns over its last 3.
    expect(fitPlan(live, 1)).toMatchObject({ dwellS: 16, stepS: 13, lastStepS: 13, exitS: 3 });
  });

  it('stageAt reports the exit over the last exitS, and the run index stays on the last frame through it', () => {
    const p = fitPlan(live, 4); // 3 arrival, 4 4 4, last 5 (2 in + 3 burn): burn 17–20
    expect(stageAt(16_999, p).exitProgress).toBe(0);
    expect(stageAt(17_000, p).exitProgress).toBe(0);
    expect(stageAt(18_500, p).exitProgress).toBe(0.5);
    expect(stageAt(20_000, p).exitProgress).toBe(1);
    expect(stageAt(18_500, p).index).toBe(3);
    // No exit, no progress.
    expect(stageAt(19_000, fitPlan({ ...live, transition: 'crossfade' }, 4)).exitProgress).toBe(0);
  });

  it('the studio line says so, and names the longer last frame', () => {
    expect(describePlan(fitPlan(live, 4))).toBe('4 frames × 4 s · last 5 s · arrival 3 s · exit 3 s');
    expect(describePlan(fitPlan({ ...live, fadeS: 4 }, 4))).toBe('4 frames × 4 s · arrival 2 s · exit 2 s');
  });
});
