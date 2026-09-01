import { NextResponse } from 'next/server';
import { sql } from '@/app/lib/db';

export const dynamic = 'force-dynamic';

// Public, read-only "Best Sunsets" leaderboard.
//
// Ranking is Claude-primary with a real-model fallback (plan U1/KTD4):
//   - Frames Claude judged a sunset (llm_is_sunset = true) rank by llm_quality.
//   - Claude-null frames with a REAL v4 regression score rank by it, gated to
//     ai_regression_score >= MODEL_SUNSET_MIN so only model-confident sunsets
//     appear. We NEVER fall back to the junk legacy ai_rating column (no model
//     provenance). The fallback clause is inert until the v4 archive backfill
//     (U3) populates ai_regression_score.
//
// ⚠️ MIXED INSTRUMENTS — the board ranks two different measuring devices
// against each other. Both columns are NUMERIC(4,3) on [0,1], but sharing a
// RANGE is not sharing a SCALE, and the original "no scale discontinuity"
// claim here is wrong. Measured 2026-08-31 over the whole archive:
//
//   column               n        mean    p99     max
//   llm_quality          46,079   0.188   0.720   0.880
//   ai_regression_score  60,646   0.432   0.809   1.000
//
// On the 46,079 frames that carry BOTH, the means are 0.188 vs 0.405 and the
// two correlate at only r = 0.454. Claude's scale is compressed (STATE
// 2026-08-29: rubric anchors say 1≈0.05/3≈0.50/5≈0.95, measured means are
// 0.257/0.441/0.600), so a Claude-scored 5 loses to a model-scored 4.
//
// Consequence, not theory: Claude campaigns stopped 2026-07-31, so every
// frame captured since ranks by ai_regression_score while older frames rank
// by llm_quality — and the all-time top 100 is now **98 model-ranked, 2
// Claude-ranked**. The public "Best Sunsets" board is effectively "best
// sunsets since August."
//
// Not fixed here deliberately (roadmap side item 3 — "not urgent"). When it
// is fixed, the clean move is to rank everything on ai_regression_score:
// every Claude-rated frame already carries a model score (46,079 of 46,079),
// so it is a single-instrument re-rank with no coverage loss, and the model
// is the better instrument against operator truth (Pearson 0.697 vs Claude's
// 0.514 on the same frames, pooled-500 eval). Changing the sort key changes
// what the public board shows, so it wants its own decision.
//
// Flickr is excluded structurally, not by a filter: this query only reads
// webcam_snapshots JOIN webcams; the Flickr corpus lives in external_images
// and is never joined here (plan KTD8). No auth (public), CDN-cached.

// Minimum real v4 regression score ([0,1]) for a Claude-null frame to qualify
// as a "sunset" on the public board. Tunable (plan Open Questions:
// MODEL_SUNSET_MIN); 0.6 ≈ a 3.4/5 rating. Fixed literal — safe to inline.
const MODEL_SUNSET_MIN = 0.6;

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
  llmQuality: number | string;
  llmIsSunset: boolean;
  llmIsSunrise: boolean | null;
  llmExplanation: string | null;
  llmModel: string | null;
  llmProvider: string | null;
  aiRating: number | string | null; // legacy junk column — comparison only, never ranked
  aiRegressionScore: number | string | null; // real v4 score [0,1], drives the fallback
  aiModelVersionRegression: string | null;
  sortScore: number | string | null; // COALESCE(llm_quality, ai_regression_score) — the rank key
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

    // Optional single-webcam filter (per-camera detail page). Bound param, never
    // interpolated. Ignored when absent or non-numeric.
    const webcamIdRaw = searchParams.get('webcam_id');
    const webcamId =
      webcamIdRaw !== null && /^\d+$/.test(webcamIdRaw)
        ? parseInt(webcamIdRaw, 10)
        : null;
    const webcamFilter = webcamId !== null ? 'AND s.webcam_id = $2' : '';
    const params: number[] = webcamId !== null ? [limit, webcamId] : [limit];

    // Explicit column allow-list — never expose user_session_id / device_token_hash.
    const cols = `
      s.id,
      s.llm_quality AS "llmQuality",
      s.llm_is_sunset AS "llmIsSunset",
      s.llm_is_sunrise AS "llmIsSunrise",
      s.llm_rating_explanation AS "llmExplanation",
      s.llm_model AS "llmModel",
      s.llm_provider AS "llmProvider",
      s.ai_rating AS "aiRating",
      s.ai_regression_score AS "aiRegressionScore",
      s.ai_model_version_regression AS "aiModelVersionRegression",
      COALESCE(s.llm_quality, s.ai_regression_score) AS "sortScore",
      s.firebase_url AS "firebaseUrl",
      s.captured_at AS "capturedAt",
      s.webcam_id AS "webcamId",
      w.title AS "webcamTitle",
      COALESCE(w.country, 'Unknown') AS country
    `;
    // Claude-primary with a real-model fallback. The fallback clause is inert
    // until ai_regression_score is backfilled (U3). Never reads junk ai_rating.
    const base = `
      FROM webcam_snapshots s
      JOIN webcams w ON w.id = s.webcam_id
      WHERE (
        (s.llm_quality IS NOT NULL AND s.llm_is_sunset = true)
        OR (s.llm_quality IS NULL AND s.ai_regression_score IS NOT NULL AND s.ai_regression_score >= ${MODEL_SUNSET_MIN})
      )
      ${windowSql}
      ${webcamFilter}
    `;
    // Unified [0,1] rank key: Claude when present, else the real model score.
    const rankKey = 'COALESCE(s.llm_quality, s.ai_regression_score)';

    let queryText: string;
    if (grouping === 'overall') {
      // Top frames overall.
      queryText = `SELECT ${cols} ${base} ORDER BY ${rankKey} DESC, s.captured_at DESC LIMIT $1`;
    } else {
      // Best single frame per webcam / per country, then ranked.
      const distinctCol = grouping === 'webcam' ? 's.webcam_id' : 'w.country';
      queryText = `
        SELECT * FROM (
          SELECT DISTINCT ON (${distinctCol}) ${cols}
          ${base}
          ORDER BY ${distinctCol}, ${rankKey} DESC, s.captured_at DESC
        ) best
        ORDER BY best."sortScore" DESC
        LIMIT $1
      `;
    }

    const rows = (await sql.query(queryText, params)) as LeaderboardEntry[];

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
