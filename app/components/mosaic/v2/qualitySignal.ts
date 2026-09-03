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

/** Which judge produced a signal. `none` means nothing scored the frame. */
export type Judge = 'model' | 'llm' | 'none';

/**
 * A signal plus why it came out that way, for the troubleshooting overlay.
 * `gateInput` and `gateValue` are the two numbers the gate actually compared,
 * on the 1-5 rating scale the columns store, and are null for judges the gate
 * threshold does not act on. That null is the point: the dial is inert for
 * llm-scored frames, and a readout that hid it would send you hunting for a
 * bug in the composition instead.
 */
export interface ExplainedSignal extends Signal {
  judge: Judge;
  gateInput: number | null;
  gateValue: number | null;
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

function modelSignal(w: WindyWebcam, gateThreshold: number): ExplainedSignal {
  const gate = ratingGateFor(gateThreshold);
  return {
    judge: 'model',
    gateInput: typeof w.aiRatingBinary === 'number' ? w.aiRatingBinary : null,
    gateValue: gate,
    passes: typeof w.aiRatingBinary === 'number' && w.aiRatingBinary >= gate,
    score:
      typeof w.aiRatingRegression === 'number'
        ? normalizeRating(w.aiRatingRegression)
        : null,
  };
}

function llmSignal(w: WindyWebcam): ExplainedSignal {
  // Claude's verdict is already a boolean, so gateThreshold has nothing to
  // act on here — the dial only means something for the model source.
  return {
    judge: 'llm',
    gateInput: null,
    gateValue: null,
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
export function explainSignal(
  w: WindyWebcam,
  source: QualitySource,
  gateThreshold: number
): ExplainedSignal {
  if (source === 'model') return modelSignal(w, gateThreshold);
  if (source === 'llm') return llmSignal(w);
  if (hasModelSignal(w)) return modelSignal(w, gateThreshold);
  if (hasLlmSignal(w)) return llmSignal(w);
  return { judge: 'none', gateInput: null, gateValue: null, passes: false, score: null };
}

/**
 * What the engine sizes tiles with. A thin projection of `explainSignal` on
 * purpose: the overlay must never be able to disagree with the composition
 * about why a tile is the size it is, and two implementations would drift.
 */
export function readSignal(
  w: WindyWebcam,
  source: QualitySource,
  gateThreshold: number
): Signal {
  const { passes, score } = explainSignal(w, source, gateThreshold);
  return { passes, score };
}
