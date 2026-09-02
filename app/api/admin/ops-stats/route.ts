import { NextResponse } from 'next/server';
import { requireOwner } from '@/app/lib/owner';
import { sql } from '@/app/lib/db';
import { OPS_STATS_DAYS, PROVIDER_USAGE_LOOKBACK_DAYS } from '@/app/lib/masterConfig';
import type {
  DailyStatsRow,
  OpsStatsResponse,
  ProviderUsageRow,
  CostEventRow,
  CalibrationCameraRow,
  CalibrationHistoryRow,
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
    WHERE day > CURRENT_DATE - ${PROVIDER_USAGE_LOOKBACK_DAYS}::int
    ORDER BY day ASC, project_id ASC
  `) as unknown as ProviderUsageRow[];

  const costEvents = (await sql`
    SELECT occurred_on::text AS occurred_on, sha, description
    FROM cost_events
    ORDER BY occurred_on ASC
  `) as unknown as CostEventRow[];

  // Per-camera calibration. The ::float casts are deliberate — NUMERIC
  // otherwise arrives as a string through the Neon driver.
  const calibrationCameras = (await sql`
    select w.id as webcam_id, w.title,
           w.calibration_multiplier::float as multiplier,
           (w.calibration_evidence->>'falseShows')::float     as false_shows,
           (w.calibration_evidence->>'negativeFrames')::float as negative_frames,
           (w.calibration_evidence->>'falseShowDays')::int    as false_show_days,
           w.calibration_computed_at::text as computed_at
    from webcams w
    where w.calibration_multiplier is not null
      and w.calibration_multiplier < 1
    order by w.calibration_multiplier asc
    limit 100
  `) as unknown as CalibrationCameraRow[];

  const calibrationHistory = (await sql`
    select webcam_id, computed_at::text as computed_at,
           multiplier::float as multiplier,
           previous_multiplier::float as previous_multiplier
    from camera_calibration_history
    order by computed_at desc
    limit 200
  `) as unknown as CalibrationHistoryRow[];

  const body: OpsStatsResponse = {
    dailyStats: rows.reverse(), // oldest → newest for charting
    providerUsage: providerUsage.map((r) => ({
      ...r,
      compute_time_s: Number(r.compute_time_s),
    })),
    costEvents,
    calibrationCameras,
    calibrationHistory,
  };
  return NextResponse.json(body);
}
