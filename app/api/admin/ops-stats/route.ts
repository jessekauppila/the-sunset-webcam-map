import { NextResponse } from 'next/server';
import { requireOwner } from '@/app/lib/owner';
import { sql } from '@/app/lib/db';
import { OPS_STATS_DAYS, PROVIDER_USAGE_LOOKBACK_DAYS } from '@/app/lib/masterConfig';
import type {
  DailyStatsRow,
  OpsStatsResponse,
  ProviderUsageRow,
  CostEventRow,
} from '@/app/lib/opsTypes';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  const denied = await requireOwner();
  if (denied) return denied;

  const rows = (await sql`
    SELECT date::text AS date, model_version, webcams_scored, cache_hits,
           fallbacks, score_p50::float, score_p90::float, source_breakdown
    FROM daily_sunset_stats
    ORDER BY date DESC
    LIMIT ${OPS_STATS_DAYS}
  `) as unknown as DailyStatsRow[];

  const providerUsage = (await sql`
    SELECT day::text AS day, project_id, compute_time_s::bigint AS compute_time_s
    FROM provider_usage_daily
    WHERE day > CURRENT_DATE - ${PROVIDER_USAGE_LOOKBACK_DAYS}
    ORDER BY day ASC, project_id ASC
  `) as unknown as ProviderUsageRow[];

  const costEvents = (await sql`
    SELECT occurred_on::text AS occurred_on, sha, description
    FROM cost_events
    ORDER BY occurred_on ASC
  `) as unknown as CostEventRow[];

  const body: OpsStatsResponse = {
    dailyStats: rows.reverse(), // oldest → newest for charting
    providerUsage: providerUsage.map((r) => ({
      ...r,
      compute_time_s: Number(r.compute_time_s),
    })),
    costEvents,
  };
  return NextResponse.json(body);
}
