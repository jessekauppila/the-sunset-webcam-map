import { NextRequest, NextResponse } from 'next/server';
import { requireOwner } from '@/app/lib/owner';
import { relabelDeploy } from '@/app/lib/settings/deploys';
import { parseDeployId } from '../parseId';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const LABEL_MAX = 60;

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
  const raw = body?.label;
  if (raw !== null && typeof raw !== 'string') {
    return NextResponse.json({ error: 'label must be a string or null' }, { status: 400 });
  }
  if (typeof raw === 'string' && raw.length > LABEL_MAX) {
    return NextResponse.json(
      { error: `label must be at most ${LABEL_MAX} characters` },
      { status: 400 },
    );
  }
  const label = typeof raw === 'string' && raw.trim() ? raw.trim() : null;
  const found = await relabelDeploy(id, label);
  if (!found) return NextResponse.json({ error: 'no such deploy' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
