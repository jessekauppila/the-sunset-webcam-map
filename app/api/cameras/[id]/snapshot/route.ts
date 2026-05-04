import { NextResponse } from 'next/server';
import { sql } from '@/app/lib/db';
import { verifyDeviceToken } from '@/app/lib/cameraAuth';
import {
  uploadCameraSnapshot,
  insertCameraSnapshotRow,
} from '@/app/lib/cameraSnapshot';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const cameraId = Number.parseInt(id, 10);
  if (!Number.isFinite(cameraId) || cameraId <= 0) {
    return NextResponse.json({ error: 'invalid camera id' }, { status: 400 });
  }

  const camera = await verifyDeviceToken(
    cameraId,
    request.headers.get('authorization')
  );
  if (!camera) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json(
      { error: 'expected multipart/form-data' },
      { status: 400 }
    );
  }

  const imageEntry = form.get('image');
  if (!(imageEntry instanceof Blob)) {
    return NextResponse.json(
      { error: 'image field is required' },
      { status: 400 }
    );
  }
  if (imageEntry.size > MAX_IMAGE_BYTES) {
    return NextResponse.json(
      { error: 'image exceeds 5MB cap' },
      { status: 413 }
    );
  }

  const phaseRaw = String(form.get('phase') ?? '');
  if (phaseRaw !== 'sunrise' && phaseRaw !== 'sunset') {
    return NextResponse.json(
      { error: 'phase must be sunrise or sunset' },
      { status: 400 }
    );
  }
  const phase = phaseRaw as 'sunrise' | 'sunset';

  const capturedAtRaw = String(form.get('captured_at') ?? '');
  const capturedAt = new Date(capturedAtRaw);
  if (Number.isNaN(capturedAt.getTime())) {
    return NextResponse.json(
      { error: 'captured_at must be ISO8601' },
      { status: 400 }
    );
  }

  const windowId = String(form.get('window_id') ?? '');
  if (!windowId) {
    return NextResponse.json(
      { error: 'window_id is required' },
      { status: 400 }
    );
  }

  const edgeScoreRaw = form.get('edge_score');
  const edgeScore =
    edgeScoreRaw == null || edgeScoreRaw === ''
      ? null
      : Number.parseFloat(String(edgeScoreRaw));
  const edgeModelVersionRaw = form.get('edge_model_ver');
  const edgeModelVersion =
    edgeModelVersionRaw == null || edgeModelVersionRaw === ''
      ? null
      : String(edgeModelVersionRaw);

  const rows = (await sql`
    SELECT webcam_id FROM cameras WHERE id = ${cameraId} LIMIT 1
  `) as { webcam_id: number | null }[];
  const webcamId = rows[0]?.webcam_id ?? null;
  if (!webcamId) {
    return NextResponse.json(
      { error: 'camera has no paired webcam row' },
      { status: 404 }
    );
  }

  const arrayBuffer = await imageEntry.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  const uploaded = await uploadCameraSnapshot(cameraId, buffer, capturedAt);
  const snapshotId = await insertCameraSnapshotRow({
    webcamId,
    phase,
    capturedAt,
    firebaseUrl: uploaded.url,
    firebasePath: uploaded.path,
    windowId,
    edgeScore: Number.isFinite(edgeScore as number) ? (edgeScore as number) : null,
    edgeModelVersion,
  });

  await sql`
    UPDATE cameras
    SET last_seen_at = NOW()
    WHERE id = ${cameraId}
  `;

  return NextResponse.json(
    {
      snapshot_id: snapshotId,
      accepted_at: new Date().toISOString(),
    },
    { status: 202 }
  );
}
