import { NextResponse } from 'next/server';
import { getSweptZone } from '@/app/lib/solo/store';
import { isFlagEnabled, SWEEP_FORCE_DAY_RING } from '@/app/lib/runtimeFlags';
import { sweepGeometry } from '@/app/api/cron/update-cameras/lib/sweepGeometry';
import { TERMINATOR_DAY_SIDE_OFFSETS_DEG } from '@/app/lib/masterConfig';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * The solar-altitude band the cron last swept, for the globe's sweep
 * overlay. Same source and same fallback as the solo state route: the zone
 * the cron recorded on its last tick, else the guaranteed rings. Read-only,
 * public, and no bigger than the two numbers the overlay needs.
 */
export async function GET() {
  const [zone, forcedDayRing] = await Promise.all([
    getSweptZone(),
    isFlagEnabled(SWEEP_FORCE_DAY_RING),
  ]);
  const geometry = sweepGeometry(forcedDayRing ? TERMINATOR_DAY_SIDE_OFFSETS_DEG : []);
  return NextResponse.json({
    zone: zone ?? { minDeg: geometry.coverageMinDeg, maxDeg: geometry.coverageMaxDeg },
    recorded: zone !== null,
    forcedDayRing,
  });
}
