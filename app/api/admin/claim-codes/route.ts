import { NextResponse } from 'next/server';
import { mintClaimCode } from '@/app/lib/cameraClaimCode';

export const dynamic = 'force-dynamic';

function isAuthorized(request: Request): boolean {
  const header = request.headers.get('authorization');
  const expected = `Bearer ${process.env.CRON_SECRET}`;
  return Boolean(process.env.CRON_SECRET) && header === expected;
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let body: { label?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid json body' }, { status: 400 });
  }

  const label =
    typeof body.label === 'string' && body.label.trim() !== ''
      ? body.label.trim()
      : null;

  try {
    const minted = await mintClaimCode({ label });
    return NextResponse.json({
      code: minted.code,
      expires_at: minted.expires_at.toISOString(),
    });
  } catch (error) {
    console.error('[admin/claim-codes] mint failed:', error);
    return NextResponse.json(
      { error: 'mint failed', details: error instanceof Error ? error.message : 'unknown' },
      { status: 500 }
    );
  }
}
