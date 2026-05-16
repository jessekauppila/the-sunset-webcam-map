import { NextResponse } from 'next/server';
import { sql } from '@/app/lib/db';
import { verifyDeviceToken } from '@/app/lib/cameraAuth';
import { derivePlacementStatus } from '@/app/lib/cameraRegistration';

export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ id: string }> };

type Body = {
  uptime_s?: unknown;
  request_placement?: unknown;
};

type PlacementRow = {
  lat: number | null;
  lng: number | null;
  elevation_m: number | null;
  timezone: string | null;
  azimuth_deg: number | null;
  tilt_deg: number | null;
  horizon_altitude_deg: number | null;
  horizon_profile: unknown;
  phase_preference: string;
  delivery_preferences: unknown;
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

  await sql`
    UPDATE cameras SET last_heartbeat_at = NOW() WHERE id = ${cameraId}
  `;

  if (body.request_placement !== true) {
    return NextResponse.json({ acknowledged_at: new Date().toISOString() });
  }

  const rows = (await sql`
    SELECT lat, lng, elevation_m, timezone,
           azimuth_deg, tilt_deg, horizon_altitude_deg, horizon_profile,
           phase_preference, delivery_preferences
    FROM cameras WHERE id = ${cameraId} LIMIT 1
  `) as PlacementRow[];

  const row = rows[0];
  if (!row) {
    return NextResponse.json({ error: 'camera vanished' }, { status: 404 });
  }

  const status = derivePlacementStatus(row);
  if (status === 'pending') {
    return NextResponse.json({
      acknowledged_at: new Date().toISOString(),
      placement_status: 'pending',
    });
  }

  return NextResponse.json({
    acknowledged_at: new Date().toISOString(),
    placement_status: 'ready',
    placement: {
      lat: row.lat,
      lng: row.lng,
      elevation_m: row.elevation_m,
      timezone: row.timezone,
      azimuth_deg: row.azimuth_deg,
      tilt_deg: row.tilt_deg,
      horizon_altitude_deg: row.horizon_altitude_deg,
      horizon_profile: row.horizon_profile,
      phase_preference: row.phase_preference,
      delivery_preferences: row.delivery_preferences,
    },
  });
}
