//what is this for?
//
//
import { NextResponse } from 'next/server';
import { sql } from '@/app/lib/db';
import {
  transformSnapshot,
  type SnapshotRow,
} from '@/app/lib/snapshotTransform';
import type { Snapshot } from '@/app/lib/types';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);

    // Parse query parameters
    const webcamId = searchParams.get('webcam_id');
    const phase = searchParams.get('phase');
    const minRating = searchParams.get('min_rating');
    const userSessionId = searchParams.get('user_session_id');
    const limit = parseInt(searchParams.get('limit') || '100', 10);
    const offset = parseInt(searchParams.get('offset') || '0', 10);
    const mode =
      searchParams.get('mode') === 'curated' ? 'curated' : 'archive';
    const excludeIdsParam = searchParams.get('exclude_ids');
    const excludeIds = excludeIdsParam
      ? excludeIdsParam
          .split(',')
          .map((s) => parseInt(s.trim(), 10))
          .filter((n) => Number.isFinite(n) && n > 0)
      : [];

    // Build the WHERE clause dynamically
    const conditions: string[] = ['1=1'];
    const params: (string | number)[] = [];

    if (webcamId) {
      conditions.push(`s.webcam_id = $${params.length + 1}`);
      params.push(parseInt(webcamId, 10));
    }

    if (phase && (phase === 'sunrise' || phase === 'sunset')) {
      conditions.push(`s.phase = $${params.length + 1}`);
      params.push(phase);
    }

    if (minRating) {
      conditions.push(`s.calculated_rating >= $${params.length + 1}`);
      params.push(parseFloat(minRating));
    }

    // Add exclude_ids filter if provided
    if (excludeIds.length > 0) {
      const placeholders = excludeIds
        .map((_, i) => `$${params.length + i + 1}`)
        .join(', ');
      conditions.push(`s.id NOT IN (${placeholders})`);
      params.push(...excludeIds);
    }

    const whereClause = conditions.join(' AND ');

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
            w.orientation
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
            w.orientation
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
            w.orientation
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
        w.orientation
      FROM webcam_snapshots s
      JOIN webcams w ON w.id = s.webcam_id
      LEFT JOIN webcam_snapshot_ratings r ON r.snapshot_id = s.id
      LEFT JOIN webcam_snapshot_ratings ur ON ur.snapshot_id = s.id 
        AND ur.user_session_id = ${userSessionId || ''}
      WHERE ${sql.unsafe(whereClause)}
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

    return NextResponse.json({
      snapshots,
      returnedIds,
      total,
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
