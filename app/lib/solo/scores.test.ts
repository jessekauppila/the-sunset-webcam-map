import { it, expect } from 'vitest';
import { formatDetection, formatRating, qualityOf, ratingOf, scoreLine } from './scores';

it('quality 0–1 is the 1–5 rating as 1 + 4q, clamped; qualityOf inverts it', () => {
  expect(ratingOf(0)).toBe(1);
  expect(ratingOf(0.75)).toBe(4);
  expect(ratingOf(1)).toBe(5);
  expect(ratingOf(1.3)).toBe(5); // a calibration multiplier can push quality past 1
  expect(qualityOf(4)).toBe(0.75);
  expect(qualityOf(1)).toBe(0);
  expect(formatRating(0.91)).toBe('4.6');
});

it('detection is a probability and reads as a percent', () => {
  expect(formatDetection(0.88)).toBe('88%');
  expect(formatDetection(0.004)).toBe('0%');
});

it('one score line: rating and sunset probability for a sunset, the probability alone for a non-sunset', () => {
  expect(scoreLine({ bin: 'sunset', quality: 0.91, detection: 0.88 })).toBe('rating 4.6 · sunset 88%');
  expect(scoreLine({ bin: 'non_sunset', quality: null, detection: 0.12 })).toBe('sunset 12%');
});
