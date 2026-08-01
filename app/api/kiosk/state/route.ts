import { NextResponse } from 'next/server';
import { getKioskDoze } from '@/app/lib/cache';

export const dynamic = 'force-dynamic';

// Redis-only read: this is the endpoint dozing kiosks poll once a minute to
// hear the wake command, so it must never touch Neon.
export async function GET() {
  return NextResponse.json({ doze: await getKioskDoze() });
}
