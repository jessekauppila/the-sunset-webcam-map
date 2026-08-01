import { NextResponse } from 'next/server';
import { requireOwner } from '@/app/lib/owner';
import { sql } from '@/app/lib/db';
import { OPS_STATS_DAYS } from '@/app/lib/masterConfig';
import type { DailyStatsRow, OpsStatsResponse } from '@/app/lib/opsTypes';

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

  const body: OpsStatsResponse = {
    dailyStats: rows.reverse(), // oldest → newest for charting
    providerUsage: [],
    costEvents: [],
  };
  return NextResponse.json(body);
}
