import { describe, it, expect } from 'vitest';
import { getQualityScore } from './qualitySignal';
import type { WindyWebcam } from './types';

const base = { webcamId: 1, viewCount: 0, location: { latitude: 0, longitude: 0 } } as WindyWebcam;

describe('getQualityScore', () => {
  it('returns aiRatingRegression when present', () => {
    expect(getQualityScore({ ...base, aiRatingRegression: 3.7 })).toBe(3.7);
  });
  it('returns null when no regression score (legacy aiRating is NOT used)', () => {
    expect(getQualityScore({ ...base, aiRating: 4.5 } as WindyWebcam)).toBeNull();
    expect(getQualityScore(base)).toBeNull();
  });
});
