import { NextRequest, NextResponse } from 'next/server';
import { requireOwner } from '@/app/lib/owner';
import { loadDeployIntoStudio } from '@/app/lib/settings/deploys';
import { parseDeployId } from '../../parseId';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Put a recorded deploy into the STUDIO profile so it can be previewed and
 * then deployed. The glass is untouched: only Deploy changes live.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await requireOwner();
  if (denied) return denied;
  const id = parseDeployId((await params).id);
  if (id === null) {
    return NextResponse.json({ error: 'id must be a positive integer' }, { status: 400 });
  }
  const out = await loadDeployIntoStudio(id);
  if (!out) return NextResponse.json({ error: 'no such deploy' }, { status: 404 });
  return NextResponse.json(out);
}
