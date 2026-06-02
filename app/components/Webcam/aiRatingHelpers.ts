/**
 * Shared helpers for the AI-rating display surfaces.
 *
 * Used by `AiRatingDisplay.tsx` (the React component in `RatingCard.tsx`).
 * Lives here because the previous home (`app/components/Map/lib/aiRatingBlock.ts`)
 * was a Mapbox-popup HTML generator that's been retired in favor of the React
 * component — only the threshold constant and the model-version label parser
 * survived the migration.
 */

/**
 * Below this 1-5 rating we say the camera isn't currently looking at a sunset.
 * Tunable. Corresponds to raw model output 0.4 ((rating - 1) / 4).
 *
 * Only used as the FALLBACK verdict when the binary classifier hasn't yet
 * populated the row's ai_rating_binary column. Once binary is the source of
 * truth (post-2026-06-01), this constant matters only for back-compat rows.
 */
export const SUNSET_DETECTION_THRESHOLD = 2.6;

/**
 * Turn a raw model_version string into the compact "vN · suffix" form used
 * in the rating-card footer. Examples:
 *
 *   "v4_regression_llm_with_flickr"                    -> "v4 · llm_with_flickr"
 *   "20260513_113243_v4_regression_llm_with_flickr"    -> "v4 · llm_with_flickr"
 *   "20260601_063518_v4_binary_llm_with_flickr"        -> "v4 · llm_with_flickr"
 *   null / ""                                          -> "—"
 *   "some-other-name"                                  -> "some-other-name" (unchanged)
 */
export function formatModelLabel(modelVersion: string | null): string {
  if (!modelVersion) return '—';
  // Strip optional timestamp prefix like "20260513_113243_".
  const label = modelVersion.replace(/^\d{8}_\d{6}_/, '');
  // Extract the version tag (vN) and the descriptive tail after the
  // "_regression_" or "_binary_" infix. Falls back to the cleaned string.
  const match = label.match(/^(v\d+)_(?:regression|binary)_(.+)$/);
  if (match) {
    return `${match[1]} · ${match[2]}`;
  }
  return label;
}
