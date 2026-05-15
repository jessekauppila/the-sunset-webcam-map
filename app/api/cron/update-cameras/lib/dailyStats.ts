import { sql } from '@/app/lib/db';

export interface TickStats {
  modelVersion: string;
  webcamsScored: number;
  cacheHits: number;
  fallbacks: number;
  scoreAvg: number | null;
  scoreP50: number | null;
  scoreP90: number | null;
  scoreP99: number | null;
  aboveMinScoreToWinCount: number;
  sourceBreakdown: {
    windy: { scored: number; avg: number | null };
    custom: { scored: number; avg: number | null };
  };
}

function avg(xs: number[]): number | null {
  if (xs.length === 0) return null;
  return Number(
    (xs.reduce((s, v) => s + v, 0) / xs.length).toFixed(3)
  );
}

function percentile(xs: number[], p: number): number | null {
  if (xs.length === 0) return null;
  const sorted = [...xs].sort((a, b) => a - b);
  const idx = Math.min(
    sorted.length - 1,
    Math.max(0, Math.floor((p / 100) * sorted.length))
  );
  return Number(sorted[idx].toFixed(3));
}

export function computeTickStats(input: {
  windyScores: number[];
  customScores: number[];
  cacheHits: number;
  fallbacks: number;
  modelVersion: string;
  minScoreToWin: number;
}): TickStats {
  const all = [...input.windyScores, ...input.customScores];
  return {
    modelVersion: input.modelVersion,
    webcamsScored: all.length,
    cacheHits: input.cacheHits,
    fallbacks: input.fallbacks,
    scoreAvg: avg(all),
    scoreP50: percentile(all, 50),
    scoreP90: percentile(all, 90),
    scoreP99: percentile(all, 99),
    aboveMinScoreToWinCount: all.filter((s) => s >= input.minScoreToWin)
      .length,
    sourceBreakdown: {
      windy: {
        scored: input.windyScores.length,
        avg: avg(input.windyScores),
      },
      custom: {
        scored: input.customScores.length,
        avg: avg(input.customScores),
      },
    },
  };
}

function utcDateString(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * UPSERT today's row in daily_sunset_stats. Counters ADD across ticks so an
 * intra-day rerun is additive; percentile/avg columns OVERWRITE with the
 * most recent tick's values (cheap, approximate, sufficient for tuning).
 */
export async function upsertDailyStats(
  now: Date,
  stats: TickStats
): Promise<void> {
  const date = utcDateString(now);
  await sql`
    insert into daily_sunset_stats (
      date, model_version,
      webcams_scored, cache_hits, fallbacks,
      score_avg, score_p50, score_p90, score_p99,
      above_min_score_to_win_count, source_breakdown,
      updated_at
    ) values (
      ${date}, ${stats.modelVersion},
      ${stats.webcamsScored}, ${stats.cacheHits}, ${stats.fallbacks},
      ${stats.scoreAvg}, ${stats.scoreP50}, ${stats.scoreP90}, ${stats.scoreP99},
      ${stats.aboveMinScoreToWinCount}, ${JSON.stringify(stats.sourceBreakdown)}::jsonb,
      now()
    )
    on conflict (date) do update set
      model_version = excluded.model_version,
      webcams_scored = daily_sunset_stats.webcams_scored + excluded.webcams_scored,
      cache_hits = daily_sunset_stats.cache_hits + excluded.cache_hits,
      fallbacks = daily_sunset_stats.fallbacks + excluded.fallbacks,
      score_avg = excluded.score_avg,
      score_p50 = excluded.score_p50,
      score_p90 = excluded.score_p90,
      score_p99 = excluded.score_p99,
      above_min_score_to_win_count =
        daily_sunset_stats.above_min_score_to_win_count
        + excluded.above_min_score_to_win_count,
      source_breakdown = excluded.source_breakdown,
      updated_at = now()
  `;
}
