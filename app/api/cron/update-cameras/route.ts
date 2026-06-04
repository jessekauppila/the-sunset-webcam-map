/**
 * Windy webcam update cron job
 *
 * Orchestrates the terminator ring generation, Windy API fetching,
 * webcam classification, and database updates.
 *
 * Cost optimizations:
 * - No bulk table updates (uses last_fetched_at for query-time filtering)
 * - Upsert-only for terminator state (no delete-all)
 * - Only updates webcam rows when fields actually change
 */

import { fetchTerminatorWebcams } from '@/app/lib/terminatorPayload';
import { setCachedTerminatorPayload } from '@/app/lib/cache';
import { NextResponse } from 'next/server';
import { subsolarPoint } from '@/app/components/Map/lib/subsolarLocation';
import { createTerminatorQueryRing } from '@/app/components/Map/lib/terminatorRing';
import {
  TERMINATOR_RING_OFFSETS_DEG,
  TERMINATOR_PRECISION_DEG,
  TERMINATOR_SUN_ALTITUDE_DEG,
  WINDY_FETCH_BATCH_SIZE,
  WINDY_FETCH_DELAY_BETWEEN_BATCHES_MS,
  CUSTOM_CAM_FRESHNESS_WINDOW_MINUTES,
  SAVE_HIGH_RATED_SNAPSHOTS,
  SAVE_ALL_RATED_SNAPSHOTS,
  AI_SNAPSHOT_MIN_RATING_THRESHOLD,
} from '@/app/lib/masterConfig';
import { classifyCustomCamerasForTick } from './lib/customClassification';
import { verifyCronAuth } from './lib/auth';
import {
  dedupeCoords,
  fetchWebcamsInBatches,
  dedupeWebcams,
} from './lib/windyApi';
import { classifyWebcamsByPhase } from './lib/webcamClassification';
import {
  upsertWebcams,
  getWebcamIdMap,
  getWebcamImageHashMap,
  upsertTerminatorState,
  deactivateMissingTerminatorState,
  updateWebcamAiFields,
  insertWindyDisagreementSnapshot,
} from './lib/dbOperations';
import { computeDisagreementKind, scoreImage } from './lib/aiScoring';
import { backfillCustomSnapshotScores } from './lib/customBackfill';
import { computeTickStats, upsertDailyStats } from './lib/dailyStats';
import { downloadImage, uploadToFirebase } from '@/app/lib/webcamSnapshot';

const TICK_DEADLINE_MS = 50_000;
const PER_IMAGE_TIMEOUT_MS = 3_000;
// Concurrency limit for ONNX scoring — distinct from WINDY_FETCH_BATCH_SIZE
// (API call batch size in masterConfig).
const SCORING_CONCURRENCY = 10;

export async function GET(req: Request) {
  // Verify authentication
  if (!verifyCronAuth(req)) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  console.log('🚀 Starting cron job...');

  const now = new Date();
  const { raHours, gmstHours } = subsolarPoint(now);

  // Generate terminator rings for all configured offsets
  const ringResults = TERMINATOR_RING_OFFSETS_DEG.map((offsetDeg) =>
    createTerminatorQueryRing(
      now,
      raHours,
      gmstHours,
      TERMINATOR_PRECISION_DEG,
      TERMINATOR_SUN_ALTITUDE_DEG,
      offsetDeg,
    ),
  );

  // Deduplicate coordinates across all rings
  const sunriseCoords = dedupeCoords(
    ringResults.flatMap((r) => r.sunriseCoords),
  );
  const sunsetCoords = dedupeCoords(
    ringResults.flatMap((r) => r.sunsetCoords),
  );

  console.log('📍 Coords:', {
    sunrise: sunriseCoords.length,
    sunset: sunsetCoords.length,
    offsets: TERMINATOR_RING_OFFSETS_DEG,
  });

  // Fetch webcams at all coordinates
  const allCoords = dedupeCoords([...sunriseCoords, ...sunsetCoords]);
  console.log(`🌐 Total terminator coordinates: ${allCoords.length}`);

  // Fetch webcams in batches with rate limiting
  const batches = await fetchWebcamsInBatches(
    allCoords,
    WINDY_FETCH_BATCH_SIZE,
    WINDY_FETCH_DELAY_BETWEEN_BATCHES_MS,
  );
  console.log('📦 All batches received:', batches.length);

  // Deduplicate webcams by webcamId
  const windyById = dedupeWebcams(batches.flat());
  const windyAll = [...windyById.values()].filter((w) => w.location);
  console.log('🗂️ Total unique webcams:', windyAll.length);

  // Upsert all webcams to database (only updates if fields changed)
  await upsertWebcams(windyAll);

  // Classify webcams into sunrise/sunset phases
  const { sunrise: sunriseList, sunset: sunsetList } =
    classifyWebcamsByPhase(windyAll, sunriseCoords, sunsetCoords);

  console.log('📊 Webcam split:', {
    total: windyAll.length,
    sunrise: sunriseList.length,
    sunset: sunsetList.length,
  });

  // Get mapping of external IDs to internal IDs
  const externalIds = windyAll.map((w) => String(w.webcamId));
  const idByExternal = await getWebcamIdMap(externalIds);

  // Prior image hashes, batched in a single query (replaces per-webcam Redis
  // GETs). Used to skip re-scoring frames whose image hasn't changed.
  const hashByWebcamId = await getWebcamImageHashMap([...idByExternal.values()]);

  // AI scoring via real image pipeline — per-tick counters.
  const tickStartedAt = Date.now();
  const windyScores: number[] = [];
  let cacheHits = 0;
  let fallbacks = 0;
  // Per-tick breakdown of which scoring path each webcam took. Makes
  // 'is ONNX actually running' inspectable from the cron response —
  // scoringPaths.onnx > 0 && scoringPaths['baseline-fallback'] === 0 is green.
  const scoringPaths: Record<'onnx' | 'cache-hit' | 'baseline-fallback' | 'baseline', number> = {
    onnx: 0,
    'cache-hit': 0,
    'baseline-fallback': 0,
    baseline: 0,
  };

  async function scoreOneWindy(webcam: typeof windyAll[number]): Promise<void> {
    const externalId = String(webcam.webcamId);
    const webcamId = idByExternal.get(externalId);
    if (!webcamId) return;

    const previewUrl = webcam.images?.current?.preview;
    if (!previewUrl) return;

    try {
      const bytes = await Promise.race([
        downloadImage(previewUrl),
        new Promise<never>((_, rej) =>
          setTimeout(() => rej(new Error('image fetch timeout')), PER_IMAGE_TIMEOUT_MS)
        ),
      ]);
      const lastHash = hashByWebcamId.get(webcamId);
      const scored = await scoreImage({
        webcamId,
        imageBytes: bytes,
        source: 'windy',
        lastImageHash: lastHash ?? undefined,
        fallbackMeta: {
          viewCount: webcam.viewCount,
          manualRating: webcam.rating ?? undefined,
        },
      });

      if (scored.pathTaken === 'cache-hit') {
        cacheHits += 1;
        scoringPaths['cache-hit'] += 1;
        return;
      }
      if (scored.pathTaken === 'baseline-fallback') fallbacks += 1;
      scoringPaths[scored.pathTaken] += 1;
      windyScores.push(scored.rawScore);

      // Write Neon first: if the DB write fails, Redis hash is not committed
      // and the next tick will re-score. Committing the hash before the DB
      // write would silently starve the row on transient DB failures.
      //
      // When the binary classifier is configured (AI_BINARY_SCORING_ENABLED),
      // scored.binaryRawScore is the softmax probability of class 1 (sunset)
      // in [0,1]. We map it onto the 1-5 column for popup compatibility via
      // the same 1 + raw*4 formula the regression head uses. When binary
      // isn't configured, fall back to the historical "stamp regression value
      // on both columns" behaviour so the column is never null.
      const binaryRating =
        typeof scored.binaryRawScore === 'number'
          ? Number((1 + scored.binaryRawScore * 4).toFixed(2))
          : scored.aiRating;
      const binaryModelVersion = scored.binaryModelVersion ?? scored.modelVersion;
      // Persist the new image hash in the same UPDATE as the AI fields. The
      // hash commits atomically with the score, so a failed write leaves the
      // row un-hashed and the next tick re-scores it (the invariant the old
      // "Neon write before Redis hash write" ordering preserved).
      await updateWebcamAiFields([
        {
          webcamId,
          aiRating: scored.aiRating,
          aiModelVersion: scored.modelVersion,
          aiRatingBinary: binaryRating,
          aiModelVersionBinary: binaryModelVersion,
          aiRatingRegression: scored.aiRating,
          aiModelVersionRegression: scored.modelVersion,
          lastImageHash: scored.imageHash,
        },
      ]);

      // Windy webcams don't normally create webcam_snapshots rows
      // (SNAPSHOTS_ENABLED=false). We persist a row here when ANY of:
      //   - the two heads disagree (Hard Examples queue), OR
      //   - SAVE_HIGH_RATED_SNAPSHOTS && this frame scored highly (best-of /
      //     leaderboard archive), OR
      //   - SAVE_ALL_RATED_SNAPSHOTS (bring in every scored frame).
      // Persisted rows carry ai_rating, so they feed the Best Sunsets
      // leaderboard. Best-effort: a Firebase upload failure logs but doesn't
      // fail the cron tick.
      const disagreementKind = computeDisagreementKind({
        binaryIsSunset: scored.binaryIsSunset,
        aiRating: scored.aiRating,
      });
      const isHighRated =
        SAVE_HIGH_RATED_SNAPSHOTS &&
        scored.aiRating >= AI_SNAPSHOT_MIN_RATING_THRESHOLD;
      const shouldPersist =
        disagreementKind !== null || isHighRated || SAVE_ALL_RATED_SNAPSHOTS;
      if (shouldPersist) {
        try {
          const capturedAt = new Date();
          const upload = await uploadToFirebase(bytes, webcamId, capturedAt);
          await insertWindyDisagreementSnapshot({
            webcamId,
            phase: 'sunset', // informational; queue doesn't filter by phase
            firebaseUrl: upload.url,
            firebasePath: upload.path,
            aiRating: scored.aiRating,
            aiRegressionScore: scored.rawScore,
            aiModelVersionRegression: scored.modelVersion,
            scoringPath: scored.pathTaken,
            disagreementKind,
          });
        } catch (persistError) {
          console.warn(
            `[update-cameras] Failed to persist Windy disagreement snapshot for webcam ${webcamId}:`,
            persistError,
          );
        }
      }
    } catch (error) {
      console.warn(
        `[update-cameras] windy webcam ${webcam.webcamId} scoring failed:`,
        error,
      );
      fallbacks += 1;
      // Same conflation as `fallbacks`: download/timeout failures count
      // as a fallback path since no real score was produced.
      scoringPaths['baseline-fallback'] += 1;
    }
  }

  for (let i = 0; i < windyAll.length; i += SCORING_CONCURRENCY) {
    // Per-batch granularity: a batch that starts 1 ms before the deadline can
    // still run for up to PER_IMAGE_TIMEOUT_MS × SCORING_CONCURRENCY (~30 s).
    // Intentional trade-off — simpler than per-image checks.
    if (Date.now() - tickStartedAt > TICK_DEADLINE_MS) {
      console.warn('[update-cameras] tick deadline reached, stopping batches');
      break;
    }
    const batch = windyAll.slice(i, i + SCORING_CONCURRENCY);
    await Promise.all(batch.map(scoreOneWindy));
  }

  // Custom-camera score backfill — bounded by the same tick deadline.
  const remainingBudget = Math.max(
    10,
    TICK_DEADLINE_MS - (Date.now() - tickStartedAt),
  );
  const backfillResult = await backfillCustomSnapshotScores({
    limit: Math.min(50, Math.floor(remainingBudget / 100)),
  });

  console.log('🤖 AI scoring summary:', {
    windyScored: windyScores.length,
    cacheHits,
    fallbacks,
    customBackfill: backfillResult,
  });

  // Resolve Windy external_id → DB webcam_id rows
  function toWindyDbRows(list: typeof sunriseList) {
    return list
      .map((w) => idByExternal.get(String(w.webcamId)))
      .filter((id): id is number => id !== undefined)
      .map((webcamId) => ({ webcamId }));
  }
  const sunriseWindyRows = toWindyDbRows(sunriseList);
  const sunsetWindyRows = toWindyDbRows(sunsetList);

  // Classify custom cams against the same ring coords + freshness window
  const customClassified = await classifyCustomCamerasForTick({
    sunriseCoords,
    sunsetCoords,
    freshnessWindowMinutes: CUSTOM_CAM_FRESHNESS_WINDOW_MINUTES,
    now,
  });

  // Union Windy + custom by webcamId, Windy first (preserves Windy lat-sorted rank).
  function unionByWebcamId(
    primary: Array<{ webcamId: number }>,
    secondary: Array<{ webcamId: number }>,
  ): Array<{ webcamId: number }> {
    const seen = new Set<number>();
    const out: Array<{ webcamId: number }> = [];
    for (const r of primary) {
      if (!seen.has(r.webcamId)) {
        seen.add(r.webcamId);
        out.push(r);
      }
    }
    for (const r of secondary) {
      if (!seen.has(r.webcamId)) {
        seen.add(r.webcamId);
        out.push(r);
      }
    }
    return out;
  }
  const sunriseRows = unionByWebcamId(sunriseWindyRows, customClassified.sunrise);
  const sunsetRows = unionByWebcamId(sunsetWindyRows, customClassified.sunset);

  await upsertTerminatorState(sunriseRows, 'sunrise');
  await upsertTerminatorState(sunsetRows, 'sunset');

  const sunriseIds = sunriseRows.map((r) => r.webcamId);
  const sunsetIds = sunsetRows.map((r) => r.webcamId);
  await deactivateMissingTerminatorState('sunrise', sunriseIds);
  await deactivateMissingTerminatorState('sunset', sunsetIds);

  try {
    const cachedPayload = await fetchTerminatorWebcams();
    await setCachedTerminatorPayload(cachedPayload);
    console.log(
      `💾 Cached ${cachedPayload.length} terminator webcams to KV`,
    );
  } catch (error) {
    console.error('Failed to update terminator cache:', error);
  }

  const tickStats = computeTickStats({
    windyScores,
    customScores: backfillResult.scores,
    cacheHits,
    // Windy ONNX-fallback paths and custom-snapshot failures are summed for the
    // per-day `fallbacks` column. sourceBreakdown already separates them by
    // source, so this conflation is observability-only, not a correctness issue.
    fallbacks: fallbacks + backfillResult.failed,
    modelVersion:
      backfillResult.modelVersion ??
      process.env.AI_REGRESSION_MODEL_VERSION?.trim() ??
      'unknown',
    // 0.5 matches the device-protocol §9.4.2 default. Task 14 replaces this
    // literal with WINNER_POLICY_WINDY_MIN_SCORE_TO_WIN once Phase 2 lands.
    minScoreToWin: 0.5,
  });
  try {
    await upsertDailyStats(new Date(), tickStats);
  } catch (err) {
    console.error('[update-cameras] daily_sunset_stats UPSERT failed:', err);
  }

  return NextResponse.json({
    ok: true,
    sunrise: sunriseRows.length,
    sunset: sunsetRows.length,
    windyScored: windyScores.length,
    cacheHits,
    fallbacks,
    scoringPaths,
    customBackfill: backfillResult,
  });
}
