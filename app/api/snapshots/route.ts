//what is this for?
//
//
import { NextResponse } from 'next/server';
import { sql } from '@/app/lib/db';

export const dynamic = 'force-dynamic';

interface Snapshot {
  id: number;
  webcamId: number;
  phase: string;
  rank: number | null;
  initialRating: number | null;
  calculatedRating: number | null;
  aiRating: number | null;
  firebaseUrl: string;
  firebasePath: string;
  capturedAt: string;
  createdAt: string;
  ratingCount: number;
}

interface SnapshotRow {
  id: number;
  webcam_id: number;
  phase: string;
  rank: number | null;
  initial_rating: number | null;
  calculated_rating: number | null;
  ai_rating: number | null;
  firebase_url: string;
  firebase_path: string;
  captured_at: string;
  created_at: string;
  rating_count: number;
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);

    // Parse query parameters
    const webcamId = searchParams.get('webcam_id');
    const phase = searchParams.get('phase');
    const minRating = searchParams.get('min_rating');
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

    const whereClause = conditions.join(' AND ');

    // Query snapshots with rating counts
    const rows = await sql`
      SELECT 
        s.id,
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
        COUNT(r.id)::int as rating_count
      FROM webcam_snapshots s
      LEFT JOIN webcam_snapshot_ratings r ON r.snapshot_id = s.id
      WHERE ${sql.unsafe(whereClause)}
      GROUP BY s.id
      ORDER BY s.captured_at DESC
      LIMIT ${limit}
      OFFSET ${offset}
    `;

    const snapshots: Snapshot[] = (rows as SnapshotRow[]).map(
      (row) => ({
        id: row.id,
        webcamId: row.webcam_id,
        phase: row.phase,
        rank: row.rank,
        initialRating: row.initial_rating,
        calculatedRating: row.calculated_rating,
        aiRating: row.ai_rating,
        firebaseUrl: row.firebase_url,
        firebasePath: row.firebase_path,
        capturedAt: row.captured_at,
        createdAt: row.created_at,
        ratingCount: row.rating_count,
      })
    );

    // Get total count for pagination
    const countResult = await sql`
      SELECT COUNT(*)::int as total
      FROM webcam_snapshots s
      WHERE ${sql.unsafe(whereClause)}
    `;

    const total = countResult[0]?.total || 0;

    return NextResponse.json({
      snapshots,
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
