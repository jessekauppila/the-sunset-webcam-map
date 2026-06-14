import { NextResponse } from 'next/server';
import { sql } from '@/app/lib/db';
import { verifyDeviceToken } from '@/app/lib/cameraAuth';
import { getActiveDeployment, derivePlacementStatus } from '@/app/lib/cameraDeployment';

export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ id: string }> };

type Body = {
  uptime_s?: unknown;
  request_placement?: unknown;
};

// Minimal type for the CTE UPDATE result — only what's camera-level.
// Placement columns now come from the active deployment row, not from cameras.
type CteRow = {
  // Pre-reset value of cameras.wifi_wipe_requested, captured by the CTE so the
  // directive fires exactly once (this same UPDATE resets the flag to FALSE).
  wifi_wipe_was_requested: boolean | null;
};

export async function POST(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const cameraId = Number.parseInt(id, 10);
  if (!Number.isFinite(cameraId) || cameraId <= 0) {
    return NextResponse.json({ error: 'invalid camera id' }, { status: 400 });
  }

  const camera = await verifyDeviceToken(cameraId, request.headers.get('authorization'));
  if (!camera) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let body: Body = {};
  try {
    body = (await request.json()) as Body;
  } catch {
    // Empty body is acceptable for heartbeat — treat as {}.
  }

  // CTE captures the pre-reset wifi_wipe flag, then the UPDATE clears it so the
  // relocation directive (contract §12/§13) is delivered exactly once.
  const rows = (await sql`
    WITH prev AS (
      SELECT wifi_wipe_requested AS was_requested FROM cameras WHERE id = ${cameraId}
    )
    UPDATE cameras SET last_heartbeat_at = NOW(), wifi_wipe_requested = FALSE
    WHERE id = ${cameraId}
    RETURNING (SELECT was_requested FROM prev) AS wifi_wipe_was_requested
  `) as CteRow[];

  const row = rows[0];
  if (!row) {
    // Camera was deleted between auth and UPDATE — extreme race, but handle defensively.
    return NextResponse.json({ error: 'camera vanished' }, { status: 404 });
  }

  const acknowledgedAt = new Date().toISOString();
  const directives = row.wifi_wipe_was_requested ? { directives: ['wipe_wifi'] } : {};

  if (body.request_placement !== true) {
    return NextResponse.json({ acknowledged_at: acknowledgedAt, ...directives });
  }

  // Placement now comes from the active deployment, not the cameras row.
  const d = await getActiveDeployment(cameraId);
  const status = derivePlacementStatus(d);

  if (status === 'awaiting_location') {
    return NextResponse.json({
      acknowledged_at: acknowledgedAt,
      ...directives,
      placement_status: 'awaiting_location',
    });
  }
  if (status === 'awaiting_aim') {
    return NextResponse.json({
      acknowledged_at: acknowledgedAt,
      ...directives,
      placement_status: 'awaiting_aim',
      lat: d!.lat,
      lng: d!.lng,
    });
  }
  // status === 'ready'
  return NextResponse.json({
    acknowledged_at: acknowledgedAt,
    ...directives,
    placement_status: 'ready',
    placement: {
      lat: d!.lat,
      lng: d!.lng,
      elevation_m: d!.elevation_m,
      timezone: d!.timezone,
      azimuth_deg: d!.azimuth_deg,
      tilt_deg: d!.tilt_deg,
      horizon_altitude_deg: d!.horizon_altitude_deg,
      horizon_profile: d!.horizon_profile,
      phase_preference: d!.phase_preference,
      delivery_preferences: d!.delivery_preferences,
      azimuth_source: d!.azimuth_source,
      coarse: d!.coarse,
      bracket: d!.bracket,
    },
  });
}
