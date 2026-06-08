//what is this for?
//
//
import { NextResponse } from 'next/server';
import { sql } from '@/app/lib/db';
import { requireOwner } from '@/app/lib/owner';
import {
  transformSnapshot,
  type SnapshotRow,
} from '@/app/lib/snapshotTransform';
import { shuffleArray } from '@/app/lib/shuffle';
import type { Snapshot } from '@/app/lib/types';
import {
  SNAPSHOT_QUEUE_PROGRESS_RATED_SCOPE,
  SNAPSHOT_QUEUE_UNRATED_SCOPE,
} from '@/app/lib/masterConfig';
import { deriveProvenance } from '@/app/lib/provenance';

export const dynamic = 'force-dynamic';
const MAX_EXCLUDE_IDS = 1000;

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);

    // Parse query parameters
    const webcamId = searchParams.get('webcam_id');
    const phase = searchParams.get('phase');
    const minRating = searchParams.get('min_rating');
    const unratedOnly = searchParams.get('unrated_only') === 'true';
    const curatedMix = searchParams.get('curated_mix') === 'true';
    const userSessionId = searchParams.get('user_session_id');
    const limit = parseInt(searchParams.get('limit') || '100', 10);
    const offset = parseInt(searchParams.get('offset') || '0', 10);
    const modeParam = searchParams.get('mode');
    const mode: 'archive' | 'curated' | 'hard-examples' | 'verification' =
      modeParam === 'curated'
        ? 'curated'
        : modeParam === 'hard-examples'
        ? 'hard-examples'
        : modeParam === 'verification'
        ? 'verification'
        : 'archive';

    // Central owner-auth (review #10): modes are PRIVATE BY DEFAULT. Only the
    // explicitly public modes skip the owner gate; every other mode
    // (hard-examples, verification, and any future private mode) is gated here,
    // before any query runs — so a new private mode is secure by default rather
    // than relying on each branch to remember to call requireOwner().
    const PUBLIC_MODES = new Set(['archive', 'curated']);
    if (!PUBLIC_MODES.has(mode)) {
      const denied = await requireOwner();
      if (denied) return denied;
    }
    const excludeIdsParam = searchParams.get('exclude_ids');
    const excludeIds = excludeIdsParam
      ? excludeIdsParam
          .split(',')
          .map((s) => parseInt(s.trim(), 10))
          .filter((n) => Number.isFinite(n) && n > 0)
          .slice(-MAX_EXCLUDE_IDS)
      : [];

    // Build WHERE clause fragments for use with sql.unsafe()
    // Since excludeIds are already validated integers, we can safely format them
    const buildWhereClause = () => {
      const conditions: string[] = [];

      if (webcamId) {
        const id = parseInt(webcamId, 10);
        conditions.push(`s.webcam_id = ${id}`);
      }

      if (phase && (phase === 'sunrise' || phase === 'sunset')) {
        // Escape single quotes for SQL safety
        const escapedPhase = phase.replace(/'/g, "''");
        conditions.push(`s.phase = '${escapedPhase}'`);
      }

      if (minRating) {
        const rating = parseFloat(minRating);
        conditions.push(`s.calculated_rating >= ${rating}`);
      }

      // Add exclude_ids filter - excludeIds are already validated as integers
      if (excludeIds.length > 0) {
        const idsString = excludeIds.join(', ');
        conditions.push(`s.id NOT IN (${idsString})`);
      }

      return conditions.length > 0 ? conditions.join(' AND ') : '1=1';
    };

    const whereClause = buildWhereClause();

    // HARD EXAMPLES MODE: snapshots the cron flagged as model disagreements,
    // ordered newest-first. Excludes anything the current operator has already
    // verdicted (so submitted snapshots leave the queue). See
    // docs/superpowers/specs/2026-06-02-hard-example-mining-and-private-labeling-design.md.
    if (mode === 'hard-examples') {
      // Operator-only read: this is the private labeling queue. The owner gate
      // is enforced centrally above (review #10); UI hiding is cosmetic.

      // Membership invariant (plan U4): queue = flagged MINUS verdicted,
      // applied UNCONDITIONALLY — not gated on user_session_id. Single operator,
      // so a verdict permanently removes the frame regardless of who/which
      // session asks. A later recompute (U3b) must not resurrect a verdicted
      // frame, which this exclusion guarantees.
      const exclusionClause = sql`AND s.id NOT IN (
            SELECT snapshot_id FROM webcam_snapshot_ratings
            WHERE is_sunset_verdict IS NOT NULL
          )`;

      const rows = (await sql`
          SELECT
            s.id as snapshot_id,
            s.webcam_id,
            s.phase,
            s.rank,
            s.initial_rating,
            s.calculated_rating,
            s.ai_rating,
            s.firebase_url,
            s.firebase_path,
            s.captured_at,
            s.created_at,
            0::int as rating_count,
            NULL::numeric as user_rating,
            w.id as w_id,
            w.source,
            w.external_id,
            w.title,
            w.status,
            w.view_count,
            w.lat,
            w.lng,
            w.city,
            w.region,
            w.country,
            w.continent,
            w.images,
            w.urls,
            w.player,
            w.categories,
            w.last_fetched_at,
            w.rating as webcam_rating,
            w.orientation,
            w.ai_rating as webcam_ai_rating,
            w.ai_model_version as webcam_ai_model_version,
            w.ai_rating_binary as webcam_ai_rating_binary,
            w.ai_model_version_binary as webcam_ai_model_version_binary,
            w.ai_rating_regression as webcam_ai_rating_regression,
            w.ai_model_version_regression as webcam_ai_model_version_regression,
            s.model_disagreement_kind,
            s.human_sunset_majority
          FROM webcam_snapshots s
          JOIN webcams w ON w.id = s.webcam_id
          WHERE s.model_disagreement_kind IS NOT NULL
            ${exclusionClause}
          ORDER BY
            -- Priority mirrors DISAGREEMENT_KIND_PRIORITY (aiScoring.ts):
            -- model-vs-Claude (Claude trusted) ranks above the binary split.
            CASE s.model_disagreement_kind
              WHEN 'model_low_claude_sunset' THEN 100
              WHEN 'model_high_claude_not_sunset' THEN 100
              WHEN 'binary_negative_regression_high' THEN 50
              WHEN 'binary_positive_regression_low' THEN 50
              ELSE 0
            END DESC,
            -- Then the gap magnitude (both [0,1]); biggest confident misses first.
            ABS(COALESCE(s.ai_regression_score, 0) - COALESCE(s.llm_quality, 0)) DESC,
            s.captured_at DESC
          LIMIT ${limit} OFFSET ${offset}
        `) as SnapshotRow[];

      const countResult = await sql`
          SELECT COUNT(*)::int AS total
          FROM webcam_snapshots s
          WHERE s.model_disagreement_kind IS NOT NULL
            ${exclusionClause}
        `;
      const total =
        (countResult as Array<{ total: number }>)[0]?.total ?? 0;

      return NextResponse.json({
        snapshots: rows.map(transformSnapshot),
        total,
        limit,
        offset,
      });
    }

    // VERIFICATION MODE (plan U7): owner-only triage view that unions the webcam
    // archive with the Flickr set (external_images). Two queries merged in JS —
    // the tables have different shapes, so this avoids a fragile column-matched
    // SQL UNION; transformSnapshot defaults the webcam-only fields the Flickr
    // rows omit. Toggle: disagreements_only=true ranks the model-vs-Claude queue;
    // off = browse all frames (eyeball judge coverage). Owner gate enforced above.
    if (mode === 'verification') {
      const disagreementsOnly =
        searchParams.get('disagreements_only') === 'true';
      const sourceFilter = searchParams.get('source'); // 'webcam' | 'flickr' | null
      // Over-fetch so the merged result can be paged in JS.
      const fetchN = limit + offset;

      // One sort key for both tables so the merge is a single global order:
      // disagreements → priority tier + [0,1] gap magnitude; browse → recency.
      const webcamSortKey = disagreementsOnly
        ? sql`(CASE s.model_disagreement_kind
                 WHEN 'model_low_claude_sunset' THEN 100
                 WHEN 'model_high_claude_not_sunset' THEN 100
                 WHEN 'binary_negative_regression_high' THEN 50
                 WHEN 'binary_positive_regression_low' THEN 50
                 ELSE 0 END
               + ABS(COALESCE(s.ai_regression_score, 0) - COALESCE(s.llm_quality, 0)))`
        : sql`EXTRACT(EPOCH FROM s.captured_at)`;
      const externalSortKey = disagreementsOnly
        ? sql`(CASE e.model_disagreement_kind
                 WHEN 'model_low_claude_sunset' THEN 100
                 WHEN 'model_high_claude_not_sunset' THEN 100
                 WHEN 'binary_negative_regression_high' THEN 50
                 WHEN 'binary_positive_regression_low' THEN 50
                 ELSE 0 END
               + ABS(COALESCE(e.ai_regression_score, 0) - COALESCE(e.llm_quality, 0)))`
        : sql`EXTRACT(EPOCH FROM e.scraped_at)`;

      const webcamFilter = disagreementsOnly
        ? sql`AND s.model_disagreement_kind IS NOT NULL
              AND s.id NOT IN (SELECT image_id FROM manual_labels WHERE source = 'webcam')`
        : sql`AND s.id NOT IN (SELECT image_id FROM manual_labels WHERE source = 'webcam')`;
      const externalFilter = disagreementsOnly
        ? sql`AND e.model_disagreement_kind IS NOT NULL
              AND e.id NOT IN (SELECT image_id FROM manual_labels WHERE source = 'flickr')`
        : sql`AND e.id NOT IN (SELECT image_id FROM manual_labels WHERE source = 'flickr')`;

      const webcamRows = sourceFilter === 'flickr' ? [] : (await sql`
          SELECT
            s.id as snapshot_id, s.webcam_id, s.phase, s.rank,
            s.initial_rating, s.calculated_rating, s.ai_rating,
            s.firebase_url, s.firebase_path, s.captured_at, s.created_at,
            0::int as rating_count, NULL::numeric as user_rating,
            w.id as w_id, w.source, w.external_id, w.title, w.status,
            w.view_count, w.lat, w.lng, w.city, w.region, w.country, w.continent,
            w.images, w.urls, w.player, w.categories, w.last_fetched_at,
            w.rating as webcam_rating, w.orientation,
            w.ai_rating as webcam_ai_rating,
            w.ai_model_version as webcam_ai_model_version,
            w.ai_rating_binary as webcam_ai_rating_binary,
            w.ai_model_version_binary as webcam_ai_model_version_binary,
            w.ai_rating_regression as webcam_ai_rating_regression,
            w.ai_model_version_regression as webcam_ai_model_version_regression,
            s.model_disagreement_kind, s.human_sunset_majority,
            s.llm_quality, s.llm_is_sunset, s.llm_model, NULL::text as owner,
            ${webcamSortKey} as sort_key
          FROM webcam_snapshots s
          JOIN webcams w ON w.id = s.webcam_id
          WHERE 1=1 ${webcamFilter}
          ORDER BY sort_key DESC
          LIMIT ${fetchN}
        `) as (SnapshotRow & { sort_key: number | string })[];

      const externalRows = sourceFilter === 'webcam' ? [] : (await sql`
          SELECT
            e.id as snapshot_id,
            e.image_url as firebase_url, e.firebase_path,
            e.scraped_at as captured_at, e.scraped_at as created_at,
            0::int as rating_count,
            e.source, e.source_id as external_id, e.title, e.owner,
            e.model_disagreement_kind,
            e.llm_quality, e.llm_is_sunset, e.llm_model,
            ${externalSortKey} as sort_key
          FROM external_images e
          WHERE e.source = 'flickr' ${externalFilter}
          ORDER BY sort_key DESC
          LIMIT ${fetchN}
        `) as (SnapshotRow & { sort_key: number | string })[];

      const merged = [...webcamRows, ...externalRows]
        .sort((a, b) => Number(b.sort_key) - Number(a.sort_key))
        .slice(offset, offset + limit)
        .map((row) => ({ ...transformSnapshot(row), provenance: deriveProvenance(row.source ?? 'webcam', row.captured_at ?? null) }));

      const webcamCountResult = sourceFilter === 'flickr'
        ? [{ total: 0 }]
        : await sql`
          SELECT COUNT(*)::int AS total FROM webcam_snapshots s WHERE 1=1 ${webcamFilter}
        `;
      const externalCountResult = sourceFilter === 'webcam'
        ? [{ total: 0 }]
        : await sql`
          SELECT COUNT(*)::int AS total FROM external_images e
          WHERE e.source = 'flickr' ${externalFilter}
        `;
      const total =
        ((webcamCountResult as Array<{ total: number }>)[0]?.total ?? 0) +
        ((externalCountResult as Array<{ total: number }>)[0]?.total ?? 0);

      return NextResponse.json({
        snapshots: merged,
        total,
        limit,
        offset,
      });
    }

    // CURATED MIX MODE: Fetch mix of highly rated, unrated recent, and random snapshots
    if (mode === 'curated') {
      // Fall back to archive mode if no user session
      if (!userSessionId) {
        console.warn(
          'Curated mode requested but no user_session_id provided, falling back to archive mode'
        );
        // Will fall through to archive mode below
      } else {
        try {
          // Helper function to shuffle array
          const shuffleArray = <T>(array: T[]): T[] => {
            const shuffled = [...array];
            for (let i = shuffled.length - 1; i > 0; i--) {
              const j = Math.floor(Math.random() * (i + 1));
              [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
            }
            return shuffled;
          };

          // Query 1: Highly rated snapshots (40% - 400 snapshots)
          const highlyRated = await sql`
          SELECT 
            s.id as snapshot_id,
            s.webcam_id,
            s.phase,
            s.rank,
            s.initial_rating,
            s.calculated_rating,
            s.ai_rating,
            s.firebase_url,
            s.firebase_path,
            s.captured_at,
            s.created_at,
            COUNT(DISTINCT r.id)::int as rating_count,
            ur.rating as user_rating,
            w.id as w_id,
            w.source,
            w.external_id,
            w.title,
            w.status,
            w.view_count,
            w.lat,
            w.lng,
            w.city,
            w.region,
            w.country,
            w.continent,
            w.images,
            w.urls,
            w.player,
            w.categories,
            w.last_fetched_at,
            w.rating as webcam_rating,
            w.orientation,
            w.ai_rating as webcam_ai_rating,
            w.ai_model_version as webcam_ai_model_version,
            w.ai_rating_binary as webcam_ai_rating_binary,
            w.ai_model_version_binary as webcam_ai_model_version_binary,
            w.ai_rating_regression as webcam_ai_rating_regression,
            w.ai_model_version_regression as webcam_ai_model_version_regression
          FROM webcam_snapshots s
          JOIN webcams w ON w.id = s.webcam_id
          LEFT JOIN webcam_snapshot_ratings r ON r.snapshot_id = s.id
          LEFT JOIN webcam_snapshot_ratings ur ON ur.snapshot_id = s.id 
            AND ur.user_session_id = ${userSessionId}
          WHERE ${sql.unsafe(
            whereClause
          )} AND s.calculated_rating >= 4.5
          GROUP BY s.id, w.id, ur.rating
          ORDER BY s.calculated_rating DESC, s.captured_at DESC
          LIMIT 400
        `;

          // Query 2: Unrated recent snapshots (40% - 400 snapshots)
          const unratedRecent = await sql`
          SELECT 
            s.id as snapshot_id,
            s.webcam_id,
            s.phase,
            s.rank,
            s.initial_rating,
            s.calculated_rating,
            s.ai_rating,
            s.firebase_url,
            s.firebase_path,
            s.captured_at,
            s.created_at,
            COUNT(DISTINCT r.id)::int as rating_count,
            ur.rating as user_rating,
            w.id as w_id,
            w.source,
            w.external_id,
            w.title,
            w.status,
            w.view_count,
            w.lat,
            w.lng,
            w.city,
            w.region,
            w.country,
            w.continent,
            w.images,
            w.urls,
            w.player,
            w.categories,
            w.last_fetched_at,
            w.rating as webcam_rating,
            w.orientation,
            w.ai_rating as webcam_ai_rating,
            w.ai_model_version as webcam_ai_model_version,
            w.ai_rating_binary as webcam_ai_rating_binary,
            w.ai_model_version_binary as webcam_ai_model_version_binary,
            w.ai_rating_regression as webcam_ai_rating_regression,
            w.ai_model_version_regression as webcam_ai_model_version_regression
          FROM webcam_snapshots s
          JOIN webcams w ON w.id = s.webcam_id
          LEFT JOIN webcam_snapshot_ratings r ON r.snapshot_id = s.id
          LEFT JOIN webcam_snapshot_ratings ur ON ur.snapshot_id = s.id 
            AND ur.user_session_id = ${userSessionId}
          WHERE ${sql.unsafe(whereClause)} AND ur.rating IS NULL
          GROUP BY s.id, w.id, ur.rating
          ORDER BY s.captured_at DESC
          LIMIT 400
        `;

          // Query 3: Random snapshots (20% - 200 snapshots)
          const randomSnapshots = await sql`
          SELECT 
            s.id as snapshot_id,
            s.webcam_id,
            s.phase,
            s.rank,
            s.initial_rating,
            s.calculated_rating,
            s.ai_rating,
            s.firebase_url,
            s.firebase_path,
            s.captured_at,
            s.created_at,
            COUNT(DISTINCT r.id)::int as rating_count,
            ur.rating as user_rating,
            w.id as w_id,
            w.source,
            w.external_id,
            w.title,
            w.status,
            w.view_count,
            w.lat,
            w.lng,
            w.city,
            w.region,
            w.country,
            w.continent,
            w.images,
            w.urls,
            w.player,
            w.categories,
            w.last_fetched_at,
            w.rating as webcam_rating,
            w.orientation,
            w.ai_rating as webcam_ai_rating,
            w.ai_model_version as webcam_ai_model_version,
            w.ai_rating_binary as webcam_ai_rating_binary,
            w.ai_model_version_binary as webcam_ai_model_version_binary,
            w.ai_rating_regression as webcam_ai_rating_regression,
            w.ai_model_version_regression as webcam_ai_model_version_regression
          FROM webcam_snapshots s
          JOIN webcams w ON w.id = s.webcam_id
          LEFT JOIN webcam_snapshot_ratings r ON r.snapshot_id = s.id
          LEFT JOIN webcam_snapshot_ratings ur ON ur.snapshot_id = s.id 
            AND ur.user_session_id = ${userSessionId}
          WHERE ${sql.unsafe(whereClause)}
          GROUP BY s.id, w.id, ur.rating
          ORDER BY RANDOM()
          LIMIT 200
        `;

          // Combine all three result sets
          const combinedSnapshots = [
            ...(highlyRated as SnapshotRow[]),
            ...(unratedRecent as SnapshotRow[]),
            ...(randomSnapshots as SnapshotRow[]),
          ];

          // Shuffle the combined array for variety
          const shuffledSnapshots = shuffleArray(combinedSnapshots);

          // Transform to Snapshot type and limit
          const snapshots: Snapshot[] = shuffledSnapshots
            .slice(0, limit)
            .map((row) => transformSnapshot(row));

          // Return IDs for client de-duplication
          const returnedIds = snapshots.map((s) => s.snapshot.id);

          // Get total count for pagination
          const countResult = await sql`
          SELECT COUNT(*)::int as total
          FROM webcam_snapshots s
          WHERE ${sql.unsafe(whereClause)}
        `;

          const total = countResult[0]?.total || 0;

          return NextResponse.json({
            snapshots,
            returnedIds,
            total,
            limit,
            offset,
          });
        } catch (error) {
          console.error('Error in curated mix query:', error);
          throw error;
        }
      }
    }

    // DEFAULT QUERY MODE (archive): Standard snapshot query
    const rows = await sql`
      SELECT 
        s.id as snapshot_id,
        s.webcam_id,
        s.phase,
        s.rank,
        s.initial_rating,
        s.calculated_rating,
        s.ai_rating,
        s.firebase_url,
        s.firebase_path,
        s.captured_at,
        s.created_at,
        COUNT(DISTINCT r.id)::int as rating_count,
        ur.rating as user_rating,
        w.id as w_id,
        w.source,
        w.external_id,
        w.title,
        w.status,
        w.view_count,
        w.lat,
        w.lng,
        w.city,
        w.region,
        w.country,
        w.continent,
        w.images,
        w.urls,
        w.player,
        w.categories,
        w.last_fetched_at,
        w.rating as webcam_rating,
        w.orientation,
        w.ai_rating as webcam_ai_rating,
        w.ai_model_version as webcam_ai_model_version,
        w.ai_rating_binary as webcam_ai_rating_binary,
        w.ai_model_version_binary as webcam_ai_model_version_binary,
        w.ai_rating_regression as webcam_ai_rating_regression,
        w.ai_model_version_regression as webcam_ai_model_version_regression
      FROM webcam_snapshots s
      JOIN webcams w ON w.id = s.webcam_id
      LEFT JOIN webcam_snapshot_ratings r ON r.snapshot_id = s.id
      LEFT JOIN webcam_snapshot_ratings ur ON ur.snapshot_id = s.id 
        AND ur.user_session_id = ${userSessionId || ''}
      WHERE ${sql.unsafe(whereClause)}
        ${
          unratedOnly && userSessionId
            ? sql`AND ur.rating IS NULL`
            : sql``
        }
      GROUP BY s.id, w.id, ur.rating
      ORDER BY s.captured_at DESC
      LIMIT ${limit}
      OFFSET ${offset}
    `;

    const snapshots: Snapshot[] = (rows as SnapshotRow[]).map((row) =>
      transformSnapshot(row)
    );

    // Return IDs for client de-duplication (archive mode)
    const returnedIds = snapshots.map((s) => s.snapshot.id);

    // Get total count for pagination
    const countResult = await sql`
      SELECT COUNT(*)::int as total
      FROM webcam_snapshots s
      WHERE ${sql.unsafe(whereClause)}
    `;

    const total = countResult[0]?.total || 0;

    // Get queue progress counts when unrated queue mode is active.
    let unrated = undefined;
    let archiveTotal = undefined;
    let rated = undefined;
    if (unratedOnly) {
      const archiveTotalResult = await sql`
        SELECT COUNT(*)::int as archive_total
        FROM webcam_snapshots
      `;
      archiveTotal = archiveTotalResult[0]?.archive_total || 0;

      // Global ranking coverage: any snapshot with >=1 rating row.
      const ratedResult = await sql`
        SELECT COUNT(DISTINCT snapshot_id)::int as rated_count
        FROM webcam_snapshot_ratings
      `;
      rated = ratedResult[0]?.rated_count || 0;

      // Keep session-specific unrated count for queue sizing/remaining context.
      if (userSessionId) {
        const unratedResult = await sql`
          SELECT COUNT(*)::int as unrated_count
          FROM webcam_snapshots s
          LEFT JOIN webcam_snapshot_ratings ur ON ur.snapshot_id = s.id 
            AND ur.user_session_id = ${userSessionId}
          WHERE ur.rating IS NULL
        `;
        unrated = unratedResult[0]?.unrated_count || 0;
      }
    }

    return NextResponse.json({
      snapshots,
      returnedIds,
      total,
      unrated,
      archiveTotal,
      rated,
      queueRatedScope: SNAPSHOT_QUEUE_PROGRESS_RATED_SCOPE,
      queueUnratedScope: SNAPSHOT_QUEUE_UNRATED_SCOPE,
      limit,
      offset,
    });
  } catch (error) {
    console.error('Error in snapshots route:', error);
    return NextResponse.json(
      {
        error: 'Internal server error',
        details:
          error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
