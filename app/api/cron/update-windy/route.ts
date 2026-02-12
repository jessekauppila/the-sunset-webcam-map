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

import { NextResponse } from 'next/server';
import { subsolarPoint } from '@/app/components/Map/lib/subsolarLocation';
import { createTerminatorQueryRing } from '@/app/components/Map/lib/terminatorRing';
import {
  TERMINATOR_RING_OFFSETS_DEG,
  TERMINATOR_PRECISION_DEG,
  TERMINATOR_SUN_ALTITUDE_DEG,
  AI_SNAPSHOT_MIN_RATING_THRESHOLD,
  AI_SNAPSHOT_RECENT_WINDOW_MINUTES,
} from '@/app/lib/terminatorConfig';
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
  upsertTerminatorState,
  deactivateMissingTerminatorState,
  updateWebcamAiFields,
  findRecentSnapshot,
  insertSnapshotRecord,
  upsertSnapshotAiInference,
} from './lib/dbOperations';
import { scoreWebcamPreview } from './lib/aiScoring';
import { captureWebcamSnapshot } from '@/app/lib/webcamSnapshot';

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
      offsetDeg
    )
  );

  // Deduplicate coordinates across all rings
  const sunriseCoords = dedupeCoords(
    ringResults.flatMap((r) => r.sunriseCoords)
  );
  const sunsetCoords = dedupeCoords(
    ringResults.flatMap((r) => r.sunsetCoords)
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
  const batches = await fetchWebcamsInBatches(allCoords, 5, 1000);
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

  // Build phase/rank lookup for AI snapshot metadata.
  const phaseByExternal = new Map<
    string,
    { phase: 'sunrise' | 'sunset'; rank: number | null }
  >();
  sunriseList.forEach((webcam, index) => {
    phaseByExternal.set(String(webcam.webcamId), {
      phase: 'sunrise',
      rank: webcam.rank ?? index,
    });
  });
  sunsetList.forEach((webcam, index) => {
    phaseByExternal.set(String(webcam.webcamId), {
      phase: 'sunset',
      rank: webcam.rank ?? index,
    });
  });

  // AI scoring + persistence counters (structured for observability).
  const aiStats = {
    total_scored: 0,
    above_threshold: 0,
    snapshots_captured: 0,
    inference_rows_written: 0,
    failures: 0,
  };
  const webcamAiUpdates: Array<{
    webcamId: number;
    aiRating: number;
    modelVersion: string;
  }> = [];

  for (const webcam of windyAll) {
    const externalId = String(webcam.webcamId);
    const webcamId = idByExternal.get(externalId);
    if (!webcamId) continue;

    try {
      const phaseMeta = phaseByExternal.get(externalId) ?? {
        phase: 'sunset' as const,
        rank: null,
      };

      const scored = await scoreWebcamPreview({
        ...webcam,
        phase: phaseMeta.phase,
        rank: phaseMeta.rank ?? undefined,
      });
      aiStats.total_scored += 1;

      webcamAiUpdates.push({
        webcamId,
        aiRating: scored.aiRating,
        modelVersion: scored.modelVersion,
      });

      if (scored.aiRating < AI_SNAPSHOT_MIN_RATING_THRESHOLD) continue;
      aiStats.above_threshold += 1;

      let snapshotId: number;
      const recent = await findRecentSnapshot(
        webcamId,
        AI_SNAPSHOT_RECENT_WINDOW_MINUTES
      );
      if (recent) {
        snapshotId = recent.id;
      } else {
        const captured = await captureWebcamSnapshot({
          ...webcam,
          webcamId,
          phase: phaseMeta.phase,
          rank: phaseMeta.rank ?? undefined,
        });

        if (!captured) {
          aiStats.failures += 1;
          continue;
        }

        snapshotId = await insertSnapshotRecord(
          webcamId,
          phaseMeta.phase,
          phaseMeta.rank,
          webcam.rating ?? null,
          captured.url,
          captured.path,
          scored.aiRating
        );
        aiStats.snapshots_captured += 1;
      }

      await upsertSnapshotAiInference(
        snapshotId,
        scored.modelVersion,
        scored.rawScore,
        scored.aiRating
      );
      aiStats.inference_rows_written += 1;
    } catch (error) {
      aiStats.failures += 1;
      console.error(
        `AI scoring failed for webcam ${webcam.webcamId}:`,
        error
      );
    }
  }

  if (webcamAiUpdates.length > 0) {
    await updateWebcamAiFields(webcamAiUpdates);
  }
  console.log('🤖 AI scoring summary:', aiStats);

  // Upsert terminator state for sunrise webcams
  await upsertTerminatorState(sunriseList, 'sunrise', idByExternal);

  // Upsert terminator state for sunset webcams
  await upsertTerminatorState(sunsetList, 'sunset', idByExternal);

  // Deactivate entries that are no longer in the current ring results
  const sunriseIds = sunriseList
    .map((w) => idByExternal.get(String(w.webcamId)))
    .filter((id): id is number => id !== undefined);
  const sunsetIds = sunsetList
    .map((w) => idByExternal.get(String(w.webcamId)))
    .filter((id): id is number => id !== undefined);
  await deactivateMissingTerminatorState('sunrise', sunriseIds);
  await deactivateMissingTerminatorState('sunset', sunsetIds);

  return NextResponse.json({
    ok: true,
    sunrise: sunriseList.length,
    sunset: sunsetList.length,
    ai: aiStats,
  });
}
