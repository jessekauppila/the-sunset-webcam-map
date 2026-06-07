import { computeDisagreementKind } from './aiScoring';
import {
  findSnapshotsNeedingDisagreementRecompute,
  updateSnapshotDisagreementsBatch,
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

  const updates = rows.map((row) => {
    // Stored regression score is raw [0,1]; computeDisagreementKind reasons in
    // the 1-5 rating space (same mapping as scoreImage / ratingFromRaw).
    const aiRating = 1 + row.aiRegressionScore * 4;
    const kind = computeDisagreementKind({
      binaryIsSunset: row.binaryIsSunset ?? undefined,
      aiRating,
      llmQuality: row.llmQuality,
      llmIsSunset: row.llmIsSunset,
    });
    return { snapshotId: row.snapshotId, kind };
  });

  // One batched UPDATE for the whole page instead of one round-trip per row —
  // the recompute predicate can match hundreds of rows on the hourly cron.
  await updateSnapshotDisagreementsBatch(updates);

  return {
    recomputed: updates.length,
    flagged: updates.filter((u) => u.kind).length,
  };
}
