import { NextResponse } from 'next/server';
import { sql } from '@/app/lib/db';
import { mintClaimCode } from '@/app/lib/cameraClaimCode';
import { mintDeviceToken } from '@/app/lib/cameraRegistration';

export const dynamic = 'force-dynamic';

function isAuthorized(request: Request): boolean {
  const expected = `Bearer ${process.env.CRON_SECRET}`;
  return Boolean(process.env.CRON_SECRET) && request.headers.get('authorization') === expected;
}

// Provisioning: create the Camera identity ONCE, at flash time. Mints a permanent
// claim code (the QR pointer) + the device token (baked into the SD config, shown
// once here). No deployment yet — the wizard makes those.
export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  let body: { hardware_id?: unknown; device_class?: unknown; label?: unknown };
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: 'invalid json body' }, { status: 400 });
  }
  const hardwareId = typeof body.hardware_id === 'string' && body.hardware_id.trim() ? body.hardware_id.trim() : null;
  if (!hardwareId) {
    return NextResponse.json({ error: 'hardware_id is required' }, { status: 400 });
  }

  const deviceClass = typeof body.device_class === 'string' && body.device_class.trim() ? body.device_class.trim() : 'rpi-zero-2w';
  const label = typeof body.label === 'string' && body.label.trim() ? body.label.trim() : hardwareId;

  const claim = await mintClaimCode({ label, ttlDays: 3650 });
  const { plaintext, hash } = mintDeviceToken();

  try {
    const inserted = (await sql`
      INSERT INTO cameras (hardware_id, device_token_hash, device_class, claim_code, status)
      VALUES (${hardwareId}, ${hash}, ${deviceClass}, ${claim.code}, 'active')
      RETURNING id
    `) as { id: number }[];
    const cameraId = inserted[0].id;

    await sql`
      UPDATE camera_claim_codes
      SET consumed_at = NOW(), consumed_by_camera_id = ${cameraId}
      WHERE code = ${claim.code}
    `;

    return NextResponse.json(
      { camera_id: cameraId, claim_code: claim.code, device_token: plaintext },
      { status: 201 }
    );
  } catch (error) {
    console.error('[cameras/provision] failed:', error);
    return NextResponse.json(
      { error: 'provision failed', details: error instanceof Error ? error.message : 'unknown' },
      { status: 500 }
    );
  }
}
