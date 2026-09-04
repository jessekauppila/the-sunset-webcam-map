import { NextResponse } from 'next/server';
import { sql } from '@/app/lib/db';
import { requireOwner } from '@/app/lib/owner';
import { countManualLabels, upsertManualLabel } from '@/app/lib/manualLabels';
import { captureWebcamSnapshot } from '@/app/lib/webcamSnapshot';
import { SNAPSHOTS_ENABLED_ON_RATING } from '@/app/lib/masterConfig';
import { ARCHIVE_ORIGIN, LIVE_ORIGIN } from '@/app/lib/frameLabels';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * Gold labels written from a DISPLAY surface — the map popup and the /studio
 * preview — rather than from a labeling queue.
 *
 * `/api/manual-labels` labels a frame the caller can already name. The live
 * surfaces often cannot: a Windy tile renders a CDN preview that is not in
 * `webcam_snapshots` at all, and whose content rotates behind a fixed URL
 * every ~10 minutes, so the URL is not an identity either. This route closes
 * that gap by resolving the frame FIRST — reusing an archived row when the
 * displayed image is one, capturing the frame when it is not — and only then
 * writing the label against the row it resolved.
 *
 * There is no public star path here and no second rating store. The one
 * write is a gold label in `manual_labels`.
 */

/**
 * How stale an existing row may be and still count as "the frame on screen".
 * Windy publishes a new preview roughly every 10 minutes, so a two-minute
 * window cannot span a publish and hand the operator's judgment to a
 * different image. It exists only so re-rating the same tile twice does not
 * upload twice.
 */
const REUSE_WINDOW_SECONDS = 120;

type Body = {
  webcamId?: unknown;
  phase?: unknown;
  frameId?: unknown;
  isSunset?: unknown;
  rating?: unknown;
};

type FrameRow = { id: number; firebase_url: string; captured_at: string };

type Resolved = { frame: FrameRow; origin: string; captured: boolean };

/** Bad request text, or null when the body is usable. */
function validate(body: Body): string | null {
  const { webcamId, phase, frameId, isSunset, rating } = body;
  if (typeof webcamId !== 'number' || !Number.isInteger(webcamId) || webcamId <= 0) {
    return 'webcamId must be a positive integer';
  }
  if (phase !== 'sunrise' && phase !== 'sunset') {
    return 'phase must be sunrise or sunset';
  }
  if (frameId != null && (!Number.isInteger(Number(frameId)) || Number(frameId) <= 0)) {
    return 'frameId must be a positive integer';
  }
  if (typeof isSunset !== 'boolean') {
    return 'isSunset must be a boolean';
  }
  // A "not a sunset" verdict carries no quality, which is the two-scale
  // rubric: the second scale only exists for frames that are sunsets.
  if (isSunset && (typeof rating !== 'number' || !Number.isInteger(rating) || rating < 1 || rating > 5)) {
    return 'rating must be an integer 1-5 when isSunset is true';
  }
  if (!isSunset && rating != null) {
    return 'rating must be omitted when isSunset is false';
  }
  return null;
}

/**
 * The archived row the caller named, but only if it really is this webcam's.
 * A frame id that belongs to another camera would put the operator's judgment
 * on an image they never saw.
 */
async function frameById(frameId: number, webcamId: number): Promise<FrameRow | null> {
  const [row] = (await sql`
    SELECT id, firebase_url, captured_at
    FROM webcam_snapshots
    WHERE id = ${frameId} AND webcam_id = ${webcamId}
    LIMIT 1
  `) as FrameRow[];
  return row ?? null;
}

async function captureFrame(
  webcamId: number,
  phase: 'sunrise' | 'sunset'
): Promise<Resolved> {
  const [recent] = (await sql`
    SELECT id, firebase_url, captured_at
    FROM webcam_snapshots
    WHERE webcam_id = ${webcamId}
      AND captured_at >= NOW() - (${REUSE_WINDOW_SECONDS} * INTERVAL '1 second')
    ORDER BY captured_at DESC
    LIMIT 1
  `) as FrameRow[];
  if (recent) return { frame: recent, origin: LIVE_ORIGIN, captured: false };

  // The operator-capture kill switch. Say so plainly: a label that silently
  // did not happen is worse than one that visibly refused.
  if (!SNAPSHOTS_ENABLED_ON_RATING) {
    throw new Error('Capturing a frame to label is disabled right now.');
  }

  const [webcamRow] = (await sql`
    SELECT id, images, rank FROM webcams WHERE id = ${webcamId} LIMIT 1
  `) as Array<{ id: number; images: unknown; rank: number | null }>;
  if (!webcamRow) throw new Error('webcam not found');

  const images =
    typeof webcamRow.images === 'string'
      ? JSON.parse(webcamRow.images)
      : webcamRow.images;

  const captured = await captureWebcamSnapshot({
    webcamId,
    images,
  } as Parameters<typeof captureWebcamSnapshot>[0]);
  if (!captured) throw new Error('no image available to capture');

  const [inserted] = (await sql`
    INSERT INTO webcam_snapshots (
      webcam_id, phase, rank, firebase_url, firebase_path, intake_reason, captured_at
    )
    VALUES (
      ${webcamId}, ${phase}, ${webcamRow.rank ?? null},
      ${captured.url}, ${captured.path}, 'operator_label', NOW()
    )
    RETURNING id, firebase_url, captured_at
  `) as FrameRow[];
  if (!inserted) throw new Error('frame not stored');

  return { frame: inserted, origin: LIVE_ORIGIN, captured: true };
}

export async function POST(request: Request) {
  const denied = await requireOwner();
  if (denied) return denied;
  try {
    const body = (await request.json()) as Body;
    const problem = validate(body);
    if (problem) return NextResponse.json({ error: problem }, { status: 400 });

    const webcamId = body.webcamId as number;
    const phase = body.phase as 'sunrise' | 'sunset';
    const isSunset = body.isSunset as boolean;
    const rating = isSunset ? (body.rating as number) : null;

    let resolved: Resolved;
    if (body.frameId != null) {
      const frame = await frameById(Number(body.frameId), webcamId);
      if (!frame) {
        return NextResponse.json(
          { error: 'frame not found for this webcam' },
          { status: 404 }
        );
      }
      resolved = { frame, origin: ARCHIVE_ORIGIN, captured: false };
    } else {
      resolved = await captureFrame(webcamId, phase);
    }

    // Straight to the gold upsert: unlike /api/manual-labels, the origin here
    // is one of two server-chosen constants and can never be a retest sample
    // name, so there is no destination to resolve.
    const saved = await upsertManualLabel({
      source: 'webcam',
      imageId: resolved.frame.id,
      isSunset,
      rating,
      origin: resolved.origin,
    });
    if (!saved) {
      return NextResponse.json({ error: 'label not stored' }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      saved,
      // Echo the frame that was actually labeled so the surface can show the
      // operator which image their judgment landed on.
      frameId: resolved.frame.id,
      frameUrl: resolved.frame.firebase_url,
      capturedAt: resolved.frame.captured_at,
      captured: resolved.captured,
      origin: resolved.origin,
      labeledTotal: await countManualLabels(),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'error' },
      { status: 500 }
    );
  }
}
