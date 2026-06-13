import { NextResponse } from 'next/server';
import { getCameraByClaimCode } from '@/app/lib/setupCamera';
import { arcAnchors } from '@/app/lib/solar';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(_request: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const cam = await getCameraByClaimCode(code);
  if (!cam) return NextResponse.json({ error: 'unknown setup code' }, { status: 404 });
  const facing = cam.phase === 'sunrise' ? 'east' : 'west';
  const year = new Date().getUTCFullYear();
  const arc = arcAnchors(cam.lat, year, facing);
  return NextResponse.json({ ...arc, facing });
}
