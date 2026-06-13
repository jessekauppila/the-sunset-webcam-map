import { NextResponse } from 'next/server';
import { recordAim } from '@/app/lib/recordAim';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const body = await request.json().catch(() => ({}));
  const heading = body.heading_deg;
  if (typeof heading !== 'number' || Number.isNaN(heading)) {
    return NextResponse.json({ error: 'heading_deg (number) is required' }, { status: 400 });
  }
  const source = body.source === 'manual' || body.source === 'window' ? body.source : 'phone';
  const result = await recordAim(code, {
    headingDeg: heading,
    source,
    lat: typeof body.lat === 'number' ? body.lat : undefined,
    lng: typeof body.lng === 'number' ? body.lng : undefined,
  });
  if (!result) return NextResponse.json({ error: 'unknown setup code' }, { status: 404 });
  return NextResponse.json(result);
}
