import { NextResponse } from 'next/server';
import { sql } from '@/app/lib/db';
import { deleteFromFirebase } from '@/app/lib/webcamSnapshot';
import {
  CLEANUP_ENABLED,
  AI_SNAPSHOT_MIN_RATING_THRESHOLD,
} from '@/app/lib/masterConfig';

export const dynamic = 'force-dynamic';
export const maxDuration = 300; // 5 minutes

// ---------------------------------------------------------------------------
// DANGER — Cleanup endpoint state as of 2026-06-02
// ---------------------------------------------------------------------------
// This endpoint is NOT on any cron schedule. It only runs when manually
// invoked. Even then, it respects:
//   1. The CLEANUP_ENABLED flag in app/lib/masterConfig.ts (default false)
//   2. Snapshots with any webcam_snapshot_ratings row (rating OR verdict)
//      survive forever — they're training data
//   3. Snapshots with model_disagreement_kind != NULL survive — they're on
//      the Hard Examples queue waiting for a verdict
//   4. Snapshots with a high ai_rating (>= AI_SNAPSHOT_MIN_RATING_THRESHOLD)
//      survive — they're the best-of frames the leaderboard ranks
//
// Before adding this endpoint to vercel.json's crons or POSTing to it
// manually, re-read the retention rules above. The archive contained
// ~33,000 snapshots when this gate was added; an accidental cleanup run
// would have nuked thousands of star-rated snapshots.
// ---------------------------------------------------------------------------

export async function GET(request: Request) {
  return cleanup(request);
}

export async function POST(request: Request) {
  return cleanup(request);
}

async function cleanup(request: Request) {
  try {
    const authHeader = request.headers.get('authorization');
    const isAuthorized =
      authHeader === `Bearer ${process.env.CRON_SECRET}` ||
      process.env.NODE_ENV === 'development';

    if (!isAuthorized && process.env.NODE_ENV !== 'development') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!CLEANUP_ENABLED) {
      return NextResponse.json({
        ok: true,
        deleted: 0,
        skipped_reason:
          'CLEANUP_ENABLED is false in app/lib/masterConfig.ts. ' +
          'Flip to true if you intentionally want to prune. See the comment ' +
          'block at the top of this route for retention rules.',
      });
    }

    console.log('Starting snapshot cleanup...');

    // Four classes of snapshots are NEVER cleaned up — we only drop a frame
    // older than 7 days that has none of these signals:
    //   1. model_disagreement_kind set (queued for Hard Examples triage).
    //   2. Any user ever rated or verdicted it (training data).
    //   3. A high AI score (ai_rating >= AI_SNAPSHOT_MIN_RATING_THRESHOLD) —
    //      the best-of frames the Best Sunsets leaderboard ranks. NULL ai_rating
    //      counts as "not high" and is eligible for deletion.
    const oldSnapshots = await sql`
      SELECT id, firebase_path, captured_at
      FROM webcam_snapshots
      WHERE captured_at < NOW() - INTERVAL '7 days'
        AND model_disagreement_kind IS NULL
        AND (ai_rating IS NULL OR ai_rating < ${AI_SNAPSHOT_MIN_RATING_THRESHOLD})
        AND id NOT IN (
          SELECT DISTINCT snapshot_id FROM webcam_snapshot_ratings
          WHERE rating IS NOT NULL OR is_sunset_verdict IS NOT NULL
        )
      ORDER BY captured_at ASC
    `;

    console.log(`Found ${oldSnapshots.length} snapshots to clean up`);

    const results = {
      ok: true,
      deleted: 0,
      failed: 0,
      errors: [] as string[],
    };

    for (const snapshot of oldSnapshots) {
      try {
        await deleteFromFirebase(snapshot.firebase_path as string);
        await sql`
          DELETE FROM webcam_snapshots
          WHERE id = ${snapshot.id as number}
        `;
        results.deleted++;
      } catch (error) {
        console.error(
          `Failed to delete snapshot ${snapshot.id}:`,
          error,
        );
        results.failed++;
        results.errors.push(
          `Snapshot ${snapshot.id}: ${
            error instanceof Error ? error.message : 'Unknown error'
          }`,
        );
      }
    }

    console.log(
      `Cleanup complete. Deleted: ${results.deleted}, Failed: ${results.failed}`,
    );

    return NextResponse.json(results);
  } catch (error) {
    console.error('Error in cleanup route:', error);
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
