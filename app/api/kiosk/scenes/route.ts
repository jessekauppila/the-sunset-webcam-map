import { NextResponse } from 'next/server';
import { requireOwner } from '@/app/lib/owner';
import { createScene, listScenes } from '@/app/lib/scenes/store';
import { reconstructScene } from '@/app/lib/scenes/reconstruct';
import { captureLiveScene } from '@/app/lib/scenes/captureLive';

export const dynamic = 'force-dynamic';
export const maxDuration = 60; // live capture may pin several frames

export async function GET() {
  const denied = await requireOwner();
  if (denied) return denied;
  return NextResponse.json({ scenes: await listScenes() });
}

export async function POST(request: Request) {
  const denied = await requireOwner();
  if (denied) return denied;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  const label = typeof body.label === 'string' ? body.label.trim() : '';
  if (!label) return NextResponse.json({ error: 'label is required' }, { status: 400 });
  const tags = Array.isArray(body.tags) ? body.tags.map(String) : [];
  const notes = typeof body.notes === 'string' ? body.notes : '';

  if (body.at !== undefined) {
    const at = new Date(String(body.at));
    if (Number.isNaN(at.getTime())) {
      return NextResponse.json({ error: 'unparseable at timestamp' }, { status: 400 });
    }
    const windowMinutes = Math.min(180, Math.max(5, Number(body.windowMinutes) || 45));
    const { state, reconstructed, skipped } = await reconstructScene(at, windowMinutes);
    if (reconstructed === 0) {
      return NextResponse.json(
        { error: 'no snapshots found in the window', skipped },
        { status: 422 }
      );
    }
    const id = await createScene({
      label, tags, notes, representsAt: at, source: 'historical', state, provenance: null,
    });
    return NextResponse.json({ id, source: 'historical', reconstructed, skipped }, { status: 201 });
  }

  // Default 'live' so a capture with no opinion records what was on glass;
  // /studio asks for 'studio' because it is saving the view being tuned.
  const provenanceProfile = body.provenanceProfile === 'studio' ? 'studio' : 'live';
  const { state, provenance, pinned, pinFailures } =
    await captureLiveScene(provenanceProfile);
  const id = await createScene({
    label, tags, notes, representsAt: new Date(), source: 'live', state, provenance,
  });
  return NextResponse.json({ id, source: 'live', pinned, pinFailures }, { status: 201 });
}
