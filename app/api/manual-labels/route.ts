import { NextResponse } from 'next/server';
import { requireOwner } from '@/app/lib/owner';
import {
  upsertManualLabel,
  deleteManualLabel,
  type LabelSource,
} from '@/app/lib/manualLabels';

export const dynamic = 'force-dynamic';

const SOURCES: LabelSource[] = ['webcam', 'flickr'];

export async function POST(request: Request) {
  const denied = await requireOwner();
  if (denied) return denied;
  try {
    const { source, imageId, isSunset, rating } = await request.json();
    if (!SOURCES.includes(source)) {
      return NextResponse.json({ error: 'bad source' }, { status: 400 });
    }
    if (typeof imageId !== 'number' || !Number.isInteger(imageId)) {
      return NextResponse.json({ error: 'bad imageId' }, { status: 400 });
    }
    if (typeof isSunset !== 'boolean') {
      return NextResponse.json({ error: 'isSunset required' }, { status: 400 });
    }
    if (rating != null && (typeof rating !== 'number' || rating < 1 || rating > 5)) {
      return NextResponse.json({ error: 'bad rating' }, { status: 400 });
    }
    await upsertManualLabel({ source, imageId, isSunset, rating: rating ?? null });
    return NextResponse.json({ ok: true });
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
    if (!SOURCES.includes(source) || typeof imageId !== 'number') {
      return NextResponse.json({ error: 'bad request' }, { status: 400 });
    }
    await deleteManualLabel(source, imageId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'error' },
      { status: 500 },
    );
  }
}
