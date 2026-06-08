import { downloadImage } from '@/app/lib/webcamSnapshot';
import { computeDisagreementKind, scoreImage } from './aiScoring';
import {
  findExternalImagesNeedingScore,
  updateExternalImageModelScores,
  markExternalImageDeadUrl,
} from './dbOperations';

export interface ExternalBackfillResult {
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

// SSRF guard: the backfill fetches a URL stored in external_images. In practice
// ingestion mirrors every Flickr image into the project's own Firebase/GCS bucket
// (storage.googleapis.com — the SAME host the webcam archive's firebase_url uses),
// so allow that bucket; also accept raw Flickr CDN URLs for any non-mirrored rows.
// https only.
function isAllowedImageHost(rawUrl: string): boolean {
  try {
    const u = new URL(rawUrl);
    if (u.protocol !== 'https:') return false;
    const h = u.hostname.toLowerCase();
    return (
      h === 'storage.googleapis.com' ||
      h.endsWith('.firebasestorage.app') ||
      /(^|\.)staticflickr\.com$/.test(h)
    );
  } catch {
    return false;
  }
}

// Same permanent-vs-transient split as the archive backfill (see archiveBackfill).
function isPermanentDownloadError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  return /\b40[34]\b|not found|no such|does not exist|enoent/i.test(msg);
}

/**
 * Score Flickr images (external_images) needing a real v4 score (plan U6).
 * Mirrors backfillArchiveSnapshotScores but:
 *   - targets external_images (Claude judge already lives in llm_*; this fills
 *     the model columns + model-vs-Claude disagreement),
 *   - never syncs a webcams row (no webcam exists for a Flickr image),
 *   - validates the image host against the Flickr CDN allowlist (SSRF) before
 *     fetching the stored URL,
 *   - keeps the silent-ML-fallback gate: only the real ONNX path may write.
 */
export async function backfillExternalImageScores(opts: {
  limit: number;
}): Promise<ExternalBackfillResult> {
  const rows = await findExternalImagesNeedingScore(opts.limit);

  const result: ExternalBackfillResult = {
    scored: 0,
    failed: 0,
    deadUrls: 0,
    fallbacks: 0,
    abortedOnFallback: false,
    modelVersion: null,
    scores: [],
  };
  if (rows.length === 0) return result;

  for (const row of rows) {
    if (!isAllowedImageHost(row.imageUrl)) {
      console.warn(
        `[externalBackfill] external_image ${row.externalImageId} rejected disallowed/non-https image URL — skipping.`,
      );
      result.failed += 1;
      continue;
    }

    let bytes: Buffer;
    try {
      bytes = await downloadImage(row.imageUrl);
    } catch (error) {
      if (isPermanentDownloadError(error)) {
        await markExternalImageDeadUrl(row.externalImageId);
        result.deadUrls += 1;
      } else {
        console.warn(
          `[externalBackfill] external_image ${row.externalImageId} download failed (transient):`,
          error,
        );
        result.failed += 1;
      }
      continue;
    }

    let scoreResult;
    try {
      // webcamId is only a log/cache key; supply the external image id for the
      // null-webcam Flickr row.
      scoreResult = await scoreImage({
        webcamId: row.externalImageId,
        imageBytes: bytes,
        source: 'flickr',
      });
    } catch (error) {
      console.warn(
        `[externalBackfill] external_image ${row.externalImageId} scoreImage threw:`,
        error,
      );
      result.failed += 1;
      continue;
    }

    // Silent-ML-fallback gate: only the real ONNX path may write (post-#45 a
    // non-ONNX result is 'unscored' with null scores — never fabricate).
    if (scoreResult.pathTaken !== 'onnx') {
      result.fallbacks += 1;
      result.abortedOnFallback = true;
      console.error(
        `[externalBackfill] non-ONNX scoring path "${scoreResult.pathTaken}" — aborting run to avoid writing junk. Check model paths.`,
      );
      break;
    }

    if (scoreResult.rawScore === null || scoreResult.aiRating === null) {
      result.fallbacks += 1;
      result.abortedOnFallback = true;
      console.error(
        `[externalBackfill] onnx path returned null scores for external_image ${row.externalImageId} — aborting run to avoid writing junk.`,
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
      await updateExternalImageModelScores({
        externalImageId: row.externalImageId,
        regressionScore: scoreResult.rawScore,
        regressionModelVersion: scoreResult.modelVersion,
        binaryScore: scoreResult.binaryRawScore ?? null,
        binaryIsSunset: scoreResult.binaryIsSunset ?? null,
        binaryModelVersion: scoreResult.binaryModelVersion ?? null,
        scoringPath: scoreResult.pathTaken,
        disagreementKind,
      });
    } catch (error) {
      console.warn(
        `[externalBackfill] external_image ${row.externalImageId} write failed:`,
        error,
      );
      result.failed += 1;
      continue;
    }

    result.modelVersion = scoreResult.modelVersion;
    result.scores.push(scoreResult.rawScore);
    result.scored += 1;
  }

  return result;
}
