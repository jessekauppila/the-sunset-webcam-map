//database update tools

import { NextResponse } from 'next/server';
import { sql } from '@/app/lib/db';
import { requireOwner } from '@/app/lib/owner';

export const dynamic = 'force-dynamic';

interface RateRequest {
  userSessionId: string;
  rating?: number;
  isSunsetVerdict?: boolean;
}

interface DeleteRequest {
  userSessionId: string;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await requireOwner();
  if (denied) return denied;
  try {
    const { id } = await params;
    const snapshotId = parseInt(id, 10);

    if (isNaN(snapshotId)) {
      return NextResponse.json(
        { error: 'Invalid snapshot ID' },
        { status: 400 },
      );
    }

    const body = (await request.json()) as RateRequest;
    const { userSessionId, rating, isSunsetVerdict } = body;

    if (!userSessionId || typeof userSessionId !== 'string') {
      return NextResponse.json(
        { error: 'User session ID required' },
        { status: 400 },
      );
    }

    const hasRating = rating !== undefined && rating !== null;
    const hasVerdict = typeof isSunsetVerdict === 'boolean';

    if (!hasRating && !hasVerdict) {
      return NextResponse.json(
        { error: 'rating or isSunsetVerdict required — provide at least one' },
        { status: 400 },
      );
    }

    if (hasRating) {
      if (
        typeof rating !== 'number' ||
        rating < 1 ||
        rating > 5 ||
        !Number.isInteger(rating)
      ) {
        return NextResponse.json(
          { error: 'Rating must be an integer between 1 and 5' },
          { status: 400 },
        );
      }
      if (hasVerdict && isSunsetVerdict === false) {
        return NextResponse.json(
          { error: "Can't rate non-sunsets — drop the rating or set isSunsetVerdict=true" },
          { status: 400 },
        );
      }
    }

    // Check snapshot exists
    const snapshotCheck = await sql`
      SELECT id FROM webcam_snapshots WHERE id = ${snapshotId}
    `;
    if (snapshotCheck.length === 0) {
      return NextResponse.json(
        { error: 'Snapshot not found' },
        { status: 404 },
      );
    }

    // Upsert. Both columns nullable, both included so unset values clear
    // any prior write from the same user. The COALESCE pattern would
    // preserve old values; we deliberately do NOT use it.
    await sql`
      INSERT INTO webcam_snapshot_ratings (
        snapshot_id, user_session_id, rating, is_sunset_verdict
      )
      VALUES (
        ${snapshotId},
        ${userSessionId},
        ${hasRating ? rating : null},
        ${hasVerdict ? isSunsetVerdict : null}
      )
      ON CONFLICT (snapshot_id, user_session_id)
      DO UPDATE SET
        rating = EXCLUDED.rating,
        is_sunset_verdict = EXCLUDED.is_sunset_verdict,
        created_at = NOW()
    `;

    // Recompute calculated_rating (existing behavior).
    const avgResult = await sql`
      SELECT AVG(rating)::DECIMAL(3,2) as avg_rating
      FROM webcam_snapshot_ratings
      WHERE snapshot_id = ${snapshotId}
    `;
    const avgRating = avgResult[0]?.avg_rating ?? null;

    await sql`
      UPDATE webcam_snapshots
      SET calculated_rating = ${avgRating}
      WHERE id = ${snapshotId}
    `;

    // Recompute human_sunset_majority (NEW). Majority vote across all
    // users who gave a verdict for this snapshot. Tie → false (treat
    // unclear as not-a-sunset).
    const majorityResult = await sql`
      SELECT
        CASE
          WHEN COUNT(*) FILTER (WHERE is_sunset_verdict = TRUE)
                 > COUNT(*) FILTER (WHERE is_sunset_verdict = FALSE)
          THEN TRUE
          WHEN COUNT(*) FILTER (WHERE is_sunset_verdict = FALSE) > 0
          THEN FALSE
          ELSE NULL
        END AS majority
      FROM webcam_snapshot_ratings
      WHERE snapshot_id = ${snapshotId}
        AND is_sunset_verdict IS NOT NULL
    `;
    const majority = majorityResult[0]?.majority ?? null;

    await sql`
      UPDATE webcam_snapshots
      SET human_sunset_majority = ${majority}
      WHERE id = ${snapshotId}
    `;

    const countResult = await sql`
      SELECT COUNT(*)::int as rating_count
      FROM webcam_snapshot_ratings
      WHERE snapshot_id = ${snapshotId}
    `;
    const ratingCount = countResult[0]?.rating_count ?? 0;

    return NextResponse.json({
      success: true,
      snapshotId,
      calculatedRating: avgRating,
      humanSunsetMajority: majority,
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
      { status: 500 },
    );
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await requireOwner();
  if (denied) return denied;
  try {
    const { id } = await params;
    const snapshotId = parseInt(id, 10);

    if (isNaN(snapshotId)) {
      return NextResponse.json(
        { error: 'Invalid snapshot ID' },
        { status: 400 },
      );
    }

    const body = (await request.json()) as DeleteRequest;
    const { userSessionId } = body;

    if (!userSessionId || typeof userSessionId !== 'string') {
      return NextResponse.json(
        { error: 'User session ID required' },
        { status: 400 },
      );
    }

    await sql`
      DELETE FROM webcam_snapshot_ratings
      WHERE snapshot_id = ${snapshotId} AND user_session_id = ${userSessionId}
    `;

    // After delete, recompute both denormalized columns so they don't
    // hold stale values from the now-deleted vote.
    const avgResult = await sql`
      SELECT AVG(rating)::DECIMAL(3,2) as avg_rating
      FROM webcam_snapshot_ratings
      WHERE snapshot_id = ${snapshotId}
    `;
    const avgRating = avgResult[0]?.avg_rating ?? null;
    await sql`
      UPDATE webcam_snapshots
      SET calculated_rating = ${avgRating}
      WHERE id = ${snapshotId}
    `;

    const majorityResult = await sql`
      SELECT
        CASE
          WHEN COUNT(*) FILTER (WHERE is_sunset_verdict = TRUE)
                 > COUNT(*) FILTER (WHERE is_sunset_verdict = FALSE)
          THEN TRUE
          WHEN COUNT(*) FILTER (WHERE is_sunset_verdict = FALSE) > 0
          THEN FALSE
          ELSE NULL
        END AS majority
      FROM webcam_snapshot_ratings
      WHERE snapshot_id = ${snapshotId}
        AND is_sunset_verdict IS NOT NULL
    `;
    const majority = majorityResult[0]?.majority ?? null;
    await sql`
      UPDATE webcam_snapshots
      SET human_sunset_majority = ${majority}
      WHERE id = ${snapshotId}
    `;

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error in rate delete route:', error);
    return NextResponse.json(
      {
        error: 'Internal server error',
        details:
          error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 },
    );
  }
}
