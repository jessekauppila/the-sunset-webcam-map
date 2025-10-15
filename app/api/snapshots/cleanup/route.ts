import { NextResponse } from 'next/server';
import { sql } from '@/app/lib/db';
import { deleteFromFirebase } from '@/app/lib/webcamSnapshot';

export const dynamic = 'force-dynamic';
export const maxDuration = 300; // Allow up to 5 minutes for cleanup

export async function GET(request: Request) {
  return cleanup(request);
}

export async function POST(request: Request) {
  return cleanup(request);
}

async function cleanup(request: Request) {
  try {
    // Check for authorization header for cron jobs
    const authHeader = request.headers.get('authorization');
    const isAuthorized =
      authHeader === `Bearer ${process.env.CRON_SECRET}` ||
      process.env.NODE_ENV === 'development';

    if (!isAuthorized && process.env.NODE_ENV !== 'development') {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    console.log('Starting snapshot cleanup...');

    // Find snapshots older than 7 days
    const oldSnapshots = await sql`
      SELECT id, firebase_path, captured_at
      FROM webcam_snapshots
      WHERE captured_at < NOW() - INTERVAL '7 days'
      ORDER BY captured_at ASC
    `;

    console.log(`Found ${oldSnapshots.length} snapshots to clean up`);

    const results = {
      deleted: 0,
      failed: 0,
      errors: [] as string[],
    };

    // Delete each snapshot
    for (const snapshot of oldSnapshots) {
      try {
        // Delete from Firebase Storage
        await deleteFromFirebase(snapshot.firebase_path as string);

        // Delete from database (cascade will delete related ratings)
        await sql`
          DELETE FROM webcam_snapshots
          WHERE id = ${snapshot.id as number}
        `;

        results.deleted++;
      } catch (error) {
        console.error(
          `Failed to delete snapshot ${snapshot.id}:`,
          error
        );
        results.failed++;
        results.errors.push(
          `Snapshot ${snapshot.id}: ${
            error instanceof Error ? error.message : 'Unknown error'
          }`
        );
      }
    }

    console.log(
      `Cleanup complete. Deleted: ${results.deleted}, Failed: ${results.failed}`
    );

    return NextResponse.json({
      success: true,
      ...results,
      message: `Cleaned up ${results.deleted} old snapshots`,
    });
  } catch (error) {
    console.error('Error in cleanup route:', error);
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
