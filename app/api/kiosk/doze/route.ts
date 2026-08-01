import { NextResponse } from 'next/server';
import { requireOwner } from '@/app/lib/owner';
import { setKioskDoze } from '@/app/lib/cache';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const denied = await requireOwner();
  if (denied) return denied;

  let doze: unknown;
  try {
    ({ doze } = await request.json());
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 });
  }
  if (typeof doze !== 'boolean') {
    return NextResponse.json({ error: 'doze must be boolean' }, { status: 400 });
  }
  await setKioskDoze(doze);
  return NextResponse.json({ doze });
}
