import { AI_BINARY_DECISION_THRESHOLD } from './masterConfig';
import type { WindyWebcam } from './types';

// The detection gate expressed on the 1-5 rating scale that
// aiScoring.ts stores (rating = 1 + probability * 4).
const GATE_AS_RATING = 1 + AI_BINARY_DECISION_THRESHOLD * 4;

/**
 * THE quality signal. The single place that decides which model's score
 * drives composition sizing.
 *
 * Since the v6 warm-started pair this is the COMPOSED two-scale signal:
 * the detection head decides whether the frame counts as a sunset, the
 * quality head sizes it. The quality head is sunsets-only trained, so its
 * output on a frame detection rejects is undefined - ranking by it alone
 * let night frames outrank real mid-grade sunsets. A rejected frame
 * floors to 1 (minimal tile, still shown - product intent is "show every
 * image, just small", never hidden).
 *
 * Cams without a binary score (scored before the binary head shipped, or
 * a fail-visible skip) keep the single-head behavior.
 */
export function getQualityScore(webcam: WindyWebcam): number | null {
  const detection = webcam.aiRatingBinary;
  if (typeof detection === 'number' && detection < GATE_AS_RATING) {
    return 1;
  }
  return webcam.aiRatingRegression ?? null;
}
