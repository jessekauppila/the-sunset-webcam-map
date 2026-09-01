import { describe, it, expect } from 'vitest';
import {
  computeTemperingMultiplier,
  decayWeight,
  applyTempering,
  type CalibrationEvidence,
} from './cameraCalibration';

const neutral: CalibrationEvidence = {
  falseShows: 0,
  negativeFrames: 0,
  falseShowDays: 0,
  rawFalseShows: 0,
};

describe('computeTemperingMultiplier', () => {
  it('returns exactly 1.0 for a camera with no evidence (clause 6)', () => {
    expect(computeTemperingMultiplier(neutral)).toBe(1);
  });

  it('returns 1.0 below the event bar even with many negative frames', () => {
    expect(
      computeTemperingMultiplier({
        falseShows: 2,
        negativeFrames: 40,
        falseShowDays: 2,
        rawFalseShows: 2,
      })
    ).toBe(1);
  });

  it('returns 1.0 when false-shows do not recur across days', () => {
    expect(
      computeTemperingMultiplier({
        falseShows: 5,
        negativeFrames: 5,
        falseShowDays: 1,
        rawFalseShows: 5,
      })
    ).toBe(1);
  });

  it('reproduces the Broome baseline: 11/11 over 9 days -> 0.577', () => {
    const m = computeTemperingMultiplier({
      falseShows: 11,
      negativeFrames: 11,
      falseShowDays: 9,
      rawFalseShows: 11,
    });
    expect(m).toBeCloseTo(0.577, 3);
  });

  it('reproduces Mount Gambier: 4/15 over 4 days -> 0.882', () => {
    const m = computeTemperingMultiplier({
      falseShows: 4,
      negativeFrames: 15,
      falseShowDays: 4,
      rawFalseShows: 4,
    });
    expect(m).toBeCloseTo(0.882, 3);
  });

  it('never returns below MIN_MULTIPLIER even at a 100% false-show rate (clause 5)', () => {
    const m = computeTemperingMultiplier({
      falseShows: 1000,
      negativeFrames: 1000,
      falseShowDays: 50,
      rawFalseShows: 1000,
    });
    expect(m).toBeGreaterThanOrEqual(0.5);
  });

  it('never returns above 1.0 (clause 5)', () => {
    const m = computeTemperingMultiplier({
      falseShows: 0,
      negativeFrames: 100,
      falseShowDays: 5,
      rawFalseShows: 3,
    });
    expect(m).toBeLessThanOrEqual(1);
  });

  it('is bounded for adversarial input (negative, NaN, missing) (clause 5)', () => {
    for (const e of [
      { falseShows: -5, negativeFrames: -5, falseShowDays: 9, rawFalseShows: 9 },
      { falseShows: NaN, negativeFrames: NaN, falseShowDays: 9, rawFalseShows: 9 },
      { falseShows: 5, negativeFrames: 0, falseShowDays: 9, rawFalseShows: 5 },
    ] as CalibrationEvidence[]) {
      const m = computeTemperingMultiplier(e);
      expect(Number.isFinite(m)).toBe(true);
      expect(m).toBeGreaterThanOrEqual(0.5);
      expect(m).toBeLessThanOrEqual(1);
    }
  });
});

describe('decayWeight', () => {
  it('is 1 for a frame captured today', () => {
    expect(decayWeight(0, 90)).toBe(1);
  });

  it('is 0.5 at exactly one half-life', () => {
    expect(decayWeight(90, 90)).toBeCloseTo(0.5, 10);
  });

  it('is 0.25 at two half-lives', () => {
    expect(decayWeight(180, 90)).toBeCloseTo(0.25, 10);
  });

  it('treats a negative age as today rather than amplifying', () => {
    expect(decayWeight(-10, 90)).toBe(1);
  });
});

describe('applyTempering', () => {
  it('scales only the above-floor part, so the 1.0 floor is preserved', () => {
    expect(applyTempering(1, 0.5)).toBe(1);
  });

  it('halves the distance above the floor at multiplier 0.5', () => {
    expect(applyTempering(5, 0.5)).toBe(3);
  });

  it('is a no-op when the multiplier is undefined', () => {
    expect(applyTempering(4.2, undefined)).toBe(4.2);
  });

  it('is a no-op at multiplier 1', () => {
    expect(applyTempering(4.2, 1)).toBe(4.2);
  });
});
