import type { BinKind } from './types';

/**
 * The two scores a bin entry carries, in the words the studio and the glass
 * use for them.
 *
 * `quality` is the quality head's output in [0, 1]; the rubric it was trained
 * on is the 1–5 rating (docs/ml/rating-rubric.md), stored as 1 + value·4
 * (aiScoring.ts), so a quality of 0.75 is a rating of 4. `detection` is the
 * binary head's probability that the frame is a sunset at all; it is not a
 * rating, so it reads as a percent.
 */
export const ratingOf = (quality: number): number => Math.min(5, Math.max(1, 1 + 4 * quality));
export const qualityOf = (rating: number): number => (rating - 1) / 4;
export const formatRating = (quality: number): string => ratingOf(quality).toFixed(1);
export const formatDetection = (detection: number): string => `${Math.round(detection * 100)}%`;

/** One line for a frame's scores, the same wherever they are shown. Non-sunset rows carry no quality. */
export function scoreLine(e: { bin: BinKind; quality: number | null; detection: number }): string {
  const sunset = `sunset ${formatDetection(e.detection)}`;
  return e.bin === 'sunset' ? `rating ${formatRating(e.quality ?? 0)} · ${sunset}` : sunset;
}
