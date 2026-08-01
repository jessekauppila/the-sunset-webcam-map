// Shared shapes for the owner-only Ops tab. Kept out of the route file so the
// client component can import types without pulling server code.
export interface DailyStatsRow {
  date: string; // 'YYYY-MM-DD'
  model_version: string;
  webcams_scored: number;
  cache_hits: number;
  fallbacks: number;
  score_p50: number | null;
  score_p90: number | null;
  source_breakdown: Record<
    string,
    { scored: number; avg: number | null }
  > | null;
}

export interface ProviderUsageRow {
  day: string; // 'YYYY-MM-DD'
  project_id: string;
  compute_time_s: number;
}

export interface CostEventRow {
  occurred_on: string; // 'YYYY-MM-DD'
  sha: string | null;
  description: string;
}

export interface OpsStatsResponse {
  dailyStats: DailyStatsRow[];
  providerUsage: ProviderUsageRow[];
  costEvents: CostEventRow[];
}
