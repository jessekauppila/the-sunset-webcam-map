import { NextResponse } from 'next/server';
import { sql } from '@/app/lib/db';
import { verifyDeviceToken } from '@/app/lib/cameraAuth';
import { derivePlacementStatus } from '@/app/lib/cameraDeployment';

export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ id: string }> };

type PlacementRow = {
  lat: number | null;
  lng: number | null;
  azimuth_deg: number | null;
  tilt_deg: number | null;
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

  let body: { azimuth_deg?: unknown; tilt_deg?: unknown; roll_deg?: unknown; confirmed_at?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid json body' }, { status: 400 });
  }

  const azimuth = Number(body.azimuth_deg);
  const tilt = Number(body.tilt_deg);
  if (!Number.isFinite(azimuth) || !Number.isFinite(tilt)) {
    return NextResponse.json({ error: 'azimuth_deg and tilt_deg must be numbers' }, { status: 400 });
  }

  const rows = (await sql`
    UPDATE webcams
    SET azimuth_deg = ${azimuth}, tilt_deg = ${tilt}, coarse = FALSE
    WHERE custom_camera_id = ${cameraId} AND source = 'custom' AND ended_at IS NULL
    RETURNING lat, lng, azimuth_deg, tilt_deg
  `) as PlacementRow[];

  if (!rows[0]) {
    return NextResponse.json({ error: 'no active deployment for camera' }, { status: 404 });
  }

  return NextResponse.json({ placement_status: derivePlacementStatus(rows[0]) });
}
