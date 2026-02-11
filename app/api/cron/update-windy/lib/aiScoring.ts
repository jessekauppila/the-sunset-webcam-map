/**
 * AI scoring adapter for cron ingestion.
 *
 * This module intentionally keeps a stable contract so v1 can ship
 * observability and database plumbing first. The current implementation
 * uses a deterministic baseline score and can be replaced by ONNX
 * inference later without changing route/database integration code.
 */

import type { WindyWebcam } from '@/app/lib/types';

export type WebcamAiScore = {
  rawScore: number;
  aiRating: number;
  modelVersion: string;
};

const DEFAULT_MODEL_VERSION = 'baseline-v1';

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Generate a stable baseline score for a webcam preview record.
 * Replace this with ONNX inference in the next model-focused phase.
 */
export function scoreWebcamPreview(webcam: WindyWebcam): WebcamAiScore {
  const modelVersion =
    process.env.AI_MODEL_VERSION?.trim() || DEFAULT_MODEL_VERSION;

  const normalizedViews = clamp(
    Math.log10((webcam.viewCount ?? 0) + 1) / 6,
    0,
    1
  );
  const normalizedManual = clamp((webcam.rating ?? 3) / 5, 0, 1);
  const phaseBoost = webcam.phase === 'sunset' ? 0.04 : 0;

  // Raw score is an unbounded model-space value in [0,1] for this baseline.
  const rawScore = clamp(
    normalizedViews * 0.65 + normalizedManual * 0.35 + phaseBoost,
    0,
    1
  );

  // Normalize to user-facing 0-5 scale with two decimals.
  const aiRating = Number((rawScore * 5).toFixed(2));

  return {
    rawScore: Number(rawScore.toFixed(6)),
    aiRating,
    modelVersion,
  };
}
