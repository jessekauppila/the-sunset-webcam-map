import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { isOwner } from '@/app/lib/owner';
import { sql } from '@/app/lib/db';
import { getClaimCode } from '@/app/lib/cameraClaimCode';
import { PHASE_VALUES } from '@/app/lib/cameraRegistration';
import {
  upsertActiveDeployment,
  derivePlacementStatus,
} from '@/app/lib/cameraDeployment';

export const dynamic = 'force-dynamic';

type Body = {
  claim_code?: unknown;
  lat?: unknown;
  lng?: unknown;
  elevation_m?: unknown;
  timezone?: unknown;
  mode?: unknown;
  publish?: unknown;
  placement?: {
    azimuth_deg?: unknown;
    tilt_deg?: unknown;
    horizon_altitude_deg?: unknown;
    horizon_profile?: unknown;
    azimuth_source?: unknown;
    coarse?: unknown;
    bracket?: unknown;
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

const LENS_VALUES = ['wide_120', 'standard_66'] as const;
// Canonical solver vocabulary (contract Fix 1): north/south, null at a 0deg wedge.
const SIDE_VALUES = ['north', 'south'] as const;

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

// Validate the bracket provenance blob if present. The single canonical bracket
// validator (contract §0 — F owns this file). NULL-TOLERANT: only enum-checks
// window_offset_side/flip_direction when non-null.
function parseBracket(raw: unknown): { ok: true; value: unknown } | { ok: false } {
  if (raw == null) return { ok: true, value: null };
  if (typeof raw !== 'object') return { ok: false };
  const b = raw as Record<string, unknown>;
  if (!(LENS_VALUES as readonly unknown[]).includes(b.lens)) return { ok: false };
  for (const key of ['window_offset_side', 'flip_direction'] as const) {
    const v = b[key];
    if (v != null && !(SIDE_VALUES as readonly unknown[]).includes(v)) return { ok: false };
  }
  for (const key of ['window_normal_az_true', 'window_azimuth_offset_deg',
                     'wedge_angle_deg', 'residual_aim_error_deg', 'material_thickness_mm'] as const) {
    if (b[key] != null && !isFiniteNumber(b[key])) return { ok: false };
  }
  return { ok: true, value: b };
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

  const bracketResult = parseBracket(body.placement?.bracket);
  if (!bracketResult.ok) {
    return NextResponse.json({ error: 'placement.bracket is malformed' }, { status: 400 });
  }
  let azimuthSource = asString(body.placement?.azimuth_source);
  let coarse = typeof body.placement?.coarse === 'boolean' ? body.placement.coarse : null;

  // Invariant PR-2 (contract): if a bracket blob is present, azimuth_source MUST be
  // 'bracket' AND coarse MUST be true. Default them when omitted; REJECT (400) a
  // contradiction — persisting provenance while disabling sun-refine is self-contradictory.
  if (bracketResult.value != null) {
    if (azimuthSource == null) azimuthSource = 'bracket';
    if (coarse == null) coarse = true;
    if (azimuthSource !== 'bracket' || coarse !== true) {
      return NextResponse.json(
        { error: "placement.bracket requires azimuth_source==='bracket' and coarse===true" },
        { status: 400 }
      );
    }
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

  // Resolve the provisioned camera by claim code
  const cameraRows = (await sql`SELECT id FROM cameras WHERE claim_code = ${claimCode} LIMIT 1`) as { id: number }[];
  if (!cameraRows[0]) {
    return NextResponse.json({ error: 'camera not provisioned for this claim code' }, { status: 404 });
  }
  const cameraId = cameraRows[0].id;

  // Owner-aware state (server-enforced; NEVER trust a client 'state')
  const session = await auth();
  const owner = isOwner(session);
  const publish = owner && (body as { publish?: unknown }).publish === true;
  const state: 'testing' | 'deployed' = owner ? (publish ? 'deployed' : 'testing') : 'deployed';

  // Mode from the body (default reaim)
  const mode = (body as { mode?: unknown }).mode === 'new' ? 'new' : 'reaim';

  try {
    const deployment = await upsertActiveDeployment(cameraId, {
      lat,
      lng,
      elevation_m: asNumber(body.elevation_m),
      timezone,
      azimuth_deg: azimuth,
      tilt_deg: tilt,
      horizon_altitude_deg: asNumber(body.placement?.horizon_altitude_deg) ?? 0,
      horizon_profile: horizonProfile ?? null,
      azimuth_source: azimuthSource,
      coarse,
      bracket: bracketResult.value,
      phase_preference: phase,
      delivery_preferences: body.operator_preferences?.delivery ?? null,
    }, { state, mode });

    return NextResponse.json(
      {
        camera_id: cameraId,
        deployment_id: deployment.id,
        state: deployment.state,
        placement_status: derivePlacementStatus(deployment),
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
