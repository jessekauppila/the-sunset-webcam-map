import { downloadImage } from '@/app/lib/webcamSnapshot';
import { scoreImage } from './aiScoring';
import {
  findCustomSnapshotsNeedingScore,
  updateSnapshotAiRegressionScore,
  updateWebcamRegressionScoreFromLatestCustomSnapshot,
} from './dbOperations';

export interface BackfillResult {
  scored: number;
  failed: number;
  modelVersion: string | null;
  /** Raw 0..1 regression scores for every successfully scored snapshot, in
   *  the order they were processed. Fed into daily_sunset_stats percentiles. */
  scores: number[];
}

/**
 * Score every custom-camera snapshot whose ai_regression_score is still NULL,
 * up to `limit`. Returns counts for daily_sunset_stats. Errors per-row never
 * crash the tick — they're counted as failed.
 */
export async function backfillCustomSnapshotScores(opts: {
  limit: number;
}): Promise<BackfillResult> {
  const rows = await findCustomSnapshotsNeedingScore(opts.limit);
  if (rows.length === 0) {
    return { scored: 0, failed: 0, modelVersion: null, scores: [] };
  }

  let scored = 0;
  let failed = 0;
  let modelVersion: string | null = null;
  const scores: number[] = [];
  const touchedWebcamIds = new Set<number>();

  for (const row of rows) {
    try {
      const bytes = await downloadImage(row.firebaseUrl);
      const result = await scoreImage({
        webcamId: row.webcamId,
        imageBytes: bytes,
        source: 'custom',
      });
      await updateSnapshotAiRegressionScore(
        row.snapshotId,
        result.rawScore,
        result.modelVersion
      );
      modelVersion = result.modelVersion;
      touchedWebcamIds.add(row.webcamId);
      scores.push(result.rawScore);
      scored += 1;
    } catch (error) {
      console.warn(
        `[customBackfill] snapshot ${row.snapshotId} failed:`,
        error
      );
      failed += 1;
    }
  }

  // Per-webcam sync runs once even if multiple of its snapshots were scored.
  for (const webcamId of touchedWebcamIds) {
    await updateWebcamRegressionScoreFromLatestCustomSnapshot(webcamId);
  }

  return { scored, failed, modelVersion, scores };
}
