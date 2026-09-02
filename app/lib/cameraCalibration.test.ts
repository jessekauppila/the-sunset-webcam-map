import { describe, it, expect, vi } from 'vitest';
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

  // Regression guard for a real near-miss found on 2026-09-01. The rubric lane's
  // label corrections flip 12 frames from operator-sunset to operator-N, and 4
  // of them fire under the shipping head. Two land on cameras that have exactly
  // ONE labeled frame — which would read as a 100% false-show rate, structurally
  // identical to Broome's 11/11 but on a denominator of one. The recurrence bar
  // is what stops a single frame from tempering a camera; these pin it down.
  it('never tempers a camera on a single frame, even at a 100% rate', () => {
    expect(
      computeTemperingMultiplier({
        falseShows: 1,
        negativeFrames: 1,
        falseShowDays: 1,
        rawFalseShows: 1,
      })
    ).toBe(1);
  });

  it('never tempers on two false-shows across two days (below the event bar)', () => {
    expect(
      computeTemperingMultiplier({
        falseShows: 2,
        negativeFrames: 2,
        falseShowDays: 2,
        rawFalseShows: 2,
      })
    ).toBe(1);
  });

  it('tempers at exactly the bar: 3 false-shows across 2 days', () => {
    const m = computeTemperingMultiplier({
      falseShows: 3,
      negativeFrames: 3,
      falseShowDays: 2,
      rawFalseShows: 3,
    });
    expect(m).toBeLessThan(1);
    expect(m).toBeGreaterThanOrEqual(0.5);
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

  // The scale contract. mosaic v2 normalizes its score to [0,1]; feeding one
  // of those through this 1-5 helper inverts the multiplier — 0.0 would render
  // at 0.423 while 1.0 stays 1.0, boosting the worst offenders hardest and
  // landing WORSE than shipping no tempering at all.
  it('refuses a normalized [0,1] score instead of inverting it', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // 1 + (0.5-1)*0.577 = 0.712 — the inverted answer we must NOT return.
    expect(applyTempering(0.5, 0.577)).toBe(0.5);
    expect(warn).toHaveBeenCalledOnce();

    warn.mockRestore();
  });

  it('refuses a score of 0 rather than boosting it to 0.423', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(applyTempering(0, 0.577)).toBe(0);
    warn.mockRestore();
  });

  it('refuses NaN rather than propagating it through the arithmetic', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(Number.isNaN(applyTempering(NaN, 0.577))).toBe(true);
    warn.mockRestore();
  });

  it('accepts a rating of exactly 1 (the legal floor) without warning', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(applyTempering(1, 0.577)).toBe(1);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('is a no-op when the multiplier is undefined', () => {
    expect(applyTempering(4.2, undefined)).toBe(4.2);
  });

  it('is a no-op at multiplier 1', () => {
    expect(applyTempering(4.2, 1)).toBe(4.2);
  });
});
