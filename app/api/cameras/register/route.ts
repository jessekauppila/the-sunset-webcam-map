import { NextResponse } from 'next/server';
import { sql } from '@/app/lib/db';
import { getClaimCode, consumeClaimCode } from '@/app/lib/cameraClaimCode';
import {
  mintDeviceToken,
  derivePlacementStatus,
} from '@/app/lib/cameraRegistration';

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

type ExistingCameraRow = {
  id: number;
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

  const claim = await getClaimCode(claimCode);
  if (!claim) {
    return NextResponse.json({ error: 'unknown claim code' }, { status: 404 });
  }
  if (claim.expires_at.getTime() < Date.now()) {
    return NextResponse.json({ error: 'claim code expired' }, { status: 410 });
  }
  if (claim.consumed_at) {
    return NextResponse.json({ error: 'claim code already consumed' }, { status: 409 });
  }

  const { plaintext, hash } = mintDeviceToken();
  const firmwareVersion = asString(body.firmware_version);
  const capabilities = JSON.stringify(body.capabilities ?? {});

  try {
    const existingRows = (await sql`
      SELECT id, lat, lng, elevation_m, timezone,
             azimuth_deg, tilt_deg, horizon_altitude_deg, horizon_profile,
             phase_preference, delivery_preferences
      FROM cameras WHERE claim_code = ${claimCode} LIMIT 1
    `) as ExistingCameraRow[];

    let cameraId: number;
    let placementRow: ExistingCameraRow;

    if (existingRows[0]) {
      // Pre-register-first path: row exists with placement; fill in device fields.
      const r = existingRows[0];
      const updated = (await sql`
        UPDATE cameras SET
          hardware_id = ${hardwareId},
          device_token_hash = ${hash},
          firmware_version = ${firmwareVersion},
          capabilities = ${capabilities}::jsonb,
          registered_at = NOW()
        WHERE id = ${r.id}
        RETURNING id
      `) as { id: number }[];
      cameraId = updated[0].id;
      placementRow = r;
    } else {
      // Register-first path: check for a hardware_id collision before inserting.
      const collision = (await sql`
        SELECT id FROM cameras WHERE hardware_id = ${hardwareId} LIMIT 1
      `) as { id: number }[];
      if (collision[0]) {
        return NextResponse.json(
          { error: 'hardware_id already registered', existing_camera_id: collision[0].id },
          { status: 409 }
        );
      }

      // Insert a row with no placement; pre-register will fill it in later.
      const inserted = (await sql`
        INSERT INTO cameras (
          hardware_id, device_token_hash, claim_code,
          firmware_version, capabilities,
          phase_preference
        )
        VALUES (
          ${hardwareId}, ${hash}, ${claimCode},
          ${firmwareVersion}, ${capabilities}::jsonb,
          'both'
        )
        RETURNING id, lat, lng, elevation_m, timezone,
                  azimuth_deg, tilt_deg, horizon_altitude_deg, horizon_profile,
                  phase_preference, delivery_preferences
      `) as ExistingCameraRow[];
      cameraId = inserted[0].id;
      placementRow = inserted[0];
    }

    const consumed = await consumeClaimCode(claimCode, cameraId);
    if (!consumed) {
      console.error(
        `[cameras/register] consumeClaimCode returned null after row creation cameraId=${cameraId} claim=${claimCode}`
      );
      return NextResponse.json(
        { error: 'internal server error', details: 'claim consumption failed after row creation' },
        { status: 500 }
      );
    }

    const status = derivePlacementStatus(placementRow);
    const responseBody: Record<string, unknown> = {
      camera_id: cameraId,
      device_token: plaintext,
      placement_status: status,
    };
    if (status === 'ready') {
      responseBody.placement = {
        lat: placementRow.lat,
        lng: placementRow.lng,
        elevation_m: placementRow.elevation_m,
        timezone: placementRow.timezone,
        azimuth_deg: placementRow.azimuth_deg,
        tilt_deg: placementRow.tilt_deg,
        horizon_altitude_deg: placementRow.horizon_altitude_deg,
        horizon_profile: placementRow.horizon_profile,
        phase_preference: placementRow.phase_preference,
        delivery_preferences: placementRow.delivery_preferences,
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
