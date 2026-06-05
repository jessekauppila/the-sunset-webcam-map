import { computeDisagreementKind } from './aiScoring';
import {
  findSnapshotsNeedingDisagreementRecompute,
  updateSnapshotDisagreement,
} from './dbOperations';

export interface RecomputeResult {
  recomputed: number;
  flagged: number;
}

/**
 * Re-derive model_disagreement_kind for snapshots whose Claude score landed
 * after the model backfill ran (plan U3b). Pure — no image download, no ONNX;
 * it recomputes the verdict from the already-stored model + Claude scores, so
 * it's cheap enough to run unstarved every tick. This is the path that catches
 * the originally-Claude-absent frames (the hardest examples) that would
 * otherwise never enter the Hard Examples queue.
 */
export async function recomputeDisagreements(opts: {
  limit: number;
}): Promise<RecomputeResult> {
  const rows = await findSnapshotsNeedingDisagreementRecompute(opts.limit);
  let recomputed = 0;
  let flagged = 0;

  for (const row of rows) {
    // Stored regression score is raw [0,1]; computeDisagreementKind reasons in
    // the 1-5 rating space (same mapping as scoreImage / ratingFromRaw).
    const aiRating = 1 + row.aiRegressionScore * 4;
    const kind = computeDisagreementKind({
      binaryIsSunset: row.binaryIsSunset ?? undefined,
      aiRating,
      llmQuality: row.llmQuality,
      llmIsSunset: row.llmIsSunset,
    });
    await updateSnapshotDisagreement(row.snapshotId, kind);
    recomputed += 1;
    if (kind) flagged += 1;
  }

  return { recomputed, flagged };
}
