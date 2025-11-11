import { NextResponse } from 'next/server';
import { sql } from '@/app/lib/db';
import { captureWebcamSnapshot } from '@/app/lib/webcamSnapshot';
import type { WindyWebcam } from '@/app/lib/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

type CaptureAndRatePayload = {
  webcamId: number;
  phase: 'sunrise' | 'sunset';
  rating: number;
  userSessionId: string;
};

type SnapshotRow = {
  id: number;
  firebase_url: string;
  firebase_path: string;
  captured_at: string;
};

function parseJSONField<T>(value: unknown): T | null {
  if (!value) return null;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as T;
    } catch (error) {
      console.warn('Failed to parse JSON field', error);
      return null;
    }
  }
  return value as T;
}

function mapDatabaseRowToWebcam(row: Record<string, unknown>): WindyWebcam {
  return {
    webcamId: Number(row.id),
    title: (row.title as string) || 'Unknown',
    viewCount: Number(row.view_count) || 0,
    status: (row.status as string) || 'unknown',
    images: parseJSONField(row.images) || undefined,
    location: {
      city: (row.city as string) || '',
      region: (row.region as string) || '',
      longitude: Number(row.lng),
      latitude: Number(row.lat),
      country: (row.country as string) || '',
      continent: (row.continent as string) || '',
    },
    categories: parseJSONField(row.categories) || [],
    lastUpdatedOn: row.last_fetched_at as string | undefined,
    player: parseJSONField(row.player) || undefined,
    urls: parseJSONField(row.urls) || undefined,
    phase: (row.phase as 'sunrise' | 'sunset' | null) || undefined,
    rank: row.rank != null ? Number(row.rank) : undefined,
    source: row.source as string | undefined,
    externalId: row.external_id as string | undefined,
    createdAt: row.created_at as string | undefined,
    updatedAt: row.updated_at as string | undefined,
    rating: row.rating != null ? Number(row.rating) : undefined,
    orientation: row.orientation as never,
  };
}

async function findOrCreateSnapshot(
  payload: CaptureAndRatePayload,
  webcam: WindyWebcam
): Promise<{ snapshot: SnapshotRow; alreadyExisted: boolean }> {
  const [existing] = await sql<SnapshotRow[]>`
    SELECT id, firebase_url, firebase_path, captured_at
    FROM webcam_snapshots
    WHERE webcam_id = ${payload.webcamId}
      AND phase = ${payload.phase}
    ORDER BY captured_at DESC
    LIMIT 1
  `;

  if (existing) {
    return { snapshot: existing, alreadyExisted: true };
  }

  const captured = await captureWebcamSnapshot(webcam);

  if (!captured) {
    throw new Error('Unable to capture webcam image');
  }

  const [inserted] = await sql<SnapshotRow[]>`
    INSERT INTO webcam_snapshots (
      webcam_id,
      phase,
      rank,
      initial_rating,
      firebase_url,
      firebase_path,
      captured_at
    )
    VALUES (
      ${payload.webcamId},
      ${payload.phase},
      ${webcam.rank ?? null},
      ${payload.rating},
      ${captured.url},
      ${captured.path},
      NOW()
    )
    RETURNING id, firebase_url, firebase_path, captured_at
  `;

  return {
    snapshot: inserted,
    alreadyExisted: false,
  };
}

async function upsertRating(
  snapshotId: number,
  payload: CaptureAndRatePayload
) {
  await sql`
    INSERT INTO webcam_snapshot_ratings (
      snapshot_id,
      user_session_id,
      rating
    )
    VALUES (${snapshotId}, ${payload.userSessionId}, ${payload.rating})
    ON CONFLICT (snapshot_id, user_session_id)
    DO UPDATE SET rating = ${payload.rating}, created_at = NOW()
  `;

  const [avgResult] = await sql<{ avg_rating: number | null }[]>`
    SELECT AVG(rating)::DECIMAL(3,2) AS avg_rating
    FROM webcam_snapshot_ratings
    WHERE snapshot_id = ${snapshotId}
  `;

  const [countResult] = await sql<{ rating_count: number }[]>`
    SELECT COUNT(*)::int AS rating_count
    FROM webcam_snapshot_ratings
    WHERE snapshot_id = ${snapshotId}
  `;

  await sql`
    UPDATE webcam_snapshots
    SET calculated_rating = ${avgResult?.avg_rating ?? null}
    WHERE id = ${snapshotId}
  `;

  return {
    calculatedRating: avgResult?.avg_rating ?? null,
    ratingCount: countResult?.rating_count ?? 0,
  };
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as CaptureAndRatePayload;

    if (
      !body ||
      typeof body.webcamId !== 'number' ||
      body.webcamId <= 0 ||
      body.webcamId % 1 !== 0
    ) {
      return NextResponse.json(
        { error: 'webcamId must be a positive integer' },
        { status: 400 }
      );
    }

    if (body.phase !== 'sunrise' && body.phase !== 'sunset') {
      return NextResponse.json(
        { error: 'phase must be either sunrise or sunset' },
        { status: 400 }
      );
    }

    if (
      typeof body.rating !== 'number' ||
      !Number.isInteger(body.rating) ||
      body.rating < 1 ||
      body.rating > 5
    ) {
      return NextResponse.json(
        { error: 'rating must be an integer between 1 and 5' },
        { status: 400 }
      );
    }

    if (!body.userSessionId || typeof body.userSessionId !== 'string') {
      return NextResponse.json(
        { error: 'userSessionId is required' },
        { status: 400 }
      );
    }

    const [webcamRow] = await sql<Record<string, unknown>[]>`
      SELECT 
        w.*,
        s.phase,
        s.rank
      FROM webcams w
      LEFT JOIN terminator_webcam_state s
        ON s.webcam_id = w.id
      WHERE w.id = ${body.webcamId}
      LIMIT 1
    `;

    if (!webcamRow) {
      return NextResponse.json(
        { error: 'Webcam not found' },
        { status: 404 }
      );
    }

    const webcam = mapDatabaseRowToWebcam(webcamRow);
    const { snapshot, alreadyExisted } = await findOrCreateSnapshot(
      body,
      {
        ...webcam,
        phase: body.phase,
      }
    );

    const ratingInfo = await upsertRating(snapshot.id, body);

    return NextResponse.json({
      success: true,
      snapshotId: snapshot.id,
      rating: body.rating,
      calculatedRating: ratingInfo.calculatedRating,
      ratingCount: ratingInfo.ratingCount,
      capturedAt: snapshot.captured_at,
      firebaseUrl: snapshot.firebase_url,
      alreadyExisted,
    });
  } catch (error) {
    console.error('[capture-and-rate] failed:', error);
    return NextResponse.json(
      {
        error: 'Internal server error',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}


