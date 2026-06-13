import { NextResponse } from 'next/server';
import { getCameraByClaimCode } from '@/app/lib/setupCamera';
import { declinationDeg } from '@/app/lib/declination';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(_request: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const cam = await getCameraByClaimCode(code);
  if (!cam) return NextResponse.json({ error: 'unknown setup code' }, { status: 404 });
  return NextResponse.json({ declinationDeg: declinationDeg(cam.lat, cam.lng) });
}
