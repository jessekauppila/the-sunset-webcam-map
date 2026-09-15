import { describe, it, expect } from 'vitest';
import { BEAT_OPTIONS, describePlan, fitPlan, nearestTick, nextTick, stageAt, stepFadeS } from './plan';

/** The live dials as the beat spec sets them: 4 s beat, a still of 3 beats, one beat of change. */
const D = { beatS: 4, dwellBeats: 3, changeBeats: 1, leadS: 0, transition: 'dip' as const, sameCameraFadeS: 2 };

describe('fitPlan: whole beats', () => {
  it('a frame is one beat; the change is one beat; the dwell floor rests on the last frame', () => {
    // One frame: change 1 + frame 1 + rest 2 = 4 beats = 16 s. The last (only) frame holds 3 beats.
    expect(fitPlan(D, 1)).toEqual({
      dwellS: 16, frames: 1, stepS: 4, lastStepS: 12, leadS: 0, arrivalS: 4, exitS: 0,
      beatS: 4, changeBeats: 1, restBeats: 2, totalBeats: 4,
    });
    // Two frames: change 1 + 2 + rest 1 = 4 beats; frame 1 holds one beat, frame 2 holds two.
    expect(fitPlan(D, 2)).toMatchObject({ dwellS: 16, frames: 2, stepS: 4, lastStepS: 8, restBeats: 1, totalBeats: 4 });
    // Three frames fill the floor exactly: no rest.
    expect(fitPlan(D, 3)).toMatchObject({ dwellS: 16, frames: 3, stepS: 4, lastStepS: 4, restBeats: 0, totalBeats: 4 });
    // Eight frames: change 1 + 8 = 9 beats = 36 s. The rate never changes.
    expect(fitPlan(D, 8)).toMatchObject({ dwellS: 36, frames: 8, stepS: 4, lastStepS: 4, restBeats: 0, totalBeats: 9 });
  });
  it('a cut has no change beat', () => {
    expect(fitPlan({ ...D, transition: 'cut' }, 3)).toMatchObject({ arrivalS: 0, changeBeats: 0, totalBeats: 3, dwellS: 12 });
    expect(fitPlan({ ...D, transition: 'crossfade' }, 3)).toMatchObject({ arrivalS: 4, changeBeats: 1, totalBeats: 4 });
    // Dials without a transition (older fixtures) read as a change of the given beats.
    expect(fitPlan({ beatS: 4, dwellBeats: 3, changeBeats: 1, leadS: 0 }, 3).changeBeats).toBe(1);
    expect(fitPlan({ beatS: 4, dwellBeats: 3, changeBeats: 0, leadS: 0 }, 3).changeBeats).toBe(0);
  });
  it('the beat is the step whatever the dial says', () => {
    expect(fitPlan({ ...D, beatS: 6 }, 5).stepS).toBe(6);
    expect(fitPlan({ ...D, beatS: 6 }, 5).dwellS).toBe(36); // 1 + 5 beats of 6 s
  });
  it('at least one frame; whole beats even from odd inputs; the lead is capped at the dwell', () => {
    expect(fitPlan(D, 0).frames).toBe(1);
    expect(fitPlan({ ...D, dwellBeats: 2.7, changeBeats: 1.9 }, 1)).toMatchObject({ changeBeats: 1, restBeats: 1, totalBeats: 3 });
    expect(fitPlan({ ...D, leadS: 30 }, 1).leadS).toBe(16);
    expect(fitPlan({ ...D, leadS: -1 }, 1).leadS).toBe(0);
    expect(fitPlan({ ...D, leadS: 3 }, 1).leadS).toBe(3);
  });
});

describe('the grid', () => {
  it('every option divides the minute, so ticks fall on seconds 0, 4, 8 … of every minute', () => {
    for (const b of BEAT_OPTIONS) expect(60 % b).toBe(0);
  });
  it('nearestTick rounds to the closest tick; nextTick is the first tick at or after', () => {
    const t0 = Date.UTC(2026, 8, 14, 17, 30, 0); // a minute boundary
    expect(nearestTick(t0, 4)).toBe(t0);
    expect(nearestTick(t0 + 300, 4)).toBe(t0);          // the advance landing 300 ms after the tick belongs to that tick
    expect(nearestTick(t0 + 1_999, 4)).toBe(t0);
    expect(nearestTick(t0 + 2_000, 4)).toBe(t0 + 4_000);
    expect(nearestTick(t0 + 3_700, 4)).toBe(t0 + 4_000);
    expect(nextTick(t0, 4)).toBe(t0);
    expect(nextTick(t0 + 1, 4)).toBe(t0 + 4_000);
    expect(nextTick(t0 + 4_000, 4)).toBe(t0 + 4_000);
    expect(nearestTick(t0 + 7_000, 6)).toBe(t0 + 6_000);
  });
});

describe('stageAt walks beats', () => {
  it('frame 1 is up through the change beat and its own beat; the last frame holds the rest', () => {
    const p = fitPlan(D, 2); // change 0–4 s, frame 1 4–8 s, frame 2 8–16 s
    expect(stageAt(0, p).index).toBe(0);
    expect(stageAt(3_999, p).index).toBe(0);
    expect(stageAt(7_999, p).index).toBe(0);
    expect(stageAt(8_000, p).index).toBe(1);
    expect(stageAt(15_999, p).index).toBe(1);
    expect(stageAt(40_000, p).index).toBe(1);
    expect(stageAt(8_000, p).exitProgress).toBe(0);
  });
  it('the lead measures back from the end of the whole dwell', () => {
    const p = fitPlan({ ...D, leadS: 4 }, 2); // 16 s dwell, lead over 12–16 s
    expect(stageAt(11_999, p).leadProgress).toBe(0);
    expect(stageAt(14_000, p).leadProgress).toBe(0.5);
    expect(stageAt(16_000, p).leadProgress).toBe(1);
  });
});

describe('stepFadeS', () => {
  it('caps the same-camera dissolve at half a beat', () => {
    expect(stepFadeS(2, fitPlan(D, 3))).toBe(2);
    expect(stepFadeS(5, fitPlan(D, 3))).toBe(2);
    expect(stepFadeS(5, fitPlan({ ...D, beatS: 6 }, 3))).toBe(3);
    expect(stepFadeS(-1, fitPlan(D, 3))).toBe(0);
  });
});

describe('describePlan', () => {
  it('names frames, the change and the rest in beats', () => {
    expect(describePlan(fitPlan(D, 8))).toBe('8 frames × 4 s · 1 beat change');
    expect(describePlan(fitPlan(D, 1))).toBe('1 frame × 4 s · 1 beat change · rests 2 beats');
    expect(describePlan(fitPlan(D, 2))).toBe('2 frames × 4 s · 1 beat change · rests 1 beat');
    expect(describePlan(fitPlan({ ...D, transition: 'cut', leadS: 4 }, 3))).toBe('3 frames × 4 s · lead 4 s');
  });
});
