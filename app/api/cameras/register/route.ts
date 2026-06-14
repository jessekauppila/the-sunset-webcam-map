import { NextResponse } from 'next/server';
import { sql } from '@/app/lib/db';
import { getClaimCode } from '@/app/lib/cameraClaimCode';
import {
  getActiveDeployment,
  derivePlacementStatus,
} from '@/app/lib/cameraDeployment';

export const dynamic = 'force-dynamic';

type Body = {
  claim_code?: unknown;
  hardware_id?: unknown;
  capabilities?: unknown;
  firmware_version?: unknown;
};

function asString(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
}

type CameraRow = {
  id: number;
  hardware_id: string | null;
};

export async function POST(request: Request) {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: 'invalid json body' }, { status: 400 });
  }

  const claimCode = asString(body.claim_code);
  const hardwareId = asString(body.hardware_id);
  if (!claimCode || !hardwareId) {
    return NextResponse.json(
      { error: 'claim_code and hardware_id are required' },
      { status: 400 }
    );
  }

  // 1. Validate claim code exists and is not expired.
  //    consumed_at is intentionally NOT checked — claim codes are permanent
  //    once bound at provisioning; a consumed code is normal on re-register.
  const claim = await getClaimCode(claimCode);
  if (!claim) {
    return NextResponse.json({ error: 'unknown claim code' }, { status: 404 });
  }
  if (claim.expires_at.getTime() < Date.now()) {
    return NextResponse.json({ error: 'claim code expired' }, { status: 410 });
  }

  try {
    // 2. Resolve the provisioned camera row for this claim code.
    const cameraRows = (await sql`
      SELECT id, hardware_id FROM cameras WHERE claim_code = ${claimCode} LIMIT 1
    `) as CameraRow[];

    if (!cameraRows[0]) {
      return NextResponse.json(
        { error: 'camera not provisioned for this claim code' },
        { status: 404 }
      );
    }

    const row = cameraRows[0];

    // 3. Guard: provisioned identity is authoritative; a different board must not hijack it.
    if (row.hardware_id !== hardwareId) {
      return NextResponse.json(
        { error: 'hardware_id mismatch', existing_camera_id: row.id },
        { status: 409 }
      );
    }

    const cameraId = row.id;
    const firmwareVersion = asString(body.firmware_version);
    const capabilities = JSON.stringify(body.capabilities ?? {});

    // 4. Update device fields; stamp registered_at + last_seen_at.
    await sql`
      UPDATE cameras SET
        firmware_version = ${firmwareVersion},
        capabilities = ${capabilities}::jsonb,
        last_seen_at = NOW(),
        registered_at = NOW()
      WHERE id = ${cameraId}
      RETURNING id
    `;

    // 5. Read the active deployment for placement status.
    const d = await getActiveDeployment(cameraId);
    const status = derivePlacementStatus(d);

    const responseBody: Record<string, unknown> = {
      camera_id: cameraId,
      placement_status: status,
    };

    if (status === 'ready' && d) {
      responseBody.placement = {
        lat: d.lat,
        lng: d.lng,
        elevation_m: d.elevation_m,
        timezone: d.timezone,
        azimuth_deg: d.azimuth_deg,
        tilt_deg: d.tilt_deg,
        horizon_altitude_deg: d.horizon_altitude_deg,
        horizon_profile: d.horizon_profile,
        phase_preference: d.phase_preference,
        delivery_preferences: d.delivery_preferences,
        azimuth_source: d.azimuth_source,
        coarse: d.coarse,
        bracket: d.bracket,
      };
    }

    return NextResponse.json(responseBody);
  } catch (error) {
    console.error('[cameras/register] failed:', error);
    return NextResponse.json(
      { error: 'internal server error', details: error instanceof Error ? error.message : 'unknown' },
      { status: 500 }
    );
  }
}
