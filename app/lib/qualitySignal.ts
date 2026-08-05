import type { WindyWebcam } from './types';

/**
 * THE quality signal. The single place that decides which model's score
 * drives composition sizing. Today: the live v4 ONNX regression (1–5).
 * When a newer model ships, change this file and every surface follows.
 */
export function getQualityScore(webcam: WindyWebcam): number | null {
  return webcam.aiRatingRegression ?? null;
}
