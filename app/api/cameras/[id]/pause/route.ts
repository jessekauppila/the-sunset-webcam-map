import { NextResponse } from 'next/server';
import { sql } from '@/app/lib/db';
import { resolveCameraRef } from '@/app/lib/cameraLifecycle';

export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ id: string }> };

type Body = { claim_code?: unknown };

// Pause: suspend capture WITHOUT ending the camera (contract §12). status='paused'
// is resumable — WiFi and placement stay intact, the wipe directive is untouched.
// Usable by the operator (numeric id) or the open setup page (claim_code, no Bearer).
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

  const rows = (await sql`
    UPDATE cameras SET status = 'paused'
    WHERE id = ${ref.cameraId}
    RETURNING id, status
  `) as { id: number; status: string }[];

  const row = rows[0];
  return NextResponse.json({ camera_id: row.id, status: row.status });
}
