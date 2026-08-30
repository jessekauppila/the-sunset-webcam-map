import { describe, it, expect } from 'vitest';
import { detectionReadout, qualityReadout, shortModelName } from './modelReadout';
import type { WindyWebcam } from './types';

const base = { webcamId: 1, viewCount: 0, location: { latitude: 0, longitude: 0 } } as WindyWebcam;

describe('detectionReadout', () => {
  it('reads a confident sunset', () => {
    // aiRatingBinary stores 1 + p*4, so 4.6 is p = 0.90.
    expect(
      detectionReadout({ ...base, aiRatingBinary: 4.6 })
    ).toEqual({ verdict: 'sunset', probability: 0.9 });
  });

  it('reads a confident rejection', () => {
    expect(
      detectionReadout({ ...base, aiRatingBinary: 1.2 })
    ).toEqual({ verdict: 'not a sunset', probability: 0.05 });
  });

  it('applies the production gate (0.55) at the boundary', () => {
    expect(detectionReadout({ ...base, aiRatingBinary: 3.2 })?.verdict).toBe('sunset');
    expect(detectionReadout({ ...base, aiRatingBinary: 3.1 })?.verdict).toBe(
      'not a sunset'
    );
  });

  it('returns null when the detection head has not scored this cam', () => {
    expect(detectionReadout(base)).toBeNull();
  });
});

describe('qualityReadout', () => {
  it('passes the 1-5 rating through', () => {
    expect(qualityReadout({ ...base, aiRatingRegression: 3.7 })).toBe(3.7);
  });
  it('returns null when unscored', () => {
    expect(qualityReadout(base)).toBeNull();
  });
});

describe('shortModelName', () => {
  it('strips the timestamp prefix from a version stamp', () => {
    expect(shortModelName('20260829_062437_v5_binary_gold')).toBe('v5_binary_gold');
  });
  it('leaves legacy names alone', () => {
    expect(shortModelName('binary-v1')).toBe('binary-v1');
    expect(shortModelName(undefined)).toBeNull();
  });
});
