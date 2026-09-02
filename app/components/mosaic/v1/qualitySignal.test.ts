import { describe, it, expect } from 'vitest';
import { getQualityScore, passesGate } from './qualitySignal';
import type { WindyWebcam } from '@/app/lib/types';

const base = { webcamId: 1, viewCount: 0, location: { latitude: 0, longitude: 0 } } as WindyWebcam;

// aiRatingBinary is the detection probability mapped to 1-5 (1 + p*4), so
// the 0.55 gate sits at 3.2 on that scale.
const SHOWN = 3.3; // p = 0.575, above the gate
const REJECTED = 1.1; // p = 0.025, well below the gate

describe('getQualityScore (composed two-scale signal)', () => {
  it('returns the quality rating when detection says sunset', () => {
    expect(
      getQualityScore({ ...base, aiRatingBinary: SHOWN, aiRatingRegression: 3.7 })
    ).toBe(3.7);
  });

  it('floors the score when detection rejects the frame', () => {
    // The v6 quality head is sunsets-only trained: its output on a
    // non-sunset frame is undefined. Whatever it says, a rejected frame
    // renders minimal (floor of the 1-5 scale), never mid-pack.
    expect(
      getQualityScore({ ...base, aiRatingBinary: REJECTED, aiRatingRegression: 4.2 })
    ).toBe(1);
  });

  it('is exactly the gate-inclusive boundary at 0.55', () => {
    const atGate = 1 + 0.55 * 4; // 3.2
    expect(
      getQualityScore({ ...base, aiRatingBinary: atGate, aiRatingRegression: 2.5 })
    ).toBe(2.5);
  });

  it('falls back to quality alone when the binary head has not scored', () => {
    // Cams scored before the binary head shipped (or fail-visible skips)
    // keep the old single-head behavior rather than being floored.
    expect(getQualityScore({ ...base, aiRatingRegression: 3.7 })).toBe(3.7);
  });

  it('returns null when no regression score (legacy aiRating is NOT used)', () => {
    expect(getQualityScore({ ...base, aiRating: 4.5 } as WindyWebcam)).toBeNull();
    expect(getQualityScore(base)).toBeNull();
  });

  it('a rejected frame with no quality score is still floored, not null', () => {
    // Detection alone is enough to know the tile should be minimal.
    expect(getQualityScore({ ...base, aiRatingBinary: REJECTED })).toBe(1);
  });
});

describe('passesGate', () => {
  it('passes when the detection score sits exactly at the gate', () => {
    const atGate = 1 + 0.55 * 4; // 3.2
    expect(passesGate({ ...base, aiRatingBinary: atGate })).toBe(true);
  });

  it('fails when the detection score is below the gate', () => {
    expect(passesGate({ ...base, aiRatingBinary: REJECTED })).toBe(false);
  });

  it('fails when the webcam has no detection score', () => {
    expect(passesGate(base)).toBe(false);
  });

  it('passes when the detection score is well above the gate', () => {
    expect(passesGate({ ...base, aiRatingBinary: SHOWN })).toBe(true);
  });
});

describe('per-camera tempering', () => {
  it('shrinks the tile score for a tempered camera', () => {
    const score = getQualityScore({
      ...base,
      aiRatingBinary: SHOWN,
      aiRatingRegression: 5,
      calibrationMultiplier: 0.5,
    } as WindyWebcam);
    expect(score).toBe(3);
  });

  it('is a no-op for an untempered camera', () => {
    expect(
      getQualityScore({
        ...base,
        aiRatingBinary: SHOWN,
        aiRatingRegression: 3.7,
      })
    ).toBe(3.7);
  });

  it('keeps the floor at 1 for a rejected frame regardless of multiplier', () => {
    expect(
      getQualityScore({
        ...base,
        aiRatingBinary: REJECTED,
        aiRatingRegression: 4.2,
        calibrationMultiplier: 0.5,
      } as WindyWebcam)
    ).toBe(1);
  });

  it('leaves passesGate bit-identical with and without a multiplier (clause 4)', () => {
    const atGate = 1 + 0.55 * 4; // 3.2
    for (const binary of [REJECTED, atGate, SHOWN]) {
      const without = passesGate({ ...base, aiRatingBinary: binary });
      const with05 = passesGate({
        ...base,
        aiRatingBinary: binary,
        calibrationMultiplier: 0.5,
      } as WindyWebcam);
      expect(with05).toBe(without);
    }
  });
});
