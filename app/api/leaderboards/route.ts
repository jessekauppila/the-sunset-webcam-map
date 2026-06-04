import { NextResponse } from 'next/server';
import { sql } from '@/app/lib/db';

export const dynamic = 'force-dynamic';

// Public, read-only "Best Sunsets" leaderboard. Ranks webcam_snapshots by the
// per-snapshot ai_rating the cron stamps (NOT the human calculated_rating).
// No auth — it's a public surface; cached at the CDN.
//
// Coverage caveat (surfaced in the UI): ai_rating is only populated for frames
// the cron persisted (disagreement queue + the SAVE_HIGH_RATED / SAVE_ALL_RATED
// capture toggles), so the board is sparse until those toggles have run a while.

type Grouping = 'overall' | 'webcam' | 'country';
type Window = 'now' | 'today' | 'all-time';

const GROUPINGS: Grouping[] = ['overall', 'webcam', 'country'];
const WINDOWS: Window[] = ['now', 'today', 'all-time'];

// Fixed, non-user-controlled SQL fragments — safe to inline (no user input).
const WINDOW_SQL: Record<Window, string> = {
  now: "AND s.captured_at >= NOW() - INTERVAL '120 minutes'",
  today: "AND s.captured_at >= date_trunc('day', NOW())",
  'all-time': '',
};

export interface LeaderboardEntry {
  id: number;
  aiRating: number;
  firebaseUrl: string | null;
  capturedAt: string;
  webcamId: number;
  webcamTitle: string | null;
  country: string;
}

function pick<T>(value: string | null, allowed: readonly T[], fallback: T): T {
  return (allowed as readonly unknown[]).includes(value) ? (value as T) : fallback;
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const grouping = pick(searchParams.get('grouping'), GROUPINGS, 'overall');
    const window = pick(searchParams.get('window'), WINDOWS, 'all-time');
    const limit = Math.min(
      Math.max(parseInt(searchParams.get('limit') ?? '60', 10) || 60, 1),
      500,
    );

    const windowSql = WINDOW_SQL[window];

    // Explicit column allow-list — never expose user_session_id / device_token_hash.
    const cols = `
      s.id,
      s.ai_rating AS "aiRating",
      s.firebase_url AS "firebaseUrl",
      s.captured_at AS "capturedAt",
      s.webcam_id AS "webcamId",
      w.title AS "webcamTitle",
      COALESCE(w.country, 'Unknown') AS country
    `;
    const base = `
      FROM webcam_snapshots s
      JOIN webcams w ON w.id = s.webcam_id
      WHERE s.ai_rating IS NOT NULL
      ${windowSql}
    `;

    let queryText: string;
    if (grouping === 'overall') {
      // Top frames overall.
      queryText = `SELECT ${cols} ${base} ORDER BY s.ai_rating DESC, s.captured_at DESC LIMIT $1`;
    } else {
      // Best single frame per webcam / per country, then ranked.
      const distinctCol = grouping === 'webcam' ? 's.webcam_id' : 'w.country';
      queryText = `
        SELECT * FROM (
          SELECT DISTINCT ON (${distinctCol}) ${cols}
          ${base}
          ORDER BY ${distinctCol}, s.ai_rating DESC, s.captured_at DESC
        ) best
        ORDER BY best."aiRating" DESC
        LIMIT $1
      `;
    }

    const rows = (await sql.query(queryText, [limit])) as LeaderboardEntry[];

    return NextResponse.json(
      { grouping, window, count: rows.length, entries: rows },
      {
        headers: {
          'Cache-Control': 's-maxage=60, stale-while-revalidate=120',
        },
      },
    );
  } catch (error) {
    console.error('Error in leaderboards route:', error);
    return NextResponse.json(
      {
        error: 'Internal server error',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 },
    );
  }
}
