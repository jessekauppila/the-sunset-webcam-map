import { NextResponse } from 'next/server';
import { getClaimCode } from '@/app/lib/cameraClaimCode';
import {
  upsertCameraByClaimCode,
  derivePlacementStatus,
  PHASE_VALUES,
} from '@/app/lib/cameraRegistration';

export const dynamic = 'force-dynamic';

type Body = {
  claim_code?: unknown;
  lat?: unknown;
  lng?: unknown;
  elevation_m?: unknown;
  timezone?: unknown;
  placement?: {
    azimuth_deg?: unknown;
    tilt_deg?: unknown;
    horizon_altitude_deg?: unknown;
    horizon_profile?: unknown;
  };
  operator_preferences?: {
    phase_preference?: unknown;
    delivery?: unknown;
  };
};

function asNumber(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function asString(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
}

export async function POST(request: Request) {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: 'invalid json body' }, { status: 400 });
  }

  const claimCode = asString(body.claim_code);
  if (!claimCode) {
    return NextResponse.json({ error: 'claim_code is required' }, { status: 400 });
  }

  const lat = asNumber(body.lat);
  const lng = asNumber(body.lng);
  const timezone = asString(body.timezone);
  const azimuth = asNumber(body.placement?.azimuth_deg);
  const tilt = asNumber(body.placement?.tilt_deg);
  if (lat == null || lng == null || !timezone || azimuth == null || tilt == null) {
    return NextResponse.json(
      { error: 'lat, lng, timezone, placement.azimuth_deg and placement.tilt_deg are required' },
      { status: 400 }
    );
  }

  const horizonProfile = body.placement?.horizon_profile;
  if (horizonProfile != null && !Array.isArray(horizonProfile)) {
    return NextResponse.json(
      { error: 'placement.horizon_profile must be an array or null' },
      { status: 400 }
    );
  }

  const phaseRaw = asString(body.operator_preferences?.phase_preference);
  const phase = phaseRaw != null && (PHASE_VALUES as readonly string[]).includes(phaseRaw)
    ? (phaseRaw as typeof PHASE_VALUES[number])
    : null;
  if (!phase) {
    return NextResponse.json(
      { error: `operator_preferences.phase_preference must be one of ${PHASE_VALUES.join('|')}` },
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

  try {
    const camera = await upsertCameraByClaimCode(claimCode, {
      lat,
      lng,
      elevation_m: asNumber(body.elevation_m),
      timezone,
      azimuth_deg: azimuth,
      tilt_deg: tilt,
      horizon_altitude_deg: asNumber(body.placement?.horizon_altitude_deg) ?? 0,
      horizon_profile: horizonProfile ?? null,
      phase_preference: phase,
      delivery_preferences: body.operator_preferences?.delivery ?? null,
    });

    return NextResponse.json(
      {
        camera_id: camera.id,
        placement_status: derivePlacementStatus(camera),
      },
      { status: 202 }
    );
  } catch (error) {
    console.error('[cameras/pre-register] failed:', error);
    return NextResponse.json(
      { error: 'internal server error', details: error instanceof Error ? error.message : 'unknown' },
      { status: 500 }
    );
  }
}
