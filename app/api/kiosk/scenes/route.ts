import { NextResponse } from 'next/server';
import { requireOwner } from '@/app/lib/owner';
import { createScene, listScenes } from '@/app/lib/scenes/store';
import { reconstructScene } from '@/app/lib/scenes/reconstruct';
import { captureLiveScene } from '@/app/lib/scenes/captureLive';
import {
  parseSceneInstant,
  clampWindowMinutes,
  SCENE_INSTANT_MESSAGE,
} from '@/app/lib/scenes/sceneTime';

/**
 * Half-width of the window a live capture represents. Pinning a ~25-camera
 * pool runs inside one request, so every frame's captured_at lands within a
 * couple of minutes; 15 is slack, not a guess at spread.
 */
const LIVE_CAPTURE_WINDOW_MINUTES = 15;

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
    // Requires an explicit offset. A bare wall-clock string is read in the
    // server's zone and shifts the scene silently, which no downstream check
    // can catch. See app/lib/scenes/sceneTime.ts.
    const parsed = parseSceneInstant(body.at);
    if (!parsed.ok) {
      return NextResponse.json({ error: SCENE_INSTANT_MESSAGE[parsed.error] }, { status: 400 });
    }
    const at = parsed.value;
    const windowMinutes = clampWindowMinutes(body.windowMinutes);
    const { state, reconstructed, skipped } = await reconstructScene(at, windowMinutes);
    if (reconstructed === 0) {
      return NextResponse.json(
        { error: 'no snapshots found in the window', skipped },
        { status: 422 }
      );
    }
    // state: null — a pointer. The reconstruction above ran only to VALIDATE
    // that the window has frames; the pool itself resolves on every read, so
    // a re-rating or a newer model shows up on this scene later instead of
    // being frozen behind a copy taken now.
    const id = await createScene({
      label, tags, notes, representsAt: at, windowMinutes,
      source: 'historical', state: null, provenance: null,
    });
    return NextResponse.json({ id, source: 'historical', reconstructed, skipped }, { status: 201 });
  }

  // Default 'live' so a capture with no opinion records what was on glass;
  // /studio asks for 'studio' because it is saving the view being tuned.
  const provenanceProfile = body.provenanceProfile === 'studio' ? 'studio' : 'live';
  const { provenance, pinned, pinFailures, archived } =
    await captureLiveScene(provenanceProfile);
  // A live capture's frames all land within one request, so its window is
  // tight. It stores a pointer too, now that the capture files its whole pool
  // into the archive — `archived` is how many rows the window will find.
  const id = await createScene({
    label, tags, notes, representsAt: new Date(),
    windowMinutes: LIVE_CAPTURE_WINDOW_MINUTES,
    source: 'live', state: null, provenance,
  });
  return NextResponse.json(
    { id, source: 'live', pinned, pinFailures, archived },
    { status: 201 }
  );
}
