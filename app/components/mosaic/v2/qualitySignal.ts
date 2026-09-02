import type { WindyWebcam } from '@/app/lib/types';

export type QualitySource = 'auto' | 'model' | 'llm';

/**
 * Pass verdict and size score, kept SEPARATE. v1 composed them into one
 * number, which floored the whole pool on a normal night and made ties
 * unsortable. `score` is always normalized to [0,1]; null means unscored.
 */
export interface Signal {
  passes: boolean;
  score: number | null;
}

/**
 * A [0,1] probability expressed on the 1-5 scale the aiRating* columns
 * store (`rating = 1 + probability * 4`). The knob is a probability; the
 * data is a rating. Confusing the two is the 35k-rows-zero-positives bug.
 */
export function ratingGateFor(gateThreshold: number): number {
  return 1 + gateThreshold * 4;
}

const normalizeRating = (rating: number): number => (rating - 1) / 4;

const hasModelSignal = (w: WindyWebcam): boolean =>
  typeof w.aiRatingBinary === 'number' || typeof w.aiRatingRegression === 'number';

const hasLlmSignal = (w: WindyWebcam): boolean =>
  typeof w.llmQuality === 'number' || typeof w.llmIsSunset === 'boolean';

function modelSignal(w: WindyWebcam, gateThreshold: number): Signal {
  const gate = ratingGateFor(gateThreshold);
  return {
    passes: typeof w.aiRatingBinary === 'number' && w.aiRatingBinary >= gate,
    score:
      typeof w.aiRatingRegression === 'number'
        ? normalizeRating(w.aiRatingRegression)
        : null,
  };
}

function llmSignal(w: WindyWebcam): Signal {
  // Claude's verdict is already a boolean, so gateThreshold has nothing to
  // act on here — the dial only means something for the model source.
  return {
    passes: w.llmIsSunset === true,
    score: typeof w.llmQuality === 'number' ? w.llmQuality : null,
  };
}

/**
 * THE v2 quality signal. `auto` exists because the two scene kinds carry
 * different judges: reconstructed historical scenes have only llm_*, the
 * live capture has only the ML heads. Without the fallback the seed scenes
 * render as a uniform floor carpet.
 */
export function readSignal(
  w: WindyWebcam,
  source: QualitySource,
  gateThreshold: number
): Signal {
  if (source === 'model') return modelSignal(w, gateThreshold);
  if (source === 'llm') return llmSignal(w);
  if (hasModelSignal(w)) return modelSignal(w, gateThreshold);
  if (hasLlmSignal(w)) return llmSignal(w);
  return { passes: false, score: null };
}
