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
} from './lib/dbOperations';

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
  });
}
