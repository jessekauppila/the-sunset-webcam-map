import 'server-only';
import { sql } from '@/app/lib/db';
import type { WindyWebcam } from '@/app/lib/types';

/**
 * Ratings on a WindyWebcam are the 1-5 scale the webcams table stores; the
 * archive columns are the [0,1] probabilities they map onto. Inverse of
 * reconstruct.ts's probabilityToRating, and the same relation
 * qualitySignal.ratingGateFor encodes. Writing a 1-5 value into a
 * NUMERIC(4,3) probability column is the normalized-vs-raw confusion that
 * produced the 35k-rows-zero-positives bug, in the other direction.
 */
function ratingToProbability(rating: number | undefined): number | null {
  if (typeof rating !== 'number') return null;
  return Math.min(1, Math.max(0, (rating - 1) / 4));
}

/**
 * Files one scene-captured frame into the archive.
 *
 * Scores are COPIED from the webcams row rather than computed here — this is
 * an archival write, not a scoring pass — so scoring_path records that
 * provenance instead of claiming an inference ran. Frames that arrive
 * unscored land with NULL score columns, which is what makes the archive
 * backfill pick them up later (it keys on ai_regression_score IS NULL).
 */
export async function archiveSceneFrame(
  cam: WindyWebcam,
  frame: { url: string; path: string },
  phase: 'sunrise' | 'sunset'
): Promise<number | null> {
  const binary = ratingToProbability(cam.aiRatingBinary);
  const regression = ratingToProbability(cam.aiRatingRegression);
  try {
    const [row] = (await sql`
      insert into webcam_snapshots (
        webcam_id, phase, initial_rating,
        firebase_url, firebase_path,
        ai_rating, ai_regression_score, ai_model_version_regression,
        ai_binary_score, ai_binary_is_sunset, ai_model_version_binary,
        scoring_path, model_disagreement_kind, intake_reason, captured_at
      )
      values (
        ${cam.webcamId}, ${phase}, null,
        ${frame.url}, ${frame.path},
        ${cam.aiRatingRegression ?? null}, ${regression},
        ${cam.aiModelVersionRegression ?? null},
        ${binary}, null, ${cam.aiModelVersionBinary ?? null},
        'inherited-from-webcam', null, 'scene_capture', now()
      )
      returning id
    `) as Array<{ id: number }>;
    return row?.id ?? null;
  } catch (error) {
    // One frame failing to file must not lose the whole capture. The scene
    // still resolves from whatever did land, and the count is reported.
    console.error(
      `[scene] failed to archive frame for webcam ${cam.webcamId}:`,
      error instanceof Error ? error.message : error
    );
    return null;
  }
}
