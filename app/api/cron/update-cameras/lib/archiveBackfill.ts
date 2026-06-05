import { downloadImage } from '@/app/lib/webcamSnapshot';
import {
  computeDisagreementKind,
  scoreImage,
  type WebcamSource,
} from './aiScoring';
import {
  findArchiveSnapshotsNeedingScore,
  updateSnapshotModelScores,
  updateWebcamRegressionScoreFromLatestCustomSnapshot,
  markSnapshotDeadUrl,
} from './dbOperations';

export interface ArchiveBackfillResult {
  scored: number;
  failed: number;
  /** Permanently-dead URLs marked so they leave the finder's working set. */
  deadUrls: number;
  /** Non-ONNX scoring results — should be 0. >0 means the model isn't loading. */
  fallbacks: number;
  /** True when a fallback was hit and the run stopped to avoid writing junk. */
  abortedOnFallback: boolean;
  modelVersion: string | null;
  /** Raw [0,1] regression scores for successfully scored rows. */
  scores: number[];
}

// A download error worth marking dead-url (permanent) vs retrying next pass
// (transient network blip). Marking permanent failures is what lets the 33k
// drain terminate instead of re-fetching-and-failing the same row forever.
function isPermanentDownloadError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  return /\b40[34]\b|not found|no such|does not exist|enoent/i.test(msg);
}

/**
 * Score snapshots needing a real v4 score (plan U3). Mirrors
 * backfillCustomSnapshotScores but for the whole webcam archive, and:
 *
 *   - Persists all three judge columns + the model-vs-Claude disagreement
 *     (Claude's llm_* come from the finder row, so disagreement is computed
 *     offline without the binary head being enabled in prod).
 *   - ONLY writes when scoreImage took the real ONNX path. A non-ONNX result
 *     means the model isn't loading (silent-ML-fallback trap); we count it and
 *     STOP rather than backfilling thousands of fake baseline scores.
 *   - Marks permanently-unreachable images dead-url so the drain terminates.
 *   - Keeps the custom webcam-level sync (subsumes backfillCustomSnapshotScores).
 *
 * `includeAllSources` defaults false (custom-only, preserving the prior cron
 * behavior); the standalone runner and the gated full-archive pass pass true.
 */
export async function backfillArchiveSnapshotScores(opts: {
  limit: number;
  includeAllSources?: boolean;
}): Promise<ArchiveBackfillResult> {
  const rows = await findArchiveSnapshotsNeedingScore(opts.limit, {
    includeAllSources: opts.includeAllSources,
  });

  const result: ArchiveBackfillResult = {
    scored: 0,
    failed: 0,
    deadUrls: 0,
    fallbacks: 0,
    abortedOnFallback: false,
    modelVersion: null,
    scores: [],
  };
  if (rows.length === 0) return result;

  const touchedCustomWebcamIds = new Set<number>();

  for (const row of rows) {
    let bytes: Buffer;
    try {
      bytes = await downloadImage(row.firebaseUrl);
    } catch (error) {
      if (isPermanentDownloadError(error)) {
        await markSnapshotDeadUrl(row.snapshotId);
        result.deadUrls += 1;
      } else {
        console.warn(
          `[archiveBackfill] snapshot ${row.snapshotId} download failed (transient):`,
          error,
        );
        result.failed += 1;
      }
      continue;
    }

    let scoreResult;
    try {
      scoreResult = await scoreImage({
        webcamId: row.webcamId,
        imageBytes: bytes,
        source: row.source as WebcamSource,
      });
    } catch (error) {
      console.warn(`[archiveBackfill] snapshot ${row.snapshotId} scoreImage threw:`, error);
      result.failed += 1;
      continue;
    }

    // Silent-ML-fallback gate: only the real ONNX path may write. A baseline /
    // baseline-fallback result means the model isn't loading — stop the run so
    // we never backfill fake scores across the whole archive.
    if (scoreResult.pathTaken !== 'onnx') {
      result.fallbacks += 1;
      result.abortedOnFallback = true;
      console.error(
        `[archiveBackfill] non-ONNX scoring path "${scoreResult.pathTaken}" — aborting run to avoid writing baseline junk. Check AI_SCORING_MODE + model paths.`,
      );
      break;
    }

    const disagreementKind = computeDisagreementKind({
      binaryIsSunset: scoreResult.binaryIsSunset,
      aiRating: scoreResult.aiRating,
      llmQuality: row.llmQuality,
      llmIsSunset: row.llmIsSunset,
    });

    try {
      await updateSnapshotModelScores({
        snapshotId: row.snapshotId,
        regressionScore: scoreResult.rawScore,
        regressionModelVersion: scoreResult.modelVersion,
        binaryScore: scoreResult.binaryRawScore ?? null,
        binaryIsSunset: scoreResult.binaryIsSunset ?? null,
        binaryModelVersion: scoreResult.binaryModelVersion ?? null,
        scoringPath: scoreResult.pathTaken,
        disagreementKind,
      });
    } catch (error) {
      console.warn(`[archiveBackfill] snapshot ${row.snapshotId} write failed:`, error);
      result.failed += 1;
      continue;
    }

    result.modelVersion = scoreResult.modelVersion;
    result.scores.push(scoreResult.rawScore);
    result.scored += 1;
    if (row.source === 'custom') touchedCustomWebcamIds.add(row.webcamId);
  }

  // Custom webcams sync their tile-sizing score to their latest snapshot.
  // Windy/archive rows do NOT sync — backfilling old frames must not overwrite
  // a webcam's current rating with a stale one.
  for (const webcamId of touchedCustomWebcamIds) {
    await updateWebcamRegressionScoreFromLatestCustomSnapshot(webcamId);
  }

  return result;
}
