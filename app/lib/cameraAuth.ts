import { createHash } from 'node:crypto';
import { sql } from '@/app/lib/db';

export type CameraRow = {
  id: number;
  status: string;
  device_token_hash: string;
};

export function hashDeviceToken(plaintext: string): string {
  return createHash('sha256').update(plaintext, 'utf8').digest('hex');
}

export async function verifyDeviceToken(
  cameraId: number,
  authorizationHeader: string | null
): Promise<CameraRow | null> {
  if (!authorizationHeader || !authorizationHeader.startsWith('Bearer ')) {
    return null;
  }
  const token = authorizationHeader.slice('Bearer '.length).trim();
  if (!token) return null;

  const expectedHash = hashDeviceToken(token);

  const rows = (await sql`
    SELECT id, status, device_token_hash
    FROM cameras
    WHERE id = ${cameraId}
    LIMIT 1
  `) as CameraRow[];

  const row = rows[0];
  if (!row) return null;
  if (row.status !== 'active') return null;
  if (row.device_token_hash !== expectedHash) return null;

  return row;
}
