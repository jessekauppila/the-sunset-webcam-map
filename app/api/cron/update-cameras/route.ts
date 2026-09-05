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
import { setCachedTerminatorPayload, markKioskTickRan } from '@/app/lib/cache';
import { NextResponse } from 'next/server';
import { subsolarPoint } from '@/app/components/Map/lib/subsolarLocation';
import { createTerminatorQueryRing } from '@/app/components/Map/lib/terminatorRing';
import {
  TERMINATOR_CAMERA_FLOOR,
  TERMINATOR_WIDEN_OFFSETS_DEG,
  TERMINATOR_DAY_SIDE_OFFSETS_DEG,
  TERMINATOR_SWEEP_BUDGET_MS,
  TICK_DEADLINE_MS,
  TERMINATOR_PRECISION_DEG,
  TERMINATOR_SUN_ALTITUDE_DEG,
  WINDY_FETCH_BATCH_SIZE,
  WINDY_FETCH_DELAY_BETWEEN_BATCHES_MS,
  CUSTOM_CAM_FRESHNESS_WINDOW_MINUTES,
  SAVE_HIGH_RATED_SNAPSHOTS,
  SAVE_RANDOM_TRICKLE_RATE,
  SAVE_ALL_RATED_SNAPSHOTS,
  AI_SNAPSHOT_MIN_RATING_THRESHOLD,
  ARCHIVE_BACKFILL_ENABLED,
  TERMINATOR_RETENTION_GRACE_MS,
  TERMINATOR_SWEEP_FAILED_HOLD_RATIO,
} from '@/app/lib/masterConfig';
import { isFlagEnabled, SWEEP_FORCE_DAY_RING } from '@/app/lib/runtimeFlags';
import { classifyCustomCamerasForTick } from './lib/customClassification';
import { verifyCronAuth } from './lib/auth';
import { dedupeCoords, fetchCoordsCounted } from './lib/windyApi';
import { classifyWebcamsByPhase } from './lib/webcamClassification';
import { sweepWithEscalation } from './lib/terminatorSweep';
import { assessSweepHold } from './lib/sweepHealth';
import {
  ringOffsetByWebcamId,
  computeSweepTickStats,
  upsertSweepStats,
  type RingGateCounts,
} from './lib/sweepStats';
import { sweepGeometry, upsertSweepGeometry } from './lib/sweepGeometry';
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
import { decideBin, enterBins, maintainBins, type Admission } from './lib/binAdmission';
import { getLiveSettingsCached } from '@/app/lib/settings/liveSettings';
import { mergeSettings } from '@/app/lib/settings/schema';
import { SOLO_NAMESPACE, SOLO_SETTINGS_SCHEMA, dialsFrom } from '@/app/lib/solo/settingsSchema';
import { backfillArchiveSnapshotScores } from './lib/archiveBackfill';
import { computeTickStats, upsertDailyStats } from './lib/dailyStats';
import { captureProviderUsageDaily } from './lib/providerUsage';
import { sendDailyUsageDigest } from './lib/dailyDigest';
import { downloadImage, uploadToFirebase } from '@/app/lib/webcamSnapshot';

// Platform ceiling for this route, declared rather than inherited. TICK_DEADLINE_MS
// below is the in-process budget and only means anything if the platform gives the
// tick at least that long; 60s leaves a 10s margin over it. Adaptive widening made
// a slow tick likelier — tickStartedAt now starts before the Windy fetch, and an
// escalated sweep can spend up to TERMINATOR_SWEEP_BUDGET_MS of the tick — so the
// two numbers need to stay pinned together. Raising TICK_DEADLINE_MS (now in
// masterConfig.ts, where a test guards its ratio to the sweep budget) means
// raising this too.
export const maxDuration = 60;

const PER_IMAGE_TIMEOUT_MS = 3_000;
// Concurrency limit for ONNX scoring — distinct from WINDY_FETCH_BATCH_SIZE
// (API call batch size in masterConfig).
const SCORING_CONCURRENCY = 10;

export async function GET(req: Request) {
  // Verify authentication
  if (!verifyCronAuth(req)) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  // Stamp the kiosk tick lock so a kiosk poll immediately after this cron
  // tick is a no-op (shared once-per-minute budget).
  void markKioskTickRan();

  console.log('🚀 Starting cron job...');

  const now = new Date();
  const { raHours, gmstHours } = subsolarPoint(now);

  const tickStartedAt = Date.now();

  // Read per tick, so the operator can bring the spending back down without a
  // redeploy. Fails closed inside isFlagEnabled: an unreachable database
  // gives today's behaviour, never extra cost.
  const forcedDayRing = await isFlagEnabled(SWEEP_FORCE_DAY_RING);
  const forcedOffsets = forcedDayRing ? TERMINATOR_DAY_SIDE_OFFSETS_DEG : [];

  const sweep = await sweepWithEscalation({
    buildRing: (offsetDeg) => {
      const r = createTerminatorQueryRing(
        now,
        raHours,
        gmstHours,
        TERMINATOR_PRECISION_DEG,
        TERMINATOR_SUN_ALTITUDE_DEG,
        offsetDeg,
      );
      return {
        sunriseCoords: dedupeCoords(r.sunriseCoords),
        sunsetCoords: dedupeCoords(r.sunsetCoords),
      };
    },
    fetchCoords: (coords) =>
      fetchCoordsCounted(
        dedupeCoords(coords),
        WINDY_FETCH_BATCH_SIZE,
        WINDY_FETCH_DELAY_BETWEEN_BATCHES_MS,
      ),
    classify: classifyWebcamsByPhase,
    floor: TERMINATOR_CAMERA_FLOOR,
    offsets: TERMINATOR_WIDEN_OFFSETS_DEG,
    // Phase 1 of the pool-coverage spec: force the golden-hour ring so the
    // pool reaches 0 to +6 degrees, where good frames actually are, instead
    // of only the -24 to -2 band the base ring covers. Roughly doubles Windy
    // boxes per tick, which is the cost the measurement window exists to
    // price.
    forcedOffsets,
    // Escalation rings are the first thing sacrificed on a slow tick: the
    // scoring loop below needs the remaining budget more than the pool needs
    // extra cameras. See TERMINATOR_SWEEP_BUDGET_MS for the cutoff rationale.
    hasBudget: () => Date.now() - tickStartedAt < TERMINATOR_SWEEP_BUDGET_MS,
  });

  const sunriseCoords = sweep.coords.sunriseCoords;
  const sunsetCoords = sweep.coords.sunsetCoords;
  const windyAll = sweep.webcams.filter((w) => w.location);

  console.log(
    '🛰️ terminator sweep:',
    JSON.stringify({ forcedDayRing, ...sweep.telemetry }),
  );

  // Ring attribution for the detection-gate comparison. Each camera is
  // credited to the ring that first saw it this tick, so the digest can print
  // the day-side ring's gate-pass rate beside the base ring's. That
  // comparison is the only way to tell widening that adds sunsets from
  // widening that adds cameras the gate then floors — the failure the spec
  // flags as self-concealing, because escalations and newWebcams both read as
  // success while the panel stays exactly as empty.
  const ringOffsetOf = ringOffsetByWebcamId(sweep.telemetry);
  const gateByOffset = new Map<number, RingGateCounts>();
  function recordGateOutcome(externalId: number, isSunset: boolean) {
    const offsetDeg = ringOffsetOf.get(externalId);
    if (offsetDeg === undefined) return;
    const acc = gateByOffset.get(offsetDeg) ?? { scored: 0, gatePassed: 0 };
    acc.scored += 1;
    if (isSunset) acc.gatePassed += 1;
    gateByOffset.set(offsetDeg, acc);
  }

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

  // Solo kiosk admission (spec §5.3) collects during scoring and writes once
  // after the loop. Feed comes from the same classification the pool uses.
  const feedByExternalId = new Map<string, 'sunrise' | 'sunset'>();
  for (const w of sunriseList) feedByExternalId.set(String(w.webcamId), 'sunrise');
  for (const w of sunsetList) feedByExternalId.set(String(w.webcamId), 'sunset');
  const admissions: Admission[] = [];

  // Get mapping of external IDs to internal IDs
  const externalIds = windyAll.map((w) => String(w.webcamId));
  const idByExternal = await getWebcamIdMap(externalIds);

  // Prior image hashes, batched in a single query (replaces per-webcam Redis
  // GETs). Used to skip re-scoring frames whose image hasn't changed.
  const hashByWebcamId = await getWebcamImageHashMap([...idByExternal.values()]);

  // AI scoring via real image pipeline — per-tick counters.
  const windyScores: number[] = [];
  let cacheHits = 0;
  let fallbacks = 0;
  // Per-tick breakdown of which scoring path each webcam took. Makes
  // 'is ONNX actually running' inspectable from the cron response —
  // scoringPaths.onnx > 0 && scoringPaths.unscored === 0 is green.
  const scoringPaths: Record<'onnx' | 'cache-hit' | 'unscored', number> = {
    onnx: 0,
    'cache-hit': 0,
    unscored: 0,
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
      });

      if (scored.pathTaken === 'cache-hit') {
        cacheHits += 1;
        scoringPaths['cache-hit'] += 1;
        return;
      }
      if (scored.rawScore === null || scored.aiRating === null) {
        // 'unscored' — ONNX produced no real score. Write nothing; leave the
        // columns NULL so the backfill (WHERE ai_regression_score IS NULL)
        // reclaims this row once the model is loading again. Never fabricate.
        fallbacks += 1;
        scoringPaths.unscored += 1;
        return;
      }
      scoringPaths.onnx += 1;
      windyScores.push(scored.rawScore);
      // Only frames carrying a real binary verdict are counted. Without the
      // binary head configured there is no gate outcome to attribute, and a
      // scored-but-ungated frame would deflate the ring's rate rather than
      // leave it undefined.
      if (typeof scored.binaryIsSunset === 'boolean') {
        recordGateOutcome(webcam.webcamId, scored.binaryIsSunset);
      }

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
      // Control arm for the two model-gated reasons above: a uniform sample
      // taken WITHOUT looking at the score, so the archive keeps receiving an
      // unbiased stream instead of only what the incumbent model already likes.
      // Drawn independently per frame — no seed, because the point is that
      // nothing about the frame influences whether it is kept.
      const isTrickle = Math.random() < SAVE_RANDOM_TRICKLE_RATE;
      const binKind = decideBin(scored);
      const binFeed = feedByExternalId.get(externalId) ?? null;
      const shouldPersist =
        disagreementKind !== null ||
        isHighRated ||
        isTrickle ||
        SAVE_ALL_RATED_SNAPSHOTS ||
        (binKind !== null && binFeed !== null);
      // Precedence matters for the analysis, not for the write: a frame that
      // would have been saved anyway is NOT part of the unbiased arm, so the
      // gated reasons win and 'trickle' marks only frames nothing else caught.
      // 'kiosk_bin' likewise marks only frames the bins alone brought in.
      const intakeReason: 'disagreement' | 'high_rated' | 'trickle' | 'all_rated' | 'kiosk_bin' =
        disagreementKind !== null
          ? 'disagreement'
          : isHighRated
            ? 'high_rated'
            : isTrickle
              ? 'trickle'
              : SAVE_ALL_RATED_SNAPSHOTS
                ? 'all_rated'
                : 'kiosk_bin';
      if (shouldPersist) {
        try {
          const capturedAt = new Date();
          const upload = await uploadToFirebase(bytes, webcamId, capturedAt);
          const snapshotId = await insertWindyDisagreementSnapshot({
            webcamId,
            phase: 'sunset', // informational; queue doesn't filter by phase
            firebaseUrl: upload.url,
            firebasePath: upload.path,
            aiRating: scored.aiRating,
            aiRegressionScore: scored.rawScore,
            aiModelVersionRegression: scored.modelVersion,
            scoringPath: scored.pathTaken,
            disagreementKind,
            // Deliberately NOT the `binaryModelVersion` fallback above:
            // undefined here means "binary head didn't run", and the
            // regression version standing in would read as a real verdict.
            aiBinaryScore: scored.binaryRawScore,
            aiBinaryIsSunset: scored.binaryIsSunset,
            aiModelVersionBinary: scored.binaryModelVersion,
            intakeReason,
          });
          if (binKind !== null && binFeed !== null && typeof scored.binaryRawScore === 'number') {
            admissions.push({
              feed: binFeed, bin: binKind, snapshotId, webcamId,
              rawQuality: scored.rawScore, detection: scored.binaryRawScore,
            });
          }
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
      // as unscored since no real score was produced.
      scoringPaths.unscored += 1;
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

  // Solo kiosk bins: enter what this tick admitted, then age every entry
  // against where its camera's sun is now. Non-fatal: a failure here must not
  // cost the pool its update.
  let bins:
    | { admitted: Awaited<ReturnType<typeof enterBins>>; removed: Awaited<ReturnType<typeof maintainBins>> }
    | { error: true };
  try {
    const live = await getLiveSettingsCached();
    const dials = dialsFrom(mergeSettings(SOLO_SETTINGS_SCHEMA, live?.namespaces[SOLO_NAMESPACE]));
    const geometry = sweepGeometry(forcedOffsets);
    const admitted = await enterBins(admissions);
    const removed = await maintainBins({
      now: new Date(),
      zone: { minDeg: geometry.coverageMinDeg, maxDeg: geometry.coverageMaxDeg },
      grace: dials.zoneGrace,
    });
    bins = { admitted, removed };
  } catch (error) {
    console.warn('[update-cameras] solo bins failed:', error);
    bins = { error: true };
  }

  // Model-score backfill top-up — bounded by the same tick deadline. Custom-cam
  // only by default; widens to the full archive when ARCHIVE_BACKFILL_ENABLED
  // (the bulk 33k drain runs via scripts/backfill-archive-scores.ts). Subsumes
  // the former custom-only pass, so there's a single finder (no double-select).
  const remainingBudget = Math.max(
    10,
    TICK_DEADLINE_MS - (Date.now() - tickStartedAt),
  );
  const backfillResult = await backfillArchiveSnapshotScores({
    limit: Math.min(50, Math.floor(remainingBudget / 100)),
    includeAllSources: ARCHIVE_BACKFILL_ENABLED,
  });
  if (backfillResult.abortedOnFallback) {
    console.error(
      '[update-cameras] archive backfill aborted on non-ONNX path — model not loading',
    );
  }

  console.log('🤖 AI scoring summary:', {
    windyScored: windyScores.length,
    cacheHits,
    fallbacks,
    archiveBackfill: backfillResult,
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

  // Retention. Everything this tick saw is added; what it did not see is
  // removed only if (a) this tick could see the world at all and (b) the
  // camera has been unseen for the grace period. Before this, one tick that
  // got nothing back from Windy emptied both panels, and a camera Windy
  // skipped for a tick vanished for a minute.
  const sweepHold = assessSweepHold(
    sweep.telemetry,
    windyAll.length,
    TERMINATOR_SWEEP_FAILED_HOLD_RATIO,
  );

  await upsertTerminatorState(sunriseRows, 'sunrise');
  await upsertTerminatorState(sunsetRows, 'sunset');

  if (sweepHold.held) {
    console.error(
      `🛑 sweep hold (${sweepHold.reason}): ${sweepHold.failed}/${sweepHold.attempted} boxes failed, ${sweepHold.found} cameras found; keeping the last good pool`,
    );
  } else {
    const sunriseIds = sunriseRows.map((r) => r.webcamId);
    const sunsetIds = sunsetRows.map((r) => r.webcamId);
    await deactivateMissingTerminatorState('sunrise', sunriseIds, TERMINATOR_RETENTION_GRACE_MS);
    await deactivateMissingTerminatorState('sunset', sunsetIds, TERMINATOR_RETENTION_GRACE_MS);
  }

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

  // Sweep telemetry, persisted so the daily digest can still answer "how
  // often did a feed go thin" and "what did widening cost" a day later. Until
  // now it reached only this response and one log line, neither of which
  // survives the tick. Same model version as the rollup above: either writer
  // may be the one that creates the day's row, and the column is NOT NULL.
  const sweepStats = computeSweepTickStats({
    telemetry: sweep.telemetry,
    floor: TERMINATOR_CAMERA_FLOOR,
    gateByOffset,
    held: sweepHold.held,
  });
  await upsertSweepStats(new Date(), sweepStats, tickStats.modelVersion);

  // The angles behind the counters just written. Recorded every tick rather
  // than on change, because nothing watches for a change -- masterConfig.ts
  // edits arrive by deploy and the flag flips outside the app entirely.
  await upsertSweepGeometry(new Date(), sweepGeometry(forcedOffsets));

  // Once per UTC day, snapshot Neon usage counters for the Ops tab. Never
  // allowed to fail the tick.
  let providerUsage: Awaited<ReturnType<typeof captureProviderUsageDaily>> | { error: true };
  try {
    providerUsage = await captureProviderUsageDaily(new Date());
  } catch (error) {
    console.warn('[update-cameras] provider usage capture failed:', error);
    providerUsage = { error: true };
  }

  // The digest rides the once-per-day capture: it only sends on the tick that
  // actually landed a fresh snapshot. Same non-fatal contract.
  let digest: Awaited<ReturnType<typeof sendDailyUsageDigest>> | { skipped: string };
  if ('captured' in providerUsage && providerUsage.captured > 0) {
    try {
      digest = await sendDailyUsageDigest(new Date());
    } catch (error) {
      console.warn('[update-cameras] daily digest failed:', error);
      digest = { skipped: 'send-failed' };
    }
  } else {
    digest = { skipped: 'no-fresh-capture' };
  }

  return NextResponse.json({
    ok: true,
    sunrise: sunriseRows.length,
    sunset: sunsetRows.length,
    windyScored: windyScores.length,
    cacheHits,
    fallbacks,
    scoringPaths,
    archiveBackfill: backfillResult,
    providerUsage,
    digest,
    sweep: sweep.telemetry,
    retention: sweepHold,
    forcedDayRing,
    bins,
  });
}
