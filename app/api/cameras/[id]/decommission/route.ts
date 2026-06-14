import { NextResponse } from 'next/server';
import { resolveCameraRef } from '@/app/lib/cameraLifecycle';
import { endActiveDeployment } from '@/app/lib/cameraDeployment';

export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ id: string }> };

type Body = { claim_code?: unknown; relocate?: unknown };

// Decommission: end the active deployment for this camera (contract §12).
// With relocate:true the wifi_wipe directive is raised on the active deployment
// record, surfaced on the next heartbeat (the device half is E plan's
// directive-honor task). Re-commission via the wizard (pre-register upsert)
// opens a new deployment. Usable by the operator (numeric id) or the open
// setup page (claim_code, no Bearer); never reset-as-power (unplug is power).
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
  const r = await endActiveDeployment(ref.cameraId, { relocate });
  return NextResponse.json({ camera_id: ref.cameraId, ended: r.ended });
}
