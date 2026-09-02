import { NextResponse } from 'next/server';
import { requireOwner } from '@/app/lib/owner';
import { sql } from '@/app/lib/db';
import type { CalibrationFrameRow } from '@/app/lib/opsTypes';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// The frames behind one camera's tempering multiplier. Fetched on expand
// rather than bundled into ops-stats: the evidence table holds ~9k rows today
// and only grows as labels accumulate.
export async function GET(request: Request) {
  const denied = await requireOwner();
  if (denied) return denied;

  const webcamId = Number(
    new URL(request.url).searchParams.get('webcamId') ?? '',
  );
  if (!Number.isFinite(webcamId)) {
    return NextResponse.json({ error: 'webcamId required' }, { status: 400 });
  }

  const frames = (await sql`
    select snapshot_id, captured_on::text as captured_on,
           p_sunset::float as p_sunset,
           tile::float as tile,
           firebase_url
    from camera_calibration_evidence
    where webcam_id = ${webcamId}
      and is_negative = true
      and fired = true
    order by tile desc nulls last
    limit 50
  `) as unknown as CalibrationFrameRow[];

  return NextResponse.json({ frames });
}
