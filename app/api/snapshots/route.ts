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
    const unratedOnly = searchParams.get('unrated_only') === 'true';
    const userSessionId = searchParams.get('user_session_id');
    const limit = parseInt(searchParams.get('limit') || '100', 10);
    const offset = parseInt(searchParams.get('offset') || '0', 10);

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

    // Note: unrated filter is now applied directly in the SQL query

    const whereClause = conditions.join(' AND ');

    // Query snapshots with webcam data, rating counts, and user's rating
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

    // Get total count for pagination
    const countResult = await sql`
      SELECT COUNT(*)::int as total
      FROM webcam_snapshots s
      WHERE ${sql.unsafe(whereClause)}
    `;

    const total = countResult[0]?.total || 0;

    // Get unrated count if unratedOnly filter is active
    let unrated = undefined;
    if (unratedOnly && userSessionId) {
      const unratedResult = await sql`
        SELECT COUNT(*)::int as unrated_count
        FROM webcam_snapshots s
        LEFT JOIN webcam_snapshot_ratings ur ON ur.snapshot_id = s.id 
          AND ur.user_session_id = ${userSessionId}
        WHERE ur.rating IS NULL
      `;
      unrated = unratedResult[0]?.unrated_count || 0;
    }

    return NextResponse.json({
      snapshots,
      total,
      unrated,
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
