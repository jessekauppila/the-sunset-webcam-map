import { NextResponse } from 'next/server';
import { resolveCameraRef } from '@/app/lib/cameraLifecycle';
import { setDeploymentPaused } from '@/app/lib/cameraDeployment';

export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ id: string }> };

type Body = { claim_code?: unknown };

// Pause: suspend capture on the active deployment WITHOUT ending it (contract §12).
// paused=true is resumable — WiFi and placement stay intact, the wipe directive
// is untouched. Usable by the operator (numeric id) or the open setup page
// (claim_code, no Bearer).
export async function POST(request: Request, context: RouteContext) {
  const { id } = await context.params;

  let body: Body = {};
  try {
    body = (await request.json()) as Body;
  } catch {
    // Empty body is acceptable (operator id path).
  }

  const ref = await resolveCameraRef(id, body.claim_code);
  if (!ref.ok) {
    return NextResponse.json({ error: ref.error }, { status: ref.status });
  }

  const d = await setDeploymentPaused(ref.cameraId, true);
  return NextResponse.json({ camera_id: ref.cameraId, paused: d?.paused ?? true });
}
