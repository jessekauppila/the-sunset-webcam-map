import { computeDisagreementKind } from './aiScoring';
import {
  findExternalImagesNeedingDisagreementRecompute,
  updateExternalImageDisagreementsBatch,
} from './dbOperations';

export interface RecomputeResult {
  recomputed: number;
  flagged: number;
}

/**
 * Re-derive model_disagreement_kind for Flickr rows (external_images) whose
 * Claude score landed after the model backfill ran, or that were never computed.
 * Pure — no image download, no ONNX; recomputes from the already-stored model +
 * Claude scores. Mirrors recomputeDisagreements (webcam_snapshots) for the
 * Flickr table.
 */
export async function recomputeExternalDisagreements(opts: {
  limit: number;
}): Promise<RecomputeResult> {
  const rows = await findExternalImagesNeedingDisagreementRecompute(opts.limit);

  const updates = rows.map((row) => {
    // Stored regression score is raw [0,1]; computeDisagreementKind reasons in
    // the 1-5 rating space (same mapping as scoreImage).
    const aiRating = 1 + row.aiRegressionScore * 4;
    const kind = computeDisagreementKind({
      binaryIsSunset: row.binaryIsSunset ?? undefined,
      aiRating,
      llmQuality: row.llmQuality,
      llmIsSunset: row.llmIsSunset,
    });
    return { externalImageId: row.externalImageId, kind };
  });

  // One batched UPDATE for the whole page instead of one round-trip per row.
  await updateExternalImageDisagreementsBatch(updates);

  return {
    recomputed: updates.length,
    flagged: updates.filter((u) => u.kind).length,
  };
}
