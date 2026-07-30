import { NextRequest, NextResponse } from 'next/server';
import { loadSession, saveSession } from '@/app/lib/ring/ringStore';
import { getRankedCameras } from '@/app/lib/ring/rankedCameras';
import {
  pruneStale,
  assignOrKeep,
  releasePhone,
  computeSlots,
} from '@/app/lib/ring/ringLogic';

export async function POST(request: NextRequest): Promise<NextResponse> {
  const body = await request.json().catch(() => ({}));
  const phoneId = typeof body?.phoneId === 'string' ? body.phoneId.trim() : '';
  if (!phoneId) {
    return NextResponse.json({ error: 'phoneId required' }, { status: 400 });
  }

  const now = Date.now();
  let session = pruneStale(await loadSession(), now);

  if (body?.leave) {
    session = releasePhone(session, phoneId);
    await saveSession(session);
    return NextResponse.json({ left: true });
  }

  const ranked = await getRankedCameras();
  session = assignOrKeep(session, phoneId, ranked, now);
  await saveSession(session);

  const claim = session.claims[phoneId];
  if (!claim) {
    return NextResponse.json({ assigned: false, reason: 'no_camera_available' });
  }

  const camera = ranked.find((c) => c.id === claim.cameraId)!;
  const slot = computeSlots(session, ranked)[phoneId];
  return NextResponse.json({
    assigned: true,
    camera: { id: camera.id, title: camera.title, imageUrl: camera.imageUrl },
    slot,
  });
}
