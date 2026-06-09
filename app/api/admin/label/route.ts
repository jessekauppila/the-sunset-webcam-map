import { NextResponse } from 'next/server';
import { requireOwner } from '@/app/lib/owner';
import { generateLabelPng } from '@/app/lib/labelGenerator';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: Request) {
  const denied = await requireOwner();
  if (denied) return denied;

  const { searchParams } = new URL(request.url);
  const claimCode = searchParams.get('claim_code');
  const name = searchParams.get('name') ?? 'Sunset Camera';
  const tape = searchParams.get('tape') ?? '14x75';
  if (!claimCode) {
    return NextResponse.json({ error: 'claim_code is required' }, { status: 400 });
  }
  const [widthMm, lengthMm] = tape.split('x').map(Number);
  const png = await generateLabelPng({ claimCode, name, tape: { widthMm, lengthMm } });
  return new Response(new Uint8Array(png), {
    status: 200,
    headers: {
      'Content-Type': 'image/png',
      'Content-Disposition': `inline; filename="label-${claimCode}.png"`,
    },
  });
}
