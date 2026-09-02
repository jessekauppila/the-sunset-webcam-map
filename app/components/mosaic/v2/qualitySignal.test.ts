import { describe, it, expect } from 'vitest';
import { readSignal, ratingGateFor } from './qualitySignal';
import type { WindyWebcam } from '@/app/lib/types';

const cam = (over: Partial<WindyWebcam>): WindyWebcam =>
  ({
    webcamId: 1,
    title: 't',
    viewCount: 0,
    status: 'active',
    location: { city: '', region: '', latitude: 0, longitude: 0, country: '', continent: '' },
    categories: [],
    ...over,
  }) as WindyWebcam;

describe('ratingGateFor', () => {
  it('converts a [0,1] probability to the stored 1-5 scale', () => {
    expect(ratingGateFor(0.55)).toBeCloseTo(3.2);
    expect(ratingGateFor(0)).toBe(1);
    expect(ratingGateFor(1)).toBe(5);
  });
});

describe('readSignal — model source', () => {
  it('passes when the detection rating clears the converted gate', () => {
    const s = readSignal(cam({ aiRatingBinary: 3.5, aiRatingRegression: 4 }), 'model', 0.55);
    expect(s.passes).toBe(true);
  });

  it('fails when the detection rating is below the converted gate', () => {
    const s = readSignal(cam({ aiRatingBinary: 3.0, aiRatingRegression: 4 }), 'model', 0.55);
    expect(s.passes).toBe(false);
  });

  it('does NOT treat the raw threshold as a 1-5 rating', () => {
    // 0.55 must mean rating 3.2, never rating 0.55. A cam at 1.0 (the very
    // bottom of the scale) must fail — under the bug it would pass.
    expect(readSignal(cam({ aiRatingBinary: 1.0 }), 'model', 0.55).passes).toBe(false);
  });

  it('normalizes the regression rating to [0,1]', () => {
    expect(readSignal(cam({ aiRatingRegression: 5 }), 'model', 0.55).score).toBe(1);
    expect(readSignal(cam({ aiRatingRegression: 1 }), 'model', 0.55).score).toBe(0);
    expect(readSignal(cam({ aiRatingRegression: 3 }), 'model', 0.55).score).toBe(0.5);
  });

  it('scores null when there is no regression rating', () => {
    expect(readSignal(cam({ aiRatingBinary: 4 }), 'model', 0.55).score).toBeNull();
  });
});

describe('readSignal — llm source', () => {
  it('gates on the boolean verdict, ignoring gateThreshold', () => {
    expect(readSignal(cam({ llmIsSunset: true, llmQuality: 0.1 }), 'llm', 0.99).passes).toBe(true);
    expect(readSignal(cam({ llmIsSunset: false, llmQuality: 0.9 }), 'llm', 0.01).passes).toBe(false);
  });

  it('uses llmQuality directly as the [0,1] score', () => {
    expect(readSignal(cam({ llmIsSunset: true, llmQuality: 0.72 }), 'llm', 0.55).score).toBe(0.72);
  });
});

describe('readSignal — auto source', () => {
  it('prefers the ML heads when present', () => {
    const s = readSignal(
      cam({ aiRatingBinary: 4, aiRatingRegression: 5, llmIsSunset: false, llmQuality: 0 }),
      'auto',
      0.55
    );
    expect(s).toEqual({ passes: true, score: 1 });
  });

  it('falls back to Claude when no ML score exists', () => {
    // Reconstructed historical scenes carry ONLY llm_* — without this the
    // seed scenes render as a uniform floor carpet and cannot be judged.
    const s = readSignal(cam({ llmIsSunset: true, llmQuality: 0.65 }), 'auto', 0.55);
    expect(s).toEqual({ passes: true, score: 0.65 });
  });

  it('is unscored and not-a-passer when neither judge has spoken', () => {
    expect(readSignal(cam({}), 'auto', 0.55)).toEqual({ passes: false, score: null });
  });
});
