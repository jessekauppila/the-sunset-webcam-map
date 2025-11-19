//database update tools

import { NextResponse } from 'next/server';
import { sql } from '@/app/lib/db';

export const dynamic = 'force-dynamic';

interface RateRequest {
  userSessionId: string;
  rating: number;
}

interface DeleteRequest {
  userSessionId: string;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const snapshotId = parseInt(id, 10);

    if (isNaN(snapshotId)) {
      return NextResponse.json(
        { error: 'Invalid snapshot ID' },
        { status: 400 }
      );
    }

    const body = (await request.json()) as RateRequest;
    const { userSessionId, rating } = body;

    // Validate inputs
    if (!userSessionId || typeof userSessionId !== 'string') {
      return NextResponse.json(
        { error: 'User session ID required' },
        { status: 400 }
      );
    }

    if (
      typeof rating !== 'number' ||
      rating < 1 ||
      rating > 5 ||
      !Number.isInteger(rating)
    ) {
      return NextResponse.json(
        { error: 'Rating must be an integer between 1 and 5' },
        { status: 400 }
      );
    }

    // Check if snapshot exists
    const snapshotCheck = await sql`
      SELECT id FROM webcam_snapshots WHERE id = ${snapshotId}
    `;

    if (snapshotCheck.length === 0) {
      return NextResponse.json(
        { error: 'Snapshot not found' },
        { status: 404 }
      );
    }

    // Upsert the rating (one rating per user per snapshot)
    await sql`
      INSERT INTO webcam_snapshot_ratings (snapshot_id, user_session_id, rating)
      VALUES (${snapshotId}, ${userSessionId}, ${rating})
      ON CONFLICT (snapshot_id, user_session_id)
      DO UPDATE SET rating = ${rating}, created_at = NOW()
    `;

    // Recalculate the average rating for this snapshot
    const avgResult = await sql`
      SELECT AVG(rating)::DECIMAL(3,2) as avg_rating
      FROM webcam_snapshot_ratings
      WHERE snapshot_id = ${snapshotId}
    `;

    const avgRating = avgResult[0]?.avg_rating || null;

    // Update the calculated_rating in webcam_snapshots
    await sql`
      UPDATE webcam_snapshots
      SET calculated_rating = ${avgRating}
      WHERE id = ${snapshotId}
    `;

    // Get rating count
    const countResult = await sql`
      SELECT COUNT(*)::int as rating_count
      FROM webcam_snapshot_ratings
      WHERE snapshot_id = ${snapshotId}
    `;

    const ratingCount = countResult[0]?.rating_count || 0;

    return NextResponse.json({
      success: true,
      snapshotId,
      calculatedRating: avgRating,
      ratingCount,
    });
  } catch (error) {
    console.error('Error in rate route:', error);
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

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const snapshotId = parseInt(id, 10);

    if (isNaN(snapshotId)) {
      return NextResponse.json(
        { error: 'Invalid snapshot ID' },
        { status: 400 }
      );
    }

    const body = (await request.json()) as DeleteRequest;
    const { userSessionId } = body;

    // Validate userSessionId
    if (!userSessionId || typeof userSessionId !== 'string') {
      return NextResponse.json(
        { error: 'User session ID required' },
        { status: 400 }
      );
    }

    // Delete the rating
    await sql`
      DELETE FROM webcam_snapshot_ratings
      WHERE snapshot_id = ${snapshotId} 
        AND user_session_id = ${userSessionId}
    `;

    // Recalculate average rating
    const avgResult = await sql`
      SELECT AVG(rating)::DECIMAL(3,2) as avg_rating
      FROM webcam_snapshot_ratings
      WHERE snapshot_id = ${snapshotId}
    `;

    const avgRating = avgResult[0]?.avg_rating || null;

    // Update the calculated_rating in webcam_snapshots
    await sql`
      UPDATE webcam_snapshots
      SET calculated_rating = ${avgRating}
      WHERE id = ${snapshotId}
    `;

    // Get rating count
    const countResult = await sql`
      SELECT COUNT(*)::int as rating_count
      FROM webcam_snapshot_ratings
      WHERE snapshot_id = ${snapshotId}
    `;

    const ratingCount = countResult[0]?.rating_count || 0;

    return NextResponse.json({
      success: true,
      calculatedRating: avgRating,
      ratingCount,
    });
  } catch (error) {
    console.error('Error in DELETE rating route:', error);
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
