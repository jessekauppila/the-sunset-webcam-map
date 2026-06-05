/**
 * Database operations module
 * Handles all database writes with cost optimizations:
 * - Only updates webcam rows when fields actually change
 * - Uses upsert-only for terminator state (no delete-all)
 * - Updates last_fetched_at/last_seen_at for query-time filtering
 */

import { sql } from '@/app/lib/db';
import type { WindyWebcam } from '@/app/lib/types';

type WebcamAiUpdate = {
  webcamId: number;
  aiRating: number;
  aiModelVersion: string;
  aiRatingBinary: number;
  aiModelVersionBinary: string;
  aiRatingRegression: number;
  aiModelVersionRegression: string;
  /**
   * sha256 of the scored image. Persisted so the next tick can skip
   * re-scoring an unchanged frame — replaces the former Redis image-hash
   * cache (which was the dominant Upstash command consumer). Optional:
   * when omitted, the existing stored hash is preserved (COALESCE).
   */
  lastImageHash?: string;
};

type SnapshotRecord = {
  id: number;
};

/**
 * Convert WindyWebcam to database fields
 */
function toDbFields(w: WindyWebcam) {
  return {
    source: 'windy' as const,
    external_id: String(w.webcamId),
    title: w.title ?? null,
    status: w.status ?? null,
    view_count: w.viewCount ?? null,
    lat: w.location.latitude,
    lng: w.location.longitude,
    city: w.location.city ?? null,
    region: w.location.region ?? null,
    country: w.location.country ?? null,
    continent: w.location.continent ?? null,
    // Convert to JSON strings for JSONB columns
    images: w.images ? JSON.stringify(w.images) : null,
    urls: w.urls ? JSON.stringify(w.urls) : null,
    player: w.player ? JSON.stringify(w.player) : null,
    categories: w.categories ? JSON.stringify(w.categories) : null,
  };
}

/**
 * Upsert webcams, only updating rows when fields actually change
 * This reduces unnecessary writes by using WHERE clause in UPDATE
 */
export async function upsertWebcams(webcams: WindyWebcam[]): Promise<void> {
  for (const w of webcams) {
    try {
      const d = toDbFields(w);
      await sql`
        insert into webcams (
          source, external_id, title, status, view_count, lat, lng, city, region, country, continent,
          images, urls, player, categories, last_fetched_at, updated_at
        ) values (
          ${d.source}, ${d.external_id}, ${d.title}, ${d.status}, ${d.view_count},
          ${d.lat}, ${d.lng}, ${d.city}, ${d.region}, ${d.country}, ${d.continent},
          ${d.images}::jsonb, ${d.urls}::jsonb, ${d.player}::jsonb, ${d.categories}::jsonb,
          now(), now()
        )
        on conflict (source, external_id) do update set
          title = excluded.title,
          status = excluded.status,
          view_count = excluded.view_count,
          lat = excluded.lat,
          lng = excluded.lng,
          city = excluded.city,
          region = excluded.region,
          country = excluded.country,
          continent = excluded.continent,
          images = excluded.images,
          urls = excluded.urls,
          player = excluded.player,
          categories = excluded.categories,
          last_fetched_at = now(),
          updated_at = case
                         when webcams.title is distinct from excluded.title
                           or webcams.status is distinct from excluded.status
                           or webcams.images is distinct from excluded.images
                           or webcams.urls is distinct from excluded.urls
                           or webcams.player is distinct from excluded.player
                           or webcams.categories is distinct from excluded.categories
                           or webcams.lat is distinct from excluded.lat
                           or webcams.lng is distinct from excluded.lng
                         then now()
                         else webcams.updated_at
                       end
      `;
    } catch (error) {
      console.error(
        '❌ Failed to upsert webcam:',
        w.webcamId,
        w.title
      );
      console.error('❌ Error:', error);
      console.error('❌ Categories data:', w.categories);
      // Skip this webcam and continue with others
    }
  }
}

/**
 * Get mapping of external IDs to internal webcam IDs
 */
export async function getWebcamIdMap(
  externalIds: string[]
): Promise<Map<string, number>> {
  if (externalIds.length === 0) {
    return new Map();
  }

  const rows = (await sql`
    select id, external_id from webcams
    where source = 'windy' and external_id = any(${externalIds})
  `) as { id: number; external_id: string }[];

  return new Map(rows.map((r) => [r.external_id, r.id]));
}

/**
 * Batch-fetch the last scored image hash for the given webcam ids.
 *
 * One query per tick replaces the former per-webcam Redis GETs — the
 * Upstash command count no longer scales with webcam volume. Rows whose
 * last_image_hash is null are simply absent from the map (treated as
 * "no prior hash" by the caller).
 */
export async function getWebcamImageHashMap(
  webcamIds: number[]
): Promise<Map<number, string>> {
  if (webcamIds.length === 0) {
    return new Map();
  }

  const rows = (await sql`
    select id, last_image_hash from webcams
    where id = any(${webcamIds}) and last_image_hash is not null
  `) as { id: number; last_image_hash: string }[];

  return new Map(rows.map((r) => [r.id, r.last_image_hash]));
}

/**
 * Upsert terminator-state rows from pre-resolved DB webcam ids.
 * Rank is the array index. Caller is responsible for any ordering
 * decisions (sort, union, dedupe) before passing the array in.
 */
export async function upsertTerminatorState(
  rows: Array<{ webcamId: number }>,
  phase: 'sunrise' | 'sunset',
): Promise<void> {
  const promises = rows.map(async (row, rank) => {
    const { webcamId } = row;
    await sql`
      insert into terminator_webcam_state (webcam_id, phase, rank, last_seen_at, updated_at, active)
      values (${webcamId}, ${phase}, ${rank}, now(), now(), true)
      on conflict (webcam_id, phase) do update set
        rank = excluded.rank,
        last_seen_at = now(),
        updated_at = now(),
        active = true
    `;
  });

  await Promise.all(promises);
}

/**
 * Flip rows in this phase to active=false unless their webcam_id is in
 * activeWebcamIds. Source-agnostic: caller is responsible for unioning
 * active ids across Windy + custom (or any other source) before calling.
 *
 * WARNING: this function previously had a source='windy' guard. After its
 * removal, passing an incomplete active set will deactivate rows of any
 * source not in the set. Always pass the FULL union of active ids across
 * every source the caller knows about — partial sets silently deactivate
 * other-source rows.
 */
export async function deactivateMissingTerminatorState(
  phase: 'sunrise' | 'sunset',
  activeWebcamIds: number[],
): Promise<void> {
  if (activeWebcamIds.length === 0) {
    await sql`
      update terminator_webcam_state
      set active = false, updated_at = now()
      where phase = ${phase}
        and active = true
    `;
    return;
  }

  await sql`
    update terminator_webcam_state
    set active = false, updated_at = now()
    where phase = ${phase}
      and active = true
      and webcam_id <> all(${activeWebcamIds})
  `;
}

/**
 * Update webcam-level AI fields used by map popups.
 */
export async function updateWebcamAiFields(
  updates: WebcamAiUpdate[]
): Promise<void> {
  const tasks = updates.map((item) =>
    sql`
      update webcams
      set ai_rating = ${item.aiRating},
          ai_model_version = ${item.aiModelVersion},
          ai_rating_binary = ${item.aiRatingBinary},
          ai_model_version_binary = ${item.aiModelVersionBinary},
          ai_rating_regression = ${item.aiRatingRegression},
          ai_model_version_regression = ${item.aiModelVersionRegression},
          last_image_hash = coalesce(${item.lastImageHash ?? null}, last_image_hash),
          updated_at = now()
      where id = ${item.webcamId}
    `
  );

  await Promise.all(tasks);
}

/**
 * Find a recent snapshot for deduplication to avoid over-capturing.
 */
export async function findRecentSnapshot(
  webcamId: number,
  windowMinutes: number
): Promise<SnapshotRecord | null> {
  const [row] = (await sql`
    select id
    from webcam_snapshots
    where webcam_id = ${webcamId}
      and captured_at >= now() - make_interval(mins => ${windowMinutes})
    order by captured_at desc
    limit 1
  `) as SnapshotRecord[];

  return row ?? null;
}

/**
 * Insert a newly captured snapshot row.
 */
export async function insertSnapshotRecord(
  webcamId: number,
  phase: 'sunrise' | 'sunset',
  rank: number | null,
  initialRating: number | null,
  firebaseUrl: string,
  firebasePath: string,
  aiRating: number | null
): Promise<number> {
  const [row] = (await sql`
    insert into webcam_snapshots (
      webcam_id,
      phase,
      rank,
      initial_rating,
      firebase_url,
      firebase_path,
      ai_rating,
      captured_at
    )
    values (
      ${webcamId},
      ${phase},
      ${rank},
      ${initialRating},
      ${firebaseUrl},
      ${firebasePath},
      ${aiRating},
      now()
    )
    returning id
  `) as SnapshotRecord[];

  return row.id;
}

/**
 * Persist a Windy webcam snapshot specifically when the two model heads
 * disagreed at score time. Used by `scoreOneWindy` in route.ts to keep
 * disagreement frames around for the Hard Examples drawer queue and v5
 * training labels, even though Windy webcams don't otherwise create
 * `webcam_snapshots` rows under the current SNAPSHOTS_ENABLED=false config.
 *
 * Phase is informational here (Windy scoring runs before the sunrise/sunset
 * classification step in this cron tick); 'sunset' is the conservative
 * default — the Hard Examples queue doesn't filter by phase.
 */
export async function insertWindyDisagreementSnapshot(opts: {
  webcamId: number;
  phase: 'sunrise' | 'sunset';
  firebaseUrl: string;
  firebasePath: string;
  aiRating: number;
  aiRegressionScore: number;
  aiModelVersionRegression: string;
  scoringPath: string;
  // null when the frame is persisted for a non-disagreement reason
  // (high-rated or all-rated capture toggles), not the Hard Examples queue.
  disagreementKind: string | null;
}): Promise<number> {
  const [row] = (await sql`
    insert into webcam_snapshots (
      webcam_id,
      phase,
      initial_rating,
      firebase_url,
      firebase_path,
      ai_rating,
      ai_regression_score,
      ai_model_version_regression,
      scoring_path,
      model_disagreement_kind,
      captured_at
    )
    values (
      ${opts.webcamId},
      ${opts.phase},
      null,
      ${opts.firebaseUrl},
      ${opts.firebasePath},
      ${opts.aiRating},
      ${opts.aiRegressionScore},
      ${opts.aiModelVersionRegression},
      ${opts.scoringPath},
      ${opts.disagreementKind},
      now()
    )
    returning id
  `) as SnapshotRecord[];

  return row.id;
}

/**
 * Upsert model inference metadata for a snapshot.
 */
export async function upsertSnapshotAiInference(
  snapshotId: number,
  modelVersion: string,
  rawScore: number,
  aiRating: number
): Promise<void> {
  await sql`
    insert into snapshot_ai_inferences (
      snapshot_id,
      model_version,
      raw_score,
      ai_rating,
      scored_at
    )
    values (
      ${snapshotId},
      ${modelVersion},
      ${rawScore},
      ${aiRating},
      now()
    )
    on conflict (snapshot_id, model_version)
    do update set
      raw_score = excluded.raw_score,
      ai_rating = excluded.ai_rating,
      scored_at = now()
  `;
}

/**
 * After scoring custom snapshots, sync the webcam-level score to the latest
 * snapshot's regression score so mosaic tile sizing reflects the most recent
 * captured moment. Single SQL — no read-then-write race.
 */
export async function updateWebcamRegressionScoreFromLatestCustomSnapshot(
  webcamId: number
): Promise<void> {
  // Map the raw [0,1] score into the 1-5 display scale (inverse of the
  // (rating-1)/4 normalization applied at training time in ml/export_dataset.py).
  // Windy path does this in aiScoring.ts/normalizeOnnxOutput; custom path
  // persists the raw score per-snapshot and maps here at sync time.
  await sql`
    update webcams
    set ai_rating_regression = 1 + ls.ai_regression_score * 4,
        ai_model_version_regression = ls.ai_model_version_regression,
        updated_at = now()
    from (
      select ai_regression_score, ai_model_version_regression
      from webcam_snapshots
      where webcam_id = ${webcamId}
        and ai_regression_score is not null
      order by captured_at desc
      limit 1
    ) ls
    where id = ${webcamId}
  `;
}

/* -------------------------------------------------------------------------- */
/* Archive model backfill (plan U3)                                            */
/* -------------------------------------------------------------------------- */

export interface ArchiveSnapshotNeedingScore {
  snapshotId: number;
  webcamId: number;
  firebaseUrl: string;
  source: string;
  /** Claude's scores, when present — fed into the model-vs-Claude disagreement. */
  llmQuality: number | null;
  llmIsSunset: boolean | null;
}

/**
 * Snapshot rows that still need a real v4 regression score, ordered by recency,
 * excluding rows permanently marked `scoring_state='dead-url'` so the drain
 * terminates. Reads `w.source` (to decide the custom webcam-sync) and Claude's
 * `llm_*` (to compute model-vs-Claude during the backfill) — but does NOT
 * filter by source unless `includeAllSources` is false, the default that
 * preserves the prior custom-only cron behavior. The standalone runner and the
 * gated full-archive cron pass set `includeAllSources: true`.
 */
export async function findArchiveSnapshotsNeedingScore(
  limit: number,
  opts: { includeAllSources?: boolean } = {},
): Promise<ArchiveSnapshotNeedingScore[]> {
  const includeAllSources = opts.includeAllSources ?? false;
  const rows = (await sql`
    select s.id           as snapshot_id,
           s.webcam_id    as webcam_id,
           s.firebase_url,
           w.source       as source,
           s.llm_quality  as llm_quality,
           s.llm_is_sunset as llm_is_sunset
    from webcam_snapshots s
    join webcams w on w.id = s.webcam_id
    where s.ai_regression_score is null
      and s.firebase_url is not null
      and s.scoring_state is distinct from 'dead-url'
      and (${includeAllSources} or w.source = 'custom')
    order by s.captured_at desc
    limit ${limit}
  `) as {
    snapshot_id: number;
    webcam_id: number;
    firebase_url: string;
    source: string;
    llm_quality: number | string | null;
    llm_is_sunset: boolean | null;
  }[];

  return rows.map((r) => ({
    snapshotId: r.snapshot_id,
    webcamId: r.webcam_id,
    firebaseUrl: r.firebase_url,
    source: r.source,
    llmQuality: r.llm_quality == null ? null : Number(r.llm_quality),
    llmIsSunset: r.llm_is_sunset,
  }));
}

/** Count of snapshots still needing a score — for the backfill dry-run. */
export async function countArchiveSnapshotsNeedingScore(
  opts: { includeAllSources?: boolean } = {},
): Promise<number> {
  const includeAllSources = opts.includeAllSources ?? false;
  const rows = (await sql`
    select count(*)::int as n
    from webcam_snapshots s
    join webcams w on w.id = s.webcam_id
    where s.ai_regression_score is null
      and s.firebase_url is not null
      and s.scoring_state is distinct from 'dead-url'
      and (${includeAllSources} or w.source = 'custom')
  `) as { n: number }[];
  return rows[0]?.n ?? 0;
}

/**
 * Persist all three judge columns + the disagreement verdict for a backfilled
 * snapshot, stamping `disagreement_computed_at` so the U3b recompute pass knows
 * the kind was computed against whatever Claude data existed at write time.
 * Deliberately leaves the junk legacy `ai_rating` column untouched.
 */
export async function updateSnapshotModelScores(opts: {
  snapshotId: number;
  regressionScore: number;
  regressionModelVersion: string;
  binaryScore: number | null;
  binaryIsSunset: boolean | null;
  binaryModelVersion: string | null;
  scoringPath: string;
  disagreementKind: string | null;
}): Promise<void> {
  await sql`
    update webcam_snapshots
    set ai_regression_score = ${opts.regressionScore},
        ai_model_version_regression = ${opts.regressionModelVersion},
        ai_binary_score = ${opts.binaryScore},
        ai_binary_is_sunset = ${opts.binaryIsSunset},
        ai_model_version_binary = ${opts.binaryModelVersion},
        scoring_path = ${opts.scoringPath},
        model_disagreement_kind = ${opts.disagreementKind},
        disagreement_computed_at = now()
    where id = ${opts.snapshotId}
  `;
}

/** Mark a snapshot whose image is permanently unreachable (404 / dead URL). */
export async function markSnapshotDeadUrl(snapshotId: number): Promise<void> {
  await sql`
    update webcam_snapshots
    set scoring_state = 'dead-url'
    where id = ${snapshotId}
  `;
}

/* -------------------------------------------------------------------------- */
/* Disagreement recompute (plan U3b)                                           */
/* -------------------------------------------------------------------------- */

export interface SnapshotNeedingRecompute {
  snapshotId: number;
  aiRegressionScore: number;
  binaryIsSunset: boolean | null;
  llmQuality: number | null;
  llmIsSunset: boolean | null;
}

/**
 * Rows whose model_disagreement_kind was computed BEFORE Claude's score landed
 * (or never computed) — the ~3.4k frames Claude scores after the model backfill,
 * plus legacy rows. Pure recompute: no image download or ONNX, just re-derive
 * the verdict from the already-stored model + Claude scores. `llm_rated_at`
 * exists on webcam_snapshots (20260417); a NULL disagreement_computed_at always
 * qualifies so legacy rows get a first computation.
 */
export async function findSnapshotsNeedingDisagreementRecompute(
  limit: number,
): Promise<SnapshotNeedingRecompute[]> {
  const rows = (await sql`
    select s.id                 as snapshot_id,
           s.ai_regression_score as ai_regression_score,
           s.ai_binary_is_sunset as ai_binary_is_sunset,
           s.llm_quality        as llm_quality,
           s.llm_is_sunset      as llm_is_sunset
    from webcam_snapshots s
    where s.ai_regression_score is not null
      and s.llm_quality is not null
      and (s.disagreement_computed_at is null
           or s.disagreement_computed_at < s.llm_rated_at)
    order by s.llm_rated_at desc nulls last
    limit ${limit}
  `) as {
    snapshot_id: number;
    ai_regression_score: number | string;
    ai_binary_is_sunset: boolean | null;
    llm_quality: number | string | null;
    llm_is_sunset: boolean | null;
  }[];

  return rows.map((r) => ({
    snapshotId: r.snapshot_id,
    aiRegressionScore: Number(r.ai_regression_score),
    binaryIsSunset: r.ai_binary_is_sunset,
    llmQuality: r.llm_quality == null ? null : Number(r.llm_quality),
    llmIsSunset: r.llm_is_sunset,
  }));
}

/**
 * Write ONLY the disagreement verdict + its computed-at stamp. Used by the
 * recompute pass, which re-derives the kind without re-scoring the image, so it
 * must not touch ai_regression_score / binary columns.
 */
export async function updateSnapshotDisagreement(
  snapshotId: number,
  disagreementKind: string | null,
): Promise<void> {
  await sql`
    update webcam_snapshots
    set model_disagreement_kind = ${disagreementKind},
        disagreement_computed_at = now()
    where id = ${snapshotId}
  `;
}

