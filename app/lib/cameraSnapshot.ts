import { sql } from '@/app/lib/db';
import { getFirebaseBucket } from '@/app/lib/firebase';

export async function uploadCameraSnapshot(
  cameraId: number,
  imageBuffer: Buffer,
  capturedAt: Date
): Promise<{ url: string; path: string }> {
  const bucket = getFirebaseBucket();
  const path = `snapshots/custom/${cameraId}/${capturedAt.getTime()}.jpg`;
  const file = bucket.file(path);

  await file.save(imageBuffer, {
    metadata: {
      contentType: 'image/jpeg',
      metadata: {
        cameraId: String(cameraId),
        capturedAt: capturedAt.toISOString(),
        source: 'custom',
      },
    },
  });

  await file.makePublic();

  const url = `https://storage.googleapis.com/${bucket.name}/${path}`;
  return { url, path };
}

export interface InsertCameraSnapshotInput {
  webcamId: number;
  phase: 'sunrise' | 'sunset';
  capturedAt: Date;
  firebaseUrl: string;
  firebasePath: string;
  windowId: string;
  edgeScore: number | null;
  edgeModelVersion: string | null;
}

export async function insertCameraSnapshotRow(
  input: InsertCameraSnapshotInput
): Promise<number> {
  const rows = (await sql`
    INSERT INTO webcam_snapshots (
      webcam_id,
      phase,
      firebase_url,
      firebase_path,
      captured_at,
      window_id,
      edge_score,
      edge_model_version
    )
    VALUES (
      ${input.webcamId},
      ${input.phase},
      ${input.firebaseUrl},
      ${input.firebasePath},
      ${input.capturedAt.toISOString()},
      ${input.windowId},
      ${input.edgeScore},
      ${input.edgeModelVersion}
    )
    RETURNING id
  `) as { id: number }[];

  return rows[0].id;
}
