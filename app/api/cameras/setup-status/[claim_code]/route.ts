import { NextResponse } from 'next/server';
import { sql } from '@/app/lib/db';
import { getClaimCode } from '@/app/lib/cameraClaimCode';
import { getActiveDeployment, derivePlacementStatus } from '@/app/lib/cameraDeployment';

export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ claim_code: string }> };

type CameraIdRow = { id: number };

export async function GET(_request: Request, context: RouteContext) {
  const { claim_code } = await context.params;
  const claim = await getClaimCode(claim_code);
  if (!claim || claim.expires_at.getTime() < Date.now()) {
    return NextResponse.json({ error: 'unknown or expired claim code' }, { status: 404 });
  }

  const rows = (await sql`
    SELECT id FROM cameras WHERE claim_code = ${claim_code} LIMIT 1
  `) as CameraIdRow[];

  const row = rows[0];
  if (!row) {
    // Defensive: camera always exists post-provisioning, but handle the edge case.
    return NextResponse.json({ status: 'awaiting_wifi' });
  }

  const deployment = await getActiveDeployment(row.id);
  if (!deployment) {
    // Camera provisioned but no placement created yet.
    return NextResponse.json({ status: 'registered' });
  }

  const placement = derivePlacementStatus(deployment);
  const status =
    placement === 'ready' ? 'ready'
    : placement === 'awaiting_aim' ? 'awaiting_aim'
    : 'registered'; // awaiting_location: deployment exists but no coords yet
  return NextResponse.json({ status });
}
