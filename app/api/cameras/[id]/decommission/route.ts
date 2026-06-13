import { NextResponse } from 'next/server';
import { sql } from '@/app/lib/db';
import { resolveCameraRef } from '@/app/lib/cameraLifecycle';

export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ id: string }> };

type Body = { claim_code?: unknown; relocate?: unknown };

// Decommission: turn this camera off at its current location (contract §12).
// Sets status='decommissioned'. With relocate:true it raises the wifi_wipe
// directive, surfaced on the next heartbeat (the device half is E plan's
// directive-honor task). Re-commission via the wizard (pre-register upsert)
// flips status back to 'active'. Usable by the operator (numeric id) or the
// open setup page (claim_code, no Bearer); never reset-as-power (unplug is power).
export async function POST(request: Request, context: RouteContext) {
  const { id } = await context.params;

  let body: Body = {};
  try {
    body = (await request.json()) as Body;
  } catch {
    // Empty body is acceptable (operator id path with no relocation intent).
  }

  const ref = await resolveCameraRef(id, body.claim_code);
  if (!ref.ok) {
    return NextResponse.json({ error: ref.error }, { status: ref.status });
  }

  const relocate = body.relocate === true;
  const rows = (await sql`
    UPDATE cameras
    SET status = 'decommissioned',
        wifi_wipe_requested = (wifi_wipe_requested OR ${relocate})
    WHERE id = ${ref.cameraId}
    RETURNING id, status, wifi_wipe_requested
  `) as { id: number; status: string; wifi_wipe_requested: boolean }[];

  const row = rows[0];
  return NextResponse.json({
    camera_id: row.id,
    status: row.status,
    wifi_wipe_requested: row.wifi_wipe_requested,
  });
}
