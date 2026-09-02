import {
  CALIBRATION_MIN_EVENTS,
  CALIBRATION_MIN_DAYS,
  CALIBRATION_PRIOR_K,
  CALIBRATION_MAX_TEMPER,
  CALIBRATION_MIN_MULTIPLIER,
} from './masterConfig';

/**
 * Per-camera tempering evidence, already windowed and decayed by the caller.
 *
 * The rate is conditioned on the camera's NEGATIVE frames only — "given a
 * boring frame, does this camera fool the model?". That conditioning is
 * load-bearing: whole-population rates rank Broome 8th-9th because its 21
 * genuinely correct fires dilute the error rate. See the spec.
 */
export interface CalibrationEvidence {
  /** Decayed weight of false-shows inside the window. */
  falseShows: number;
  /** Decayed weight of operator-negative frames inside the window. */
  negativeFrames: number;
  /** Distinct capture days with a false-show, inside the window. */
  falseShowDays: number;
  /** Undecayed false-show count inside the window — the recurrence bar. */
  rawFalseShows: number;
}

const finiteOrZero = (n: number): number =>
  Number.isFinite(n) ? Math.max(0, n) : 0;

/**
 * Exponential decay weight for a frame captured `ageDays` ago.
 * A future-dated frame (clock skew) weighs the same as today's, never more.
 */
export function decayWeight(ageDays: number, halfLifeDays: number): number {
  const age = Math.max(0, finiteOrZero(ageDays));
  if (!(halfLifeDays > 0)) return 1;
  return Math.pow(0.5, age / halfLifeDays);
}

/**
 * The tempering multiplier. Bounded to [MIN_MULTIPLIER, 1] by construction.
 *
 * Returns exactly 1 (neutral) unless the recurrence bar is cleared, so new
 * cameras and one-off mistakes are never tempered.
 */
export function computeTemperingMultiplier(e: CalibrationEvidence): number {
  const rawFalseShows = finiteOrZero(e.rawFalseShows);
  const falseShowDays = finiteOrZero(e.falseShowDays);

  if (rawFalseShows < CALIBRATION_MIN_EVENTS) return 1;
  if (falseShowDays < CALIBRATION_MIN_DAYS) return 1;

  const falseShows = finiteOrZero(e.falseShows);
  const negativeFrames = finiteOrZero(e.negativeFrames);

  const rate = falseShows / (negativeFrames + CALIBRATION_PRIOR_K);
  const raw = 1 - CALIBRATION_MAX_TEMPER * rate;

  return Math.min(1, Math.max(CALIBRATION_MIN_MULTIPLIER, raw));
}

/**
 * Apply a multiplier to a 1-5 tile score, scaling only the part ABOVE the
 * floor of 1. Product intent is "show every image, just small" — a tempered
 * frame gets smaller, never hidden, and 1 stays 1.
 */
export function applyTempering(
  score: number,
  multiplier: number | undefined
): number {
  if (multiplier == null || !Number.isFinite(multiplier)) return score;

  // SCALE CONTRACT. `score` is a 1-5 RATING with a floor of 1 — not a
  // normalized [0,1] signal. The distinction is load-bearing, because on a
  // [0,1] scale this formula INVERTS: at multiplier 0.577 a score of 0.0
  // becomes 0.423 while 1.0 is untouched, so the frames the evidence flagged
  // as worst get boosted hardest and a tempered camera renders LARGER than
  // with no tempering at all. Refuse rather than invert.
  //
  // Fail-visible, not fail-hard: this runs in the kiosk render path, and the
  // quality head can emit negatives (769 of 9,118 evidence rows do), so a
  // throw could blank the display if the write-path clamp ever changed.
  // Warn loudly and return untempered — wrong-but-visible beats inverted.
  if (!(score >= 1)) {
    console.warn(
      `[cameraCalibration] applyTempering received score=${score}, below the ` +
        `1-5 rating floor. Expected a rating, not a normalized [0,1] signal ` +
        `(mosaic v2 normalizes — use score * multiplier there). Returning ` +
        `untempered to avoid inverting the multiplier.`
    );
    return score;
  }

  return 1 + (score - 1) * multiplier;
}
