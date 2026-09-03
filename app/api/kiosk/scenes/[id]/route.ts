import { NextResponse } from 'next/server';
import { requireOwner } from '@/app/lib/owner';
import { deleteScene, getScene, updateSceneMeta } from '@/app/lib/scenes/store';
import { resolveScene } from '@/app/lib/scenes/resolve';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export async function GET(_request: Request, { params }: Ctx) {
  const denied = await requireOwner();
  if (denied) return denied;
  const id = parseId((await params).id);
  if (id === null) return NextResponse.json({ error: 'bad id' }, { status: 400 });
  const scene = await getScene(id);
  if (!scene) return NextResponse.json({ error: 'not found' }, { status: 404 });
  // Pointer scenes resolve on every read, so an improved model shows up on
  // an old scene instead of being hidden behind a copy taken at save time.
  return NextResponse.json(await resolveScene(scene));
}

export async function PATCH(request: Request, { params }: Ctx) {
  const denied = await requireOwner();
  if (denied) return denied;
  const id = parseId((await params).id);
  if (id === null) return NextResponse.json({ error: 'bad id' }, { status: 400 });

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }
  const allowed = ['label', 'tags', 'notes'];
  const extra = Object.keys(body).filter((k) => !allowed.includes(k));
  if (extra.length > 0) {
    return NextResponse.json(
      { error: `immutable or unknown fields: ${extra.join(', ')}` },
      { status: 400 }
    );
  }
  const patch: { label?: string; tags?: string[]; notes?: string } = {};
  if (typeof body.label === 'string') patch.label = body.label.trim();
  if (Array.isArray(body.tags)) patch.tags = body.tags.map(String);
  if (typeof body.notes === 'string') patch.notes = body.notes;

  const found = await updateSceneMeta(id, patch);
  if (!found) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_request: Request, { params }: Ctx) {
  const denied = await requireOwner();
  if (denied) return denied;
  const id = parseId((await params).id);
  if (id === null) return NextResponse.json({ error: 'bad id' }, { status: 400 });
  const found = await deleteScene(id);
  if (!found) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
