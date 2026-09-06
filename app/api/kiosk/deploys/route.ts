import { NextRequest, NextResponse } from 'next/server';
import { requireOwner } from '@/app/lib/owner';
import { listDeploys, saveTake } from '@/app/lib/settings/deploys';
import { getProfileSettings } from '@/app/lib/settings/store';
import { parseLabel } from './labels';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Every recorded Deploy, newest first (spec §2.3). */
export async function GET() {
  const denied = await requireOwner();
  if (denied) return denied;
  return NextResponse.json({ deploys: await listDeploys() });
}

/** Save the current studio profile as a take (spec §4.2). Never reaches the glass. */
export async function POST(request: NextRequest) {
  const denied = await requireOwner();
  if (denied) return denied;
  let body: { label?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 });
  }
  const raw = body?.label === undefined ? null : body.label;
  const parsed = parseLabel(raw);
  if ('error' in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  const studio = await getProfileSettings('studio');
  const take = await saveTake(studio, parsed.label);
  if (!take) return NextResponse.json({ error: 'take not recorded' }, { status: 503 });
  return NextResponse.json({ take }, { status: 201 });
}
