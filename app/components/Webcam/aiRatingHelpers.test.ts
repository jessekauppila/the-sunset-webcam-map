import { describe, it, expect } from 'vitest';
import {
  formatModelLabel,
  SUNSET_DETECTION_THRESHOLD,
} from './aiRatingHelpers';

describe('formatModelLabel', () => {
  it('returns an em-dash for null', () => {
    expect(formatModelLabel(null)).toBe('—');
  });

  it('returns an em-dash for empty string', () => {
    expect(formatModelLabel('')).toBe('—');
  });

  it('strips a timestamp prefix and splits the regression/binary infix', () => {
    expect(
      formatModelLabel('20260513_113243_v4_regression_llm_with_flickr'),
    ).toBe('v4 · llm_with_flickr');
  });

  it('handles untagged versions without a timestamp', () => {
    expect(formatModelLabel('v4_regression_llm_with_flickr')).toBe(
      'v4 · llm_with_flickr',
    );
  });

  it('handles binary-prefixed versions identically', () => {
    expect(formatModelLabel('v4_binary_llm_with_flickr')).toBe(
      'v4 · llm_with_flickr',
    );
  });

  it('handles a real-world v4 binary version with timestamp prefix', () => {
    expect(
      formatModelLabel('20260601_063518_v4_binary_llm_with_flickr'),
    ).toBe('v4 · llm_with_flickr');
  });

  it('falls back to the cleaned string when the pattern does not match', () => {
    expect(formatModelLabel('some-other-name')).toBe('some-other-name');
  });
});

describe('SUNSET_DETECTION_THRESHOLD', () => {
  it('is a sensible 1-5 cutoff for the regression-threshold proxy', () => {
    // The proxy verdict kicks in when no real binary signal is available.
    // Anchored at 2.6 on the 1-5 scale = raw model output 0.4. Documented
    // in the constant's JSDoc. This test just guards against accidental
    // changes — if you intentionally retune, update both the constant and
    // this test.
    expect(SUNSET_DETECTION_THRESHOLD).toBe(2.6);
  });
});
