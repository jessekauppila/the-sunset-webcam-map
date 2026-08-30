import { AI_BINARY_DECISION_THRESHOLD } from './masterConfig';
import type { WindyWebcam } from './types';

/**
 * Human-readable readouts of what each model head said about a webcam,
 * for surfaces that show the models' own judgments (the home console,
 * the kiosk overlay) instead of a manual rating UI.
 *
 * Ratings are stored as 1 + value*4 (see aiScoring.ts), so the raw
 * probability/quality is recovered with (rating - 1) / 4.
 */

export function detectionReadout(
  webcam: WindyWebcam
): { verdict: 'sunset' | 'not a sunset'; probability: number } | null {
  const r = webcam.aiRatingBinary;
  if (typeof r !== 'number') return null;
  const probability = Math.round(((r - 1) / 4) * 100) / 100;
  return {
    verdict:
      probability >= AI_BINARY_DECISION_THRESHOLD ? 'sunset' : 'not a sunset',
    probability,
  };
}

/** The quality head's 1-5 rating, or null when this cam is unscored. */
export function qualityReadout(webcam: WindyWebcam): number | null {
  return typeof webcam.aiRatingRegression === 'number'
    ? webcam.aiRatingRegression
    : null;
}

/** `20260829_062437_v5_binary_gold` -> `v5_binary_gold`; legacy names pass through. */
export function shortModelName(version: string | undefined | null): string | null {
  if (!version) return null;
  return version.replace(/^\d{8}_\d{6}_/, '');
}
