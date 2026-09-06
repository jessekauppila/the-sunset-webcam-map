import { NextRequest, NextResponse } from 'next/server';
import { requireOwner } from '@/app/lib/owner';
import { relabelDeploy } from '@/app/lib/settings/deploys';
import { parseDeployId } from '../parseId';
import { parseLabel } from '../labels';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Rename a deploy. `{ label: null }` clears it. */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await requireOwner();
  if (denied) return denied;
  const id = parseDeployId((await params).id);
  if (id === null) {
    return NextResponse.json({ error: 'id must be a positive integer' }, { status: 400 });
  }
  let body: { label?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 });
  }
  const parsed = parseLabel(body?.label);
  if ('error' in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  const found = await relabelDeploy(id, parsed.label);
  if (!found) return NextResponse.json({ error: 'no such deploy' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
