import { NextResponse } from 'next/server';
import { sql } from '@/app/lib/db';
import { getClaimCode } from '@/app/lib/cameraClaimCode';
import { derivePlacementStatus, sentinelForClaimCode } from '@/app/lib/cameraRegistration';

export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ claim_code: string }> };

type StatusRow = {
  id: number;
  hardware_id: string;
  device_token_hash: string;
  lat: number | null;
  lng: number | null;
  azimuth_deg: number | null;
  tilt_deg: number | null;
};

export async function GET(_request: Request, context: RouteContext) {
  const { claim_code } = await context.params;
  const claim = await getClaimCode(claim_code);
  if (!claim || claim.expires_at.getTime() < Date.now()) {
    return NextResponse.json({ error: 'unknown or expired claim code' }, { status: 404 });
  }

  const rows = (await sql`
    SELECT id, hardware_id, device_token_hash, lat, lng, azimuth_deg, tilt_deg
    FROM cameras WHERE claim_code = ${claim_code} LIMIT 1
  `) as StatusRow[];

  const row = rows[0];
  if (!row) {
    return NextResponse.json({ status: 'awaiting_wifi' });
  }

  // A pre-register-first row is identifiable by the sentinel placeholder
  // (see Task 4's upsert). Treat such rows as "device hasn't called register yet."
  const sentinel = sentinelForClaimCode(claim_code);
  if (row.hardware_id === sentinel && row.device_token_hash === sentinel) {
    return NextResponse.json({ status: 'awaiting_wifi' });
  }

  const placement = derivePlacementStatus(row);
  return NextResponse.json({
    status: placement === 'ready' ? 'ready' : 'registered',
  });
}
