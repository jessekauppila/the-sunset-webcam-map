import { NextResponse } from 'next/server';
import { requireOwner } from '@/app/lib/owner';
import {
  upsertManualLabel,
  deleteManualLabel,
  countManualLabels,
  type LabelSource,
} from '@/app/lib/manualLabels';

export const dynamic = 'force-dynamic';

const SOURCES: LabelSource[] = ['webcam', 'flickr'];

export async function POST(request: Request) {
  const denied = await requireOwner();
  if (denied) return denied;
  try {
    const { source, imageId, isSunset, rating, origin } = await request.json();
    if (!SOURCES.includes(source)) {
      return NextResponse.json({ error: 'bad source' }, { status: 400 });
    }
    // external_images.id is BIGINT → arrives as a string from the driver/client;
    // coerce so a numeric-string id (Flickr frames) isn't rejected.
    const imageIdNum = Number(imageId);
    if (!Number.isInteger(imageIdNum)) {
      return NextResponse.json({ error: 'bad imageId' }, { status: 400 });
    }
    if (typeof isSunset !== 'boolean') {
      return NextResponse.json({ error: 'isSunset required' }, { status: 400 });
    }
    if (rating != null && (typeof rating !== 'number' || rating < 1 || rating > 5)) {
      return NextResponse.json({ error: 'bad rating' }, { status: 400 });
    }
    // `origin` records which queue this label came from and is read back as a
    // filter in the ML exports, so keep it to a slug rather than storing
    // whatever the client sent.
    if (origin != null && (typeof origin !== 'string' || !/^[a-z0-9_]{1,64}$/.test(origin))) {
      return NextResponse.json({ error: 'bad origin' }, { status: 400 });
    }
    const saved = await upsertManualLabel({
      source,
      imageId: imageIdNum,
      isSunset,
      rating: rating ?? null,
      origin: origin ?? null,
    });
    if (!saved) {
      // The insert returned no row, so nothing was stored. Say so rather than
      // letting the queue count this as a save.
      return NextResponse.json({ error: 'label not stored' }, { status: 500 });
    }
    return NextResponse.json({ ok: true, saved, labeledTotal: await countManualLabels() });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'error' },
      { status: 500 },
    );
  }
}

export async function DELETE(request: Request) {
  const denied = await requireOwner();
  if (denied) return denied;
  try {
    const { source, imageId } = await request.json();
    const imageIdNum = Number(imageId);
    if (!SOURCES.includes(source) || !Number.isInteger(imageIdNum)) {
      return NextResponse.json({ error: 'bad request' }, { status: 400 });
    }
    const removed = await deleteManualLabel(source, imageIdNum);
    return NextResponse.json({ ok: true, removed, labeledTotal: await countManualLabels() });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'error' },
      { status: 500 },
    );
  }
}
